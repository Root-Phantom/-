"""جست‌وجوی حرفه‌ای در جدول توصیفی."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import get_current_user_optional
from ..models import Feature, FieldDef, Layer, User
from ..schemas import SearchRequest, SearchResponse
from ..services.query_builder import META_FIELDS, apply_search
from .features import to_out

router = APIRouter(prefix="/api/search", tags=["جست‌وجو"])

OPERATORS = [
    {"value": "contains", "label": "شامل باشد", "types": ["text", "select"]},
    {"value": "not_contains", "label": "شامل نباشد", "types": ["text", "select"]},
    {"value": "eq", "label": "برابر باشد", "types": ["text", "number", "integer", "date", "boolean", "select"]},
    {"value": "ne", "label": "برابر نباشد", "types": ["text", "number", "integer", "date", "boolean", "select"]},
    {"value": "starts_with", "label": "شروع شود با", "types": ["text", "select"]},
    {"value": "ends_with", "label": "پایان یابد با", "types": ["text", "select"]},
    {"value": "gt", "label": "بزرگ‌تر از", "types": ["number", "integer", "date"]},
    {"value": "gte", "label": "بزرگ‌تر یا مساوی", "types": ["number", "integer", "date"]},
    {"value": "lt", "label": "کوچک‌تر از", "types": ["number", "integer", "date"]},
    {"value": "lte", "label": "کوچک‌تر یا مساوی", "types": ["number", "integer", "date"]},
    {"value": "between", "label": "بین دو مقدار", "types": ["number", "integer", "date"]},
    {"value": "in", "label": "یکی از مقادیر", "types": ["text", "number", "integer", "select"]},
    {"value": "is_empty", "label": "خالی باشد", "types": ["text", "number", "integer", "date", "boolean", "select"]},
    {"value": "is_not_empty", "label": "خالی نباشد", "types": ["text", "number", "integer", "date", "boolean", "select"]},
]


@router.get("/operators", summary="فهرست عملگرهای جست‌وجو")
def operators():
    return OPERATORS


@router.post("", response_model=SearchResponse, summary="جست‌وجو در جدول توصیفی")
def search(
    req: SearchRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    # کاربر عمومی به آرشیو دسترسی ندارد
    public_only = user is None
    if public_only:
        req.include_archived = False

    stmt = apply_search(db, req, public_only=public_only)

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()

    rows = (
        db.execute(stmt.offset((req.page - 1) * req.page_size).limit(req.page_size))
        .scalars()
        .all()
    )

    # جست‌وجوها هم در لاگ ثبت می‌شوند (بدون شلوغ‌کردن لاگ: فقط جست‌وجوهای واقعی)
    if req.q or req.conditions:
        log_action(
            db,
            action="search",
            summary=f"جست‌وجو در جدول توصیفی — {total} نتیجه",
            user=user,
            entity_type="layer",
            entity_id=req.layer_id,
            payload={
                "q": req.q,
                "conditions": [c.model_dump() for c in req.conditions],
                "logic": req.logic,
                "result_count": total,
            },
            request=request,
            commit=True,
        )

    return SearchResponse(
        total=total,
        page=req.page,
        page_size=req.page_size,
        items=[to_out(f, include_geometry=req.include_geometry, public=public_only) for f in rows],
    )


@router.get("/fields", summary="ستون‌های قابل جست‌وجو یک لایه")
def searchable_fields(
    layer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")

    fields = [
        {
            "key": f.key,
            "label": f.label,
            "data_type": f.data_type.value,
            "options": f.options,
            "unit": f.unit,
        }
        for f in db.query(FieldDef)
        .filter(FieldDef.layer_id == layer_id, FieldDef.is_searchable.is_(True))
        .order_by(FieldDef.sort_order)
        .all()
    ]
    # ستون‌های فرا‌داده‌ای
    fields += [
        {"key": "__created_at", "label": "تاریخ ایجاد", "data_type": "date", "options": [], "unit": None},
        {"key": "__updated_at", "label": "تاریخ آخرین ویرایش", "data_type": "date", "options": [], "unit": None},
        {"key": "__version", "label": "شماره نسخه", "data_type": "integer", "options": [], "unit": None},
    ]
    return fields


@router.get("/distinct", summary="مقادیر یکتای یک ستون (برای فهرست بازشو جست‌وجو)")
def distinct_values(
    layer_id: uuid.UUID,
    key: str,
    limit: int = 300,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")
    if key not in {f.key for f in db.query(FieldDef).filter(FieldDef.layer_id == layer_id)}:
        raise HTTPException(400, f"ستون «{key}» وجود ندارد.")

    txt = Feature.attributes[key].astext
    rows = db.execute(
        select(txt, func.count())
        .where(Feature.layer_id == layer_id, Feature.is_archived.is_(False), txt.isnot(None), txt != "")
        .group_by(txt)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()
    return [{"value": r[0], "count": r[1]} for r in rows]
