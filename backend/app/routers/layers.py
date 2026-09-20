"""مدیریت لایه‌ها و ستون‌های جدول توصیفی (معادل Fields در ArcGIS)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import get_current_user_optional, require_admin, require_editor
from ..models import Feature, FieldDef, FieldType, GeomType, Layer, Role, User
from ..schemas import (
    ArchiveIn,
    FieldDefCreateIn,
    FieldDefOut,
    FieldDefUpdateIn,
    LayerCreateIn,
    LayerOut,
    LayerUpdateIn,
)
from ..services.shapefile import slugify_key

router = APIRouter(prefix="/api/layers", tags=["لایه‌ها و جدول توصیفی"])


def _counts(db: Session) -> dict[uuid.UUID, int]:
    rows = db.execute(
        select(Feature.layer_id, func.count())
        .where(Feature.is_archived.is_(False))
        .group_by(Feature.layer_id)
    ).all()
    return {r[0]: r[1] for r in rows}


def _unique_slug(db: Session, base: str) -> str:
    slug = slugify_key(base).replace("_", "-")[:70] or "layer"
    candidate, i = slug, 2
    while db.query(Layer).filter(Layer.slug == candidate).first():
        candidate = f"{slug}-{i}"
        i += 1
    return candidate


@router.get("", response_model=list[LayerOut], summary="فهرست لایه‌ها")
def list_layers(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    q = db.query(Layer)
    # کاربر عمومی فقط لایه‌های عمومی و آرشیو‌نشده را می‌بیند
    if user is None:
        q = q.filter(Layer.is_visible_public.is_(True), Layer.is_archived.is_(False))
    elif not include_archived:
        q = q.filter(Layer.is_archived.is_(False))

    layers = q.order_by(Layer.created_at.asc()).all()
    counts = _counts(db)
    out = []
    for lay in layers:
        item = LayerOut.model_validate(lay)
        item.feature_count = counts.get(lay.id, 0)
        out.append(item)
    return out


@router.post("", response_model=LayerOut, status_code=201, summary="ایجاد لایه جدید")
def create_layer(
    data: LayerCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    slug = data.slug or _unique_slug(db, data.name)
    if db.query(Layer).filter(Layer.slug == slug).first():
        raise HTTPException(409, f"شناسه لایه «{slug}» تکراری است.")

    layer = Layer(
        name=data.name.strip(),
        slug=slug,
        description=data.description,
        geom_type=data.geom_type,
        style=data.style or {},
        label_field=data.label_field,
        is_visible_public=data.is_visible_public,
        created_by_id=user.id,
    )
    db.add(layer)
    db.flush()
    log_action(
        db, action="layer_create", summary=f"لایه «{layer.name}» ایجاد شد",
        user=user, entity_type="layer", entity_id=layer.id,
        payload={"name": layer.name, "geom_type": layer.geom_type.value}, request=request,
    )
    db.commit()
    db.refresh(layer)
    return LayerOut.model_validate(layer)


@router.get("/{layer_id}", response_model=LayerOut, summary="جزئیات لایه")
def get_layer(
    layer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")
    item = LayerOut.model_validate(layer)
    item.feature_count = _counts(db).get(layer.id, 0)
    return item


@router.patch("/{layer_id}", response_model=LayerOut, summary="ویرایش لایه")
def update_layer(
    layer_id: uuid.UUID,
    data: LayerUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")

    changes = {}
    for field in ("name", "description", "style", "label_field", "is_visible_public"):
        new = getattr(data, field)
        if new is not None and new != getattr(layer, field):
            changes[field] = [getattr(layer, field), new]
            setattr(layer, field, new)

    if changes:
        log_action(
            db, action="layer_update", summary=f"لایه «{layer.name}» ویرایش شد",
            user=user, entity_type="layer", entity_id=layer.id,
            payload={"changes": changes}, request=request,
        )
    db.commit()
    db.refresh(layer)
    item = LayerOut.model_validate(layer)
    item.feature_count = _counts(db).get(layer.id, 0)
    return item


@router.post("/{layer_id}/archive", summary="آرشیو کردن لایه")
def archive_layer(
    layer_id: uuid.UUID,
    data: ArchiveIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if layer.is_archived:
        raise HTTPException(400, "این لایه از قبل آرشیو شده است.")
    layer.is_archived = True
    layer.archived_at = datetime.now(timezone.utc)
    log_action(
        db, action="layer_archive", summary=f"لایه «{layer.name}» آرشیو شد",
        user=user, entity_type="layer", entity_id=layer.id,
        payload={"reason": data.reason}, request=request,
    )
    db.commit()
    return {"detail": f"لایه «{layer.name}» آرشیو شد."}


@router.post("/{layer_id}/restore", summary="بازگردانی لایه از آرشیو")
def restore_layer(
    layer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    layer.is_archived = False
    layer.archived_at = None
    log_action(
        db, action="layer_restore", summary=f"لایه «{layer.name}» از آرشیو بازگردانده شد",
        user=user, entity_type="layer", entity_id=layer.id, request=request,
    )
    db.commit()
    return {"detail": f"لایه «{layer.name}» بازگردانده شد."}


@router.delete("/{layer_id}", summary="حذف کامل لایه (فقط مدیر)")
def delete_layer(
    layer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    name = layer.name
    n = db.query(Feature).filter(Feature.layer_id == layer.id).count()
    log_action(
        db, action="layer_delete",
        summary=f"لایه «{name}» با {n} عارضه به طور کامل حذف شد",
        user=user, entity_type="layer", entity_id=layer.id,
        payload={"name": name, "feature_count": n}, request=request,
    )
    db.delete(layer)
    db.commit()
    return {"detail": f"لایه «{name}» حذف شد."}


# ================================================================ ستون‌ها


@router.get("/{layer_id}/fields", response_model=list[FieldDefOut], summary="ستون‌های جدول توصیفی")
def list_fields(
    layer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")
    if user is None and (not layer.is_visible_public or layer.is_archived):
        raise HTTPException(404, "لایه یافت نشد.")
    return (
        db.query(FieldDef)
        .filter(FieldDef.layer_id == layer_id)
        .order_by(FieldDef.sort_order, FieldDef.created_at)
        .all()
    )


@router.post(
    "/{layer_id}/fields",
    response_model=FieldDefOut,
    status_code=201,
    summary="افزودن ستون جدید به جدول توصیفی",
)
def create_field(
    layer_id: uuid.UUID,
    data: FieldDefCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    """ستون جدید برای همه عوارض لایه اضافه می‌کند — مانند Add Field در ArcGIS."""
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(404, "لایه یافت نشد.")

    existing = [f.key for f in db.query(FieldDef).filter(FieldDef.layer_id == layer_id).all()]
    key = data.key or slugify_key(data.label, existing)
    if key in existing:
        raise HTTPException(409, f"ستونی با شناسه «{key}» در این لایه وجود دارد.")
    if data.data_type == FieldType.SELECT and not data.options:
        raise HTTPException(400, "برای ستون از نوع «فهرست بازشو» باید حداقل یک گزینه تعریف کنید.")

    if data.sort_order:
        order = data.sort_order
    else:
        max_order = (
            db.query(func.coalesce(func.max(FieldDef.sort_order), 0))
            .filter(FieldDef.layer_id == layer_id)
            .scalar()
        )
        order = int(max_order or 0) + 1

    fd = FieldDef(
        layer_id=layer_id,
        key=key,
        label=data.label.strip(),
        data_type=data.data_type,
        options=data.options,
        is_required=data.is_required,
        is_searchable=data.is_searchable,
        default_value=data.default_value,
        unit=data.unit,
        sort_order=order,
    )
    db.add(fd)

    # مقدار پیش‌فرض روی عوارض موجود نوشته می‌شود تا ستون در جدول دیده شود
    affected = 0
    if data.default_value not in (None, ""):
        # jsonb_build_object تضمین می‌کند مقدار به صورت شیء JSON ساخته شود،
        # نه رشته JSON (که در آن صورت «||» جای ادغام، آرایه می‌سازد).
        patch = func.jsonb_build_object(key, data.default_value)
        affected = (
            db.query(Feature)
            .filter(Feature.layer_id == layer_id)
            .update(
                {Feature.attributes: Feature.attributes.op("||")(patch)},
                synchronize_session=False,
            )
        )

    db.flush()
    log_action(
        db,
        action="field_create",
        summary=f"ستون «{fd.label}» به جدول توصیفی لایه «{layer.name}» افزوده شد",
        user=user,
        entity_type="field",
        entity_id=fd.id,
        payload={
            "layer": layer.name,
            "key": key,
            "label": fd.label,
            "data_type": fd.data_type.value,
            "features_updated": affected,
        },
        request=request,
    )
    db.commit()
    db.refresh(fd)
    return fd


@router.patch("/{layer_id}/fields/{field_id}", response_model=FieldDefOut, summary="ویرایش ستون")
def update_field(
    layer_id: uuid.UUID,
    field_id: uuid.UUID,
    data: FieldDefUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    fd = db.query(FieldDef).filter(FieldDef.id == field_id, FieldDef.layer_id == layer_id).one_or_none()
    if not fd:
        raise HTTPException(404, "ستون یافت نشد.")

    changes = {}
    for field in ("label", "options", "is_required", "is_searchable", "default_value", "unit", "sort_order"):
        new = getattr(data, field)
        if new is not None and new != getattr(fd, field):
            changes[field] = [getattr(fd, field), new]
            setattr(fd, field, new)

    if changes:
        log_action(
            db, action="field_update", summary=f"ستون «{fd.label}» ویرایش شد",
            user=user, entity_type="field", entity_id=fd.id,
            payload={"key": fd.key, "changes": changes}, request=request,
        )
    db.commit()
    db.refresh(fd)
    return fd


@router.delete("/{layer_id}/fields/{field_id}", summary="حذف ستون از جدول توصیفی")
def delete_field(
    layer_id: uuid.UUID,
    field_id: uuid.UUID,
    request: Request,
    purge_values: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    fd = db.query(FieldDef).filter(FieldDef.id == field_id, FieldDef.layer_id == layer_id).one_or_none()
    if not fd:
        raise HTTPException(404, "ستون یافت نشد.")
    if fd.is_system:
        raise HTTPException(400, f"ستون «{fd.label}» ستون سیستمی است و حذف نمی‌شود.")

    label, key = fd.label, fd.key
    affected = 0
    if purge_values:
        # مقدار این کلید از JSON همه عوارض حذف می‌شود
        affected = (
            db.query(Feature)
            .filter(Feature.layer_id == layer_id, Feature.attributes.has_key(key))
            .update({Feature.attributes: Feature.attributes.op("-")(key)}, synchronize_session=False)
        )

    log_action(
        db, action="field_delete",
        summary=f"ستون «{label}» از جدول توصیفی حذف شد",
        user=user, entity_type="field", entity_id=fd.id,
        payload={"key": key, "label": label, "values_removed": affected}, request=request,
    )
    db.delete(fd)
    db.commit()
    return {"detail": f"ستون «{label}» حذف شد.", "values_removed": affected}
