"""عوارض: ایجاد (رسم نقطه/خط/چندضلعی)، ویرایش، آرشیو و تاریخچه تغییرات."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from geoalchemy2.shape import to_shape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import get_current_user, get_current_user_optional, require_admin, require_editor
from ..models import (
    Feature,
    FeatureRevision,
    FieldDef,
    FieldType,
    GeomType,
    Layer,
    User,
)
from ..schemas import (
    ArchiveIn,
    BulkFieldUpdateIn,
    FeatureCreateIn,
    FeatureOut,
    FeatureUpdateIn,
    Paginated,
    RevisionOut,
)

router = APIRouter(prefix="/api/features", tags=["عوارض"])

ALLOWED_GEOJSON_TYPES = {
    "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
}

GEOM_TYPE_COMPAT = {
    GeomType.POINT: {"Point", "MultiPoint"},
    GeomType.LINESTRING: {"LineString", "MultiLineString"},
    GeomType.POLYGON: {"Polygon", "MultiPolygon"},
    GeomType.MIXED: ALLOWED_GEOJSON_TYPES,
}


# ---------------------------------------------------------------- کمکی


def geom_to_geojson(feature: Feature) -> Optional[dict[str, Any]]:
    if feature.geom is None:
        return None
    try:
        return to_shape(feature.geom).__geo_interface__
    except Exception:
        return None


def to_out(f: Feature, *, include_geometry: bool = True, public: bool = False) -> FeatureOut:
    out = FeatureOut.model_validate(f)
    out.geometry = geom_to_geojson(f) if include_geometry else None
    # نام کارکنان ویرایش‌کننده فقط برای کاربران واردشده نمایش داده می‌شود
    if not public:
        out.created_by_name = (f.created_by.full_name or f.created_by.username) if f.created_by else None
        out.updated_by_name = (f.updated_by.full_name or f.updated_by.username) if f.updated_by else None
    return out


def geojson_to_sql(geometry: dict[str, Any], layer: Layer):
    """GeoJSON را به هندسه PostGIS تبدیل و با نوع لایه مقایسه می‌کند."""
    gtype = geometry.get("type")
    if gtype not in ALLOWED_GEOJSON_TYPES:
        raise HTTPException(400, f"نوع هندسه «{gtype}» پشتیبانی نمی‌شود.")
    allowed = GEOM_TYPE_COMPAT.get(layer.geom_type, ALLOWED_GEOJSON_TYPES)
    if gtype not in allowed:
        raise HTTPException(
            400,
            f"لایه «{layer.name}» تنها هندسه از نوع {'/'.join(sorted(allowed))} را می‌پذیرد، نه {gtype}.",
        )
    if not geometry.get("coordinates"):
        raise HTTPException(400, "هندسه ارسالی مختصات ندارد.")
    return func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geometry)), 4326)


def validate_attributes(
    db: Session, layer_id: uuid.UUID, attrs: dict[str, Any], *, partial: bool
) -> dict[str, Any]:
    """مقادیر جدول توصیفی را بر اساس تعریف ستون‌ها اعتبارسنجی و تبدیل نوع می‌کند."""
    fdefs = db.query(FieldDef).filter(FieldDef.layer_id == layer_id).all()
    by_key = {f.key: f for f in fdefs}

    unknown = set(attrs) - set(by_key)
    if unknown:
        raise HTTPException(
            400,
            "این ستون‌ها در جدول توصیفی لایه تعریف نشده‌اند: " + "، ".join(sorted(unknown)),
        )

    clean: dict[str, Any] = {}
    for key, raw in attrs.items():
        fd = by_key[key]
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            if fd.is_required and not partial:
                raise HTTPException(400, f"ستون «{fd.label}» اجباری است.")
            clean[key] = None
            continue
        clean[key] = _coerce(fd, raw)

    # در حالت ایجاد، ستون‌های اجباری باید وجود داشته باشند
    if not partial:
        for fd in fdefs:
            if fd.is_required and clean.get(fd.key) in (None, ""):
                if fd.default_value:
                    clean[fd.key] = _coerce(fd, fd.default_value)
                else:
                    raise HTTPException(400, f"ستون «{fd.label}» اجباری است.")
    return clean


def _coerce(fd: FieldDef, raw: Any) -> Any:
    """تبدیل مقدار ورودی به نوع ستون."""
    t = fd.data_type
    if t == FieldType.INTEGER:
        try:
            return int(float(str(raw).strip()))
        except (TypeError, ValueError):
            raise HTTPException(400, f"مقدار ستون «{fd.label}» باید عدد صحیح باشد.")
    if t == FieldType.NUMBER:
        try:
            v = float(str(raw).strip())
            return int(v) if v.is_integer() else v
        except (TypeError, ValueError):
            raise HTTPException(400, f"مقدار ستون «{fd.label}» باید عدد باشد.")
    if t == FieldType.BOOLEAN:
        if isinstance(raw, bool):
            return raw
        return str(raw).strip().lower() in {"true", "1", "yes", "on", "بله", "دارد"}
    if t == FieldType.DATE:
        s = str(raw).strip()
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        raise HTTPException(400, f"تاریخ ستون «{fd.label}» باید به شکل YYYY-MM-DD باشد.")
    if t == FieldType.SELECT:
        s = str(raw).strip()
        if fd.options and s not in fd.options:
            raise HTTPException(
                400,
                f"مقدار ستون «{fd.label}» باید یکی از این گزینه‌ها باشد: " + "، ".join(fd.options),
            )
        return s
    return str(raw).strip()


def feature_label(db: Session, f: Feature) -> str:
    """برچسب خوانای عارضه برای نمایش در لاگ و پیام‌ها."""
    attrs = f.attributes or {}
    layer = f.layer or db.get(Layer, f.layer_id)

    # ۱) ستون برچسب تعیین‌شده برای لایه
    if layer and layer.label_field and attrs.get(layer.label_field):
        return str(attrs[layer.label_field])

    # ۲) نام‌های رایج
    for k in ("name", "nam", "title", "label", "anvan"):
        if attrs.get(k):
            return str(attrs[k])

    # ۳) نخستین ستون متنی لایه که مقدار دارد
    if layer:
        for fd in (
            db.query(FieldDef)
            .filter(FieldDef.layer_id == layer.id, FieldDef.data_type == FieldType.TEXT)
            .order_by(FieldDef.sort_order)
            .all()
        ):
            if attrs.get(fd.key):
                return str(attrs[fd.key])

    return f"عارضه {str(f.id)[:8]}"


def _check_layer_editable(db: Session, layer_id: uuid.UUID) -> Layer:
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if layer.is_archived:
        raise HTTPException(400, f"لایه «{layer.name}» آرشیو شده و قابل ویرایش نیست.")
    return layer


# ---------------------------------------------------------------- خواندن


@router.get("", response_model=Paginated, summary="فهرست عوارض یک لایه")
def list_features(
    layer_id: uuid.UUID,
    include_archived: bool = False,
    include_geometry: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")

    q = db.query(Feature).filter(Feature.layer_id == layer_id)
    if not include_archived or user is None:
        q = q.filter(Feature.is_archived.is_(False))

    total = q.count()
    rows = q.order_by(Feature.created_at.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return Paginated(
        total=total,
        page=page,
        page_size=page_size,
        items=[
            to_out(f, include_geometry=include_geometry, public=user is None).model_dump(mode="json")
            for f in rows
        ],
    )


@router.get("/geojson", summary="خروجی GeoJSON لایه برای نمایش روی نقشه")
def layer_geojson(
    layer_id: uuid.UUID,
    include_archived: bool = False,
    limit: int = Query(20000, ge=1, le=100000),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """FeatureCollection سبک برای نقشه — هندسه از سمت پایگاه داده تولید می‌شود."""
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")

    stmt = select(
        Feature.id,
        Feature.attributes,
        Feature.is_archived,
        func.ST_AsGeoJSON(Feature.geom),
    ).where(Feature.layer_id == layer_id, Feature.geom.isnot(None))
    if not include_archived or user is None:
        stmt = stmt.where(Feature.is_archived.is_(False))
    stmt = stmt.limit(limit)

    features = []
    for fid, attrs, archived, gj in db.execute(stmt):
        if not gj:
            continue
        features.append(
            {
                "type": "Feature",
                "id": str(fid),
                "geometry": json.loads(gj),
                "properties": {**(attrs or {}), "__id": str(fid), "__archived": archived},
            }
        )
    return {
        "type": "FeatureCollection",
        "layer": {"id": str(layer.id), "name": layer.name, "style": layer.style},
        "features": features,
    }


@router.get("/{feature_id}", response_model=FeatureOut, summary="جزئیات یک عارضه")
def get_feature(
    feature_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    if user is None:
        layer = db.get(Layer, f.layer_id)
        if f.is_archived or not layer or not layer.is_visible_public or layer.is_archived:
            raise HTTPException(404, "عارضه یافت نشد.")
    return to_out(f, public=user is None)


# ---------------------------------------------------------------- نوشتن


@router.post("", response_model=FeatureOut, status_code=201, summary="ایجاد عارضه (رسم روی نقشه)")
def create_feature(
    data: FeatureCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    layer = _check_layer_editable(db, data.layer_id)
    attrs = validate_attributes(db, layer.id, data.attributes or {}, partial=False)

    f = Feature(
        layer_id=layer.id,
        attributes=attrs,
        created_by_id=user.id,
        updated_by_id=user.id,
        version=1,
    )
    if data.geometry:
        f.geom = geojson_to_sql(data.geometry, layer)
    db.add(f)
    db.flush()

    db.add(
        FeatureRevision(
            feature_id=f.id,
            version=1,
            action="create",
            attributes_before=None,
            attributes_after=attrs,
            changed_fields=sorted(attrs.keys()),
            geometry_changed=bool(data.geometry),
            user_id=user.id,
        )
    )
    gt = (data.geometry or {}).get("type", "بدون هندسه")
    log_action(
        db,
        action="feature_create",
        summary=f"عارضه «{feature_label(db, f)}» در لایه «{layer.name}» ایجاد شد ({gt})",
        user=user,
        entity_type="feature",
        entity_id=f.id,
        payload={"layer": layer.name, "geometry_type": gt, "attributes": attrs},
        request=request,
    )
    db.commit()
    db.refresh(f)
    return to_out(f)


@router.patch("/{feature_id}", response_model=FeatureOut, summary="ویرایش عارضه / نام‌گذاری معبر")
def update_feature(
    feature_id: uuid.UUID,
    data: FeatureUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    layer = _check_layer_editable(db, f.layer_id)
    if f.is_archived:
        raise HTTPException(400, "این عارضه آرشیو شده است؛ ابتدا آن را بازگردانی کنید.")

    before = dict(f.attributes or {})
    changed: list[str] = []

    if data.attributes is not None:
        patch = validate_attributes(db, layer.id, data.attributes, partial=True)
        merged = dict(before)
        for k, v in patch.items():
            if merged.get(k) != v:
                changed.append(k)
            merged[k] = v
        f.attributes = merged

    geom_changed = False
    geom_before = None
    if data.geometry is not None:
        geom_before = f.geom
        f.geom = geojson_to_sql(data.geometry, layer)
        geom_changed = True

    if not changed and not geom_changed:
        return to_out(f)

    f.version += 1
    f.updated_by_id = user.id
    f.updated_at = datetime.now(timezone.utc)

    db.add(
        FeatureRevision(
            feature_id=f.id,
            version=f.version,
            action="update",
            attributes_before=before,
            attributes_after=dict(f.attributes or {}),
            changed_fields=changed,
            geometry_changed=geom_changed,
            geom_before=geom_before,
            note=data.note,
            user_id=user.id,
        )
    )

    # خلاصه خوانا برای لاگ: عنوان فارسی ستون‌ها و مقدار قبل/بعد
    labels = {
        fd.key: fd.label for fd in db.query(FieldDef).filter(FieldDef.layer_id == layer.id).all()
    }
    parts = [
        f"{labels.get(k, k)}: «{before.get(k) or '—'}» ← «{(f.attributes or {}).get(k) or '—'}»"
        for k in changed
    ]
    if geom_changed:
        parts.append("هندسه روی نقشه اصلاح شد")
    log_action(
        db,
        action="feature_update",
        summary=f"عارضه «{feature_label(db, f)}»: " + "؛ ".join(parts),
        user=user,
        entity_type="feature",
        entity_id=f.id,
        payload={
            "layer": layer.name,
            "changed_fields": changed,
            "geometry_changed": geom_changed,
            "before": {k: before.get(k) for k in changed},
            "after": {k: (f.attributes or {}).get(k) for k in changed},
            "note": data.note,
        },
        request=request,
    )
    db.commit()
    db.refresh(f)
    return to_out(f)


@router.post("/bulk-field", summary="اعمال یک مقدار روی چند عارضه")
def bulk_set_field(
    data: BulkFieldUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    rows = db.query(Feature).filter(Feature.id.in_(data.feature_ids)).all()
    if not rows:
        raise HTTPException(404, "هیچ عارضه‌ای با این شناسه‌ها یافت نشد.")
    layer_ids = {r.layer_id for r in rows}
    if len(layer_ids) > 1:
        raise HTTPException(400, "عوارض انتخاب‌شده باید در یک لایه باشند.")
    layer = _check_layer_editable(db, layer_ids.pop())

    clean = validate_attributes(db, layer.id, {data.key: data.value}, partial=True)
    value = clean.get(data.key)

    n = 0
    for f in rows:
        if f.is_archived:
            continue
        before = dict(f.attributes or {})
        if before.get(data.key) == value:
            continue
        merged = dict(before)
        merged[data.key] = value
        f.attributes = merged
        f.version += 1
        f.updated_by_id = user.id
        db.add(
            FeatureRevision(
                feature_id=f.id, version=f.version, action="update",
                attributes_before=before, attributes_after=merged,
                changed_fields=[data.key], geometry_changed=False,
                note="ویرایش گروهی", user_id=user.id,
            )
        )
        n += 1

    fd = db.query(FieldDef).filter(FieldDef.layer_id == layer.id, FieldDef.key == data.key).one_or_none()
    log_action(
        db,
        action="feature_bulk_update",
        summary=f"ستون «{fd.label if fd else data.key}» برای {n} عارضه لایه «{layer.name}» روی «{value or '—'}» تنظیم شد",
        user=user, entity_type="feature", entity_id=None,
        payload={"layer": layer.name, "key": data.key, "value": value, "count": n,
                 "feature_ids": [str(i) for i in data.feature_ids]},
        request=request,
    )
    db.commit()
    return {"detail": f"{n} عارضه به‌روزرسانی شد.", "updated": n}


# ---------------------------------------------------------------- آرشیو


@router.post("/{feature_id}/archive", summary="آرشیو کردن عارضه")
def archive_feature(
    feature_id: uuid.UUID,
    data: ArchiveIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    if f.is_archived:
        raise HTTPException(400, "این عارضه از قبل آرشیو شده است.")

    f.is_archived = True
    f.archived_at = datetime.now(timezone.utc)
    f.archive_reason = data.reason
    f.version += 1
    f.updated_by_id = user.id
    label = feature_label(db, f)

    db.add(
        FeatureRevision(
            feature_id=f.id, version=f.version, action="archive",
            attributes_before=dict(f.attributes or {}), attributes_after=dict(f.attributes or {}),
            changed_fields=[], geometry_changed=False, note=data.reason, user_id=user.id,
        )
    )
    log_action(
        db, action="feature_archive",
        summary=f"عارضه «{label}» آرشیو شد" + (f" — دلیل: {data.reason}" if data.reason else ""),
        user=user, entity_type="feature", entity_id=f.id,
        payload={"reason": data.reason}, request=request,
    )
    db.commit()
    return {"detail": f"عارضه «{label}» آرشیو شد."}


@router.post("/{feature_id}/restore", summary="بازگردانی عارضه از آرشیو")
def restore_feature(
    feature_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    if not f.is_archived:
        raise HTTPException(400, "این عارضه در آرشیو نیست.")

    f.is_archived = False
    f.archived_at = None
    f.archive_reason = None
    f.version += 1
    f.updated_by_id = user.id
    label = feature_label(db, f)

    db.add(
        FeatureRevision(
            feature_id=f.id, version=f.version, action="restore",
            attributes_before=dict(f.attributes or {}), attributes_after=dict(f.attributes or {}),
            changed_fields=[], geometry_changed=False, user_id=user.id,
        )
    )
    log_action(
        db, action="feature_restore", summary=f"عارضه «{label}» از آرشیو بازگردانده شد",
        user=user, entity_type="feature", entity_id=f.id, request=request,
    )
    db.commit()
    return {"detail": f"عارضه «{label}» بازگردانده شد."}


@router.delete("/{feature_id}", summary="حذف قطعی عارضه (فقط مدیر)")
def delete_feature(
    feature_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    label = feature_label(db, f)
    log_action(
        db, action="feature_delete", summary=f"عارضه «{label}» به طور قطعی حذف شد",
        user=user, entity_type="feature", entity_id=f.id,
        payload={"attributes": dict(f.attributes or {})}, request=request,
    )
    db.delete(f)
    db.commit()
    return {"detail": f"عارضه «{label}» حذف شد."}


# ---------------------------------------------------------------- تاریخچه


@router.get("/{feature_id}/history", response_model=list[RevisionOut], summary="تاریخچه تغییرات عارضه")
def feature_history(
    feature_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    f = db.get(Feature, feature_id)
    if not f:
        raise HTTPException(404, "عارضه یافت نشد.")
    revs = (
        db.query(FeatureRevision)
        .filter(FeatureRevision.feature_id == feature_id)
        .order_by(FeatureRevision.version.desc())
        .all()
    )
    out = []
    for r in revs:
        item = RevisionOut.model_validate(r)
        item.user_name = (r.user.full_name or r.user.username) if r.user else "نامشخص"
        out.append(item)
    return out
