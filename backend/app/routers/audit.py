"""مشاهده لاگ سامانه — «چه کسی چه کاری انجام داد»."""
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import require_admin, require_editor
from ..models import AuditLog, FeatureRevision, User
from ..schemas import AuditLogOut, Paginated, RevisionOut

router = APIRouter(prefix="/api/audit", tags=["لاگ سامانه"])

ACTION_LABELS = {
    "login": "ورود به سامانه",
    "login_failed": "تلاش ناموفق ورود",
    "login_blocked": "ورود حساب غیرفعال",
    "logout": "خروج از سامانه",
    "change_password": "تغییر گذرواژه",
    "user_create": "ایجاد کاربر",
    "user_update": "ویرایش کاربر",
    "user_delete": "حذف کاربر",
    "layer_create": "ایجاد لایه",
    "layer_update": "ویرایش لایه",
    "layer_archive": "آرشیو لایه",
    "layer_restore": "بازگردانی لایه",
    "layer_delete": "حذف لایه",
    "field_create": "افزودن ستون",
    "field_update": "ویرایش ستون",
    "field_delete": "حذف ستون",
    "feature_create": "ایجاد عارضه",
    "feature_update": "ویرایش عارضه",
    "feature_bulk_update": "ویرایش گروهی",
    "feature_archive": "آرشیو عارضه",
    "feature_restore": "بازگردانی عارضه",
    "feature_delete": "حذف عارضه",
    "suggestion_create": "ثبت پیشنهاد نام",
    "suggestion_approved": "تأیید پیشنهاد",
    "suggestion_rejected": "رد پیشنهاد",
    "suggestion_delete": "حذف پیشنهاد",
    "search": "جست‌وجو",
    "shapefile_preview": "بررسی شیپ‌فایل",
    "shapefile_import": "درون‌ریزی شیپ‌فایل",
    "export": "خروجی گرفتن",
}


@router.get("/actions", summary="فهرست انواع رویداد")
def actions(_: User = Depends(require_admin)):
    return [{"value": k, "label": v} for k, v in ACTION_LABELS.items()]


def _filtered(db: Session, *, q, action, entity_type, entity_id, user_id, date_from, date_to, status):
    query = db.query(AuditLog)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(AuditLog.summary.ilike(like), AuditLog.username.ilike(like)))
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == str(entity_id))
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if status:
        query = query.filter(AuditLog.status == status)
    if date_from:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to:
        query = query.filter(AuditLog.created_at <= date_to)
    return query


@router.get("", response_model=Paginated, summary="فهرست لاگ سامانه")
def list_logs(
    q: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = _filtered(
        db, q=q, action=action, entity_type=entity_type, entity_id=entity_id,
        user_id=user_id, date_from=date_from, date_to=date_to, status=status,
    )
    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = []
    for r in rows:
        d = AuditLogOut.model_validate(r).model_dump(mode="json")
        d["action_label"] = ACTION_LABELS.get(r.action, r.action)
        items.append(d)
    return Paginated(total=total, page=page, page_size=page_size, items=items)


@router.get("/export", summary="خروجی CSV لاگ سامانه")
def export_logs(
    request: Request,
    q: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[uuid.UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(50000, ge=1, le=200000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    query = _filtered(
        db, q=q, action=action, entity_type=None, entity_id=None,
        user_id=user_id, date_from=date_from, date_to=date_to, status=None,
    )
    rows = query.order_by(AuditLog.created_at.desc()).limit(limit).all()

    buf = io.StringIO()
    buf.write("﻿")  # BOM تا اکسل فارسی را درست نشان دهد
    w = csv.writer(buf)
    w.writerow(["شناسه", "تاریخ و زمان", "کاربر", "نوع رویداد", "شرح", "نتیجه", "آدرس IP", "مسیر"])
    for r in rows:
        w.writerow([
            r.id,
            r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else "",
            r.username,
            ACTION_LABELS.get(r.action, r.action),
            r.summary,
            "موفق" if r.status == "success" else "ناموفق",
            r.ip_address or "",
            r.path or "",
        ])

    log_action(
        db, action="export", summary=f"خروجی CSV لاگ سامانه ({len(rows)} ردیف) گرفته شد",
        user=admin, entity_type="audit", request=request, commit=True,
    )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )


@router.get("/summary", summary="خلاصه فعالیت کاربران")
def summary(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """برای داشبورد مدیر: فعال‌ترین کاربران و پرتکرارترین رویدادها."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    by_user = db.execute(
        select(AuditLog.username, func.count())
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.username)
        .order_by(func.count().desc())
        .limit(20)
    ).all()
    by_action = db.execute(
        select(AuditLog.action, func.count())
        .where(AuditLog.created_at >= since)
        .group_by(AuditLog.action)
        .order_by(func.count().desc())
    ).all()
    return {
        "days": days,
        "total": db.query(AuditLog).filter(AuditLog.created_at >= since).count(),
        "by_user": [{"username": u, "count": n} for u, n in by_user],
        "by_action": [
            {"action": a, "label": ACTION_LABELS.get(a, a), "count": n} for a, n in by_action
        ],
    }


@router.get("/revisions", response_model=Paginated, summary="تاریخچه همه تغییرات عوارض")
def all_revisions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_editor),
):
    query = db.query(FeatureRevision)
    total = query.count()
    rows = (
        query.order_by(FeatureRevision.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = []
    for r in rows:
        d = RevisionOut.model_validate(r)
        d.user_name = (r.user.full_name or r.user.username) if r.user else "نامشخص"
        items.append(d.model_dump(mode="json"))
    return Paginated(total=total, page=page, page_size=page_size, items=items)
