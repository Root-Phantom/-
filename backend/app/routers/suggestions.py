"""پیشنهاد نام معابر توسط کاربر عمومی و بررسی آن توسط مدیر."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import _client_ip, log_action
from ..db import get_db
from ..deps import get_current_user_optional, require_editor
from ..models import (
    Feature,
    FeatureRevision,
    FieldDef,
    Layer,
    NameSuggestion,
    SuggestionStatus,
    User,
)
from ..schemas import Paginated, SuggestionCreateIn, SuggestionOut, SuggestionReviewIn
from .features import feature_label

router = APIRouter(prefix="/api/suggestions", tags=["پیشنهاد نام"])

# سقف تعداد پیشنهاد از یک IP در یک ساعت (جلوگیری از ارسال انبوه)
RATE_LIMIT_PER_HOUR = 10


def _out(db: Session, s: NameSuggestion) -> SuggestionOut:
    item = SuggestionOut.model_validate(s)
    item.reviewed_by_name = (
        (s.reviewed_by.full_name or s.reviewed_by.username) if s.reviewed_by else None
    )
    if s.feature:
        item.feature_label = feature_label(db, s.feature)
    return item


@router.post("", response_model=SuggestionOut, status_code=201, summary="ثبت پیشنهاد نام (کاربر عمومی)")
def create_suggestion(
    data: SuggestionCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """کاربر عمومی بدون ورود به سامانه می‌تواند برای یک معبر نام پیشنهاد دهد."""
    feature = None
    if data.feature_id:
        feature = db.get(Feature, data.feature_id)
        if not feature:
            raise HTTPException(404, "معبر انتخاب‌شده یافت نشد.")
        if feature.is_archived:
            raise HTTPException(400, "این معبر آرشیو شده است و پیشنهاد برای آن پذیرفته نمی‌شود.")

    ip = _client_ip(request)
    if ip and user is None:
        recent = (
            db.query(NameSuggestion)
            .filter(
                NameSuggestion.submitter_ip == ip,
                NameSuggestion.created_at > datetime.now(timezone.utc) - timedelta(hours=1),
            )
            .count()
        )
        if recent >= RATE_LIMIT_PER_HOUR:
            raise HTTPException(
                429, "تعداد پیشنهادهای ارسالی شما زیاد است. لطفاً بعداً دوباره تلاش کنید."
            )

    s = NameSuggestion(
        feature_id=data.feature_id,
        suggested_name=data.suggested_name.strip(),
        reason=(data.reason or "").strip() or None,
        submitter_name=(data.submitter_name or "").strip() or None,
        submitter_phone=(data.submitter_phone or "").strip() or None,
        submitter_ip=ip,
        status=SuggestionStatus.PENDING,
    )
    db.add(s)
    db.flush()

    target = f" برای «{feature_label(db, feature)}»" if feature else ""
    log_action(
        db,
        action="suggestion_create",
        summary=f"پیشنهاد نام «{s.suggested_name}»{target} ثبت شد"
        + (f" توسط {s.submitter_name}" if s.submitter_name else " توسط کاربر عمومی"),
        user=user,
        entity_type="suggestion",
        entity_id=s.id,
        payload={
            "suggested_name": s.suggested_name,
            "feature_id": str(data.feature_id) if data.feature_id else None,
            "submitter_name": s.submitter_name,
            "submitter_phone": s.submitter_phone,
        },
        request=request,
    )
    db.commit()
    db.refresh(s)
    return _out(db, s)


@router.get("", response_model=Paginated, summary="فهرست پیشنهادها (مدیر/کارشناس)")
def list_suggestions(
    status: Optional[SuggestionStatus] = None,
    feature_id: Optional[uuid.UUID] = None,
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    query = db.query(NameSuggestion)
    if status:
        query = query.filter(NameSuggestion.status == status)
    if feature_id:
        query = query.filter(NameSuggestion.feature_id == feature_id)
    if q:
        query = query.filter(NameSuggestion.suggested_name.ilike(f"%{q.strip()}%"))

    total = query.count()
    rows = (
        query.order_by(NameSuggestion.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Paginated(
        total=total,
        page=page,
        page_size=page_size,
        items=[_out(db, s).model_dump(mode="json") for s in rows],
    )


@router.get("/stats", summary="آمار پیشنهادها")
def stats(db: Session = Depends(get_db), _: User = Depends(require_editor)):
    rows = db.query(NameSuggestion.status, func.count()).group_by(NameSuggestion.status).all()
    counts = {s.value: 0 for s in SuggestionStatus}
    for st, n in rows:
        counts[st.value] = n
    return counts


@router.get("/public/count", summary="تعداد پیشنهادهای ثبت‌شده برای یک معبر (عمومی)")
def public_count(feature_id: uuid.UUID, db: Session = Depends(get_db)):
    """کاربر عمومی می‌تواند ببیند چند پیشنهاد برای این معبر ثبت شده است."""
    n = db.query(NameSuggestion).filter(NameSuggestion.feature_id == feature_id).count()
    approved = (
        db.query(NameSuggestion)
        .filter(
            NameSuggestion.feature_id == feature_id,
            NameSuggestion.status == SuggestionStatus.APPROVED,
        )
        .count()
    )
    return {"total": n, "approved": approved}


@router.post("/{suggestion_id}/review", response_model=SuggestionOut, summary="بررسی پیشنهاد (تأیید/رد)")
def review_suggestion(
    suggestion_id: uuid.UUID,
    data: SuggestionReviewIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    s = db.get(NameSuggestion, suggestion_id)
    if not s:
        raise HTTPException(404, "پیشنهاد یافت نشد.")
    if s.status != SuggestionStatus.PENDING:
        raise HTTPException(400, "این پیشنهاد قبلاً بررسی شده است.")

    new_status = SuggestionStatus(data.status)
    s.status = new_status
    s.admin_note = (data.admin_note or "").strip() or None
    s.reviewed_by_id = user.id
    s.reviewed_at = datetime.now(timezone.utc)

    applied_note = ""
    # در صورت تأیید، نام پیشنهادی می‌تواند مستقیماً روی ستون معبر اعمال شود
    if new_status == SuggestionStatus.APPROVED and data.apply_to_field and s.feature_id:
        feature = db.get(Feature, s.feature_id)
        if not feature:
            raise HTTPException(404, "معبر مربوط به این پیشنهاد یافت نشد.")
        fd = (
            db.query(FieldDef)
            .filter(FieldDef.layer_id == feature.layer_id, FieldDef.key == data.apply_to_field)
            .one_or_none()
        )
        if not fd:
            raise HTTPException(400, f"ستون «{data.apply_to_field}» در جدول توصیفی وجود ندارد.")

        before = dict(feature.attributes or {})
        merged = dict(before)
        merged[fd.key] = s.suggested_name
        feature.attributes = merged
        feature.version += 1
        feature.updated_by_id = user.id
        db.add(
            FeatureRevision(
                feature_id=feature.id,
                version=feature.version,
                action="update",
                attributes_before=before,
                attributes_after=merged,
                changed_fields=[fd.key],
                geometry_changed=False,
                note=f"اعمال پیشنهاد نام تأییدشده (شناسه پیشنهاد: {s.id})",
                user_id=user.id,
            )
        )
        applied_note = f" و در ستون «{fd.label}» ثبت شد"

    label = f" برای «{feature_label(db, s.feature)}»" if s.feature else ""
    verb = "تأیید" if new_status == SuggestionStatus.APPROVED else "رد"
    log_action(
        db,
        action=f"suggestion_{new_status.value}",
        summary=f"پیشنهاد نام «{s.suggested_name}»{label} {verb} شد{applied_note}",
        user=user,
        entity_type="suggestion",
        entity_id=s.id,
        payload={
            "suggested_name": s.suggested_name,
            "status": new_status.value,
            "admin_note": s.admin_note,
            "applied_to_field": data.apply_to_field,
        },
        request=request,
    )
    db.commit()
    db.refresh(s)
    return _out(db, s)


@router.delete("/{suggestion_id}", summary="حذف پیشنهاد")
def delete_suggestion(
    suggestion_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    s = db.get(NameSuggestion, suggestion_id)
    if not s:
        raise HTTPException(404, "پیشنهاد یافت نشد.")
    name = s.suggested_name
    log_action(
        db, action="suggestion_delete", summary=f"پیشنهاد نام «{name}» حذف شد",
        user=user, entity_type="suggestion", entity_id=s.id, request=request,
    )
    db.delete(s)
    db.commit()
    return {"detail": f"پیشنهاد «{name}» حذف شد."}
