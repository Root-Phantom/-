"""خروجی گرفتن از جدول توصیفی: CSV و GeoJSON."""
import csv
import io
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import get_current_user_optional
from ..models import Feature, FieldDef, Layer, User
from ..schemas import SearchRequest
from ..services.query_builder import apply_search

router = APIRouter(prefix="/api/export", tags=["خروجی"])

MAX_EXPORT = 100000


def _fields(db: Session, layer_id) -> list[FieldDef]:
    return (
        db.query(FieldDef)
        .filter(FieldDef.layer_id == layer_id)
        .order_by(FieldDef.sort_order, FieldDef.created_at)
        .all()
    )


@router.post("/csv", summary="خروجی CSV از نتایج جست‌وجو")
def export_csv(
    req: SearchRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    if not req.layer_id:
        raise HTTPException(400, "برای خروجی CSV باید لایه را مشخص کنید.")
    layer = db.get(Layer, req.layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")

    public = user is None
    if public:
        req.include_archived = False
    req.page, req.page_size = 1, MAX_EXPORT

    stmt = apply_search(db, req, public_only=public).limit(MAX_EXPORT)
    rows = db.execute(stmt).scalars().all()
    fdefs = _fields(db, req.layer_id)

    buf = io.StringIO()
    buf.write("﻿")  # BOM برای نمایش درست فارسی در اکسل
    w = csv.writer(buf)
    header = [f.label + (f" ({f.unit})" if f.unit else "") for f in fdefs]
    w.writerow(["ردیف"] + header + ["وضعیت", "آخرین ویرایش", "ویرایش‌کننده"])
    for i, f in enumerate(rows, 1):
        attrs = f.attributes or {}
        w.writerow(
            [i]
            + [_fmt(attrs.get(fd.key)) for fd in fdefs]
            + [
                "آرشیو" if f.is_archived else "فعال",
                f.updated_at.strftime("%Y-%m-%d %H:%M") if f.updated_at else "",
                (f.updated_by.full_name or f.updated_by.username) if f.updated_by and not public else "",
            ]
        )

    log_action(
        db, action="export",
        summary=f"خروجی CSV از لایه «{layer.name}» با {len(rows)} ردیف گرفته شد",
        user=user, entity_type="layer", entity_id=layer.id,
        payload={"rows": len(rows), "format": "csv"}, request=request, commit=True,
    )
    buf.seek(0)
    fname = f"{layer.slug or 'layer'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _fmt(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "بله" if v else "خیر"
    return str(v)


@router.post("/geojson", summary="خروجی GeoJSON از نتایج جست‌وجو")
def export_geojson(
    req: SearchRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    if not req.layer_id:
        raise HTTPException(400, "برای خروجی GeoJSON باید لایه را مشخص کنید.")
    layer = db.get(Layer, req.layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")

    public = user is None
    if public:
        req.include_archived = False
    req.page, req.page_size = 1, MAX_EXPORT

    sub = apply_search(db, req, public_only=public).limit(MAX_EXPORT).subquery()
    rows = db.execute(
        select(sub.c.id, sub.c.attributes, sub.c.is_archived, func.ST_AsGeoJSON(sub.c.geom))
    ).all()

    # عنوان فارسی ستون‌ها در خروجی استفاده می‌شود تا فایل برای ArcGIS/QGIS خوانا باشد
    labels = {f.key: f.label for f in _fields(db, req.layer_id)}
    features = []
    for fid, attrs, archived, gj in rows:
        props = {labels.get(k, k): v for k, v in (attrs or {}).items()}
        props["شناسه"] = str(fid)
        props["وضعیت"] = "آرشیو" if archived else "فعال"
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(gj) if gj else None,
                "properties": props,
            }
        )

    log_action(
        db, action="export",
        summary=f"خروجی GeoJSON از لایه «{layer.name}» با {len(features)} عارضه گرفته شد",
        user=user, entity_type="layer", entity_id=layer.id,
        payload={"rows": len(features), "format": "geojson"}, request=request, commit=True,
    )

    body = json.dumps(
        {
            "type": "FeatureCollection",
            "name": layer.name,
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": features,
        },
        ensure_ascii=False,
    )
    fname = f"{layer.slug or 'layer'}.geojson"
    return Response(
        content=body,
        media_type="application/geo+json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
