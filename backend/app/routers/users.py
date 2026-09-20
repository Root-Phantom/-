"""مدیریت کاربران و سطوح دسترسی — فقط مدیر."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..audit import log_action
from ..db import get_db
from ..deps import require_admin
from ..models import Role, User
from ..schemas import Paginated, UserCreateIn, UserOut, UserUpdateIn
from ..security import hash_password, validate_password_strength

router = APIRouter(prefix="/api/users", tags=["مدیریت کاربران"])

ROLE_LABELS = {
    Role.ADMIN: "مدیر کل",
    Role.EDITOR: "کارشناس (ویرایشگر)",
    Role.VIEWER: "کاربر مشاهده‌کننده",
}


@router.get("/roles", summary="فهرست سطوح دسترسی")
def list_roles(_: User = Depends(require_admin)):
    return [
        {"value": r.value, "label": ROLE_LABELS[r], "description": desc}
        for r, desc in [
            (Role.ADMIN, "دسترسی کامل: ویرایش داده‌ها، تعریف ستون، مدیریت کاربران و مشاهده لاگ"),
            (Role.EDITOR, "ویرایش عوارض و جدول توصیفی، بدون مدیریت کاربران"),
            (Role.VIEWER, "فقط مشاهده اطلاعات پس از ورود"),
        ]
    ]


@router.get("", response_model=Paginated, summary="فهرست کاربران")
def list_users(
    q: Optional[str] = None,
    role: Optional[Role] = None,
    is_active: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(User.username.ilike(like), User.full_name.ilike(like), User.email.ilike(like))
        )
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active.is_(is_active))

    total = query.count()
    rows = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Paginated(
        total=total,
        page=page,
        page_size=page_size,
        items=[UserOut.model_validate(u).model_dump(mode="json") for u in rows],
    )


@router.post("", response_model=UserOut, status_code=201, summary="تعریف کاربر جدید")
def create_user(
    data: UserCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    uname = data.username.strip()
    if db.query(User).filter(User.username == uname).first():
        raise HTTPException(409, f"نام کاربری «{uname}» قبلاً ثبت شده است.")
    if err := validate_password_strength(data.password):
        raise HTTPException(400, err)

    user = User(
        username=uname,
        password_hash=hash_password(data.password),
        full_name=data.full_name.strip(),
        email=(data.email or "").strip() or None,
        phone=(data.phone or "").strip() or None,
        role=data.role,
        is_active=data.is_active,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    log_action(
        db,
        action="user_create",
        summary=f"کاربر «{uname}» با سطح دسترسی «{ROLE_LABELS[data.role]}» ایجاد شد",
        user=admin,
        entity_type="user",
        entity_id=user.id,
        payload={"username": uname, "role": data.role.value, "full_name": user.full_name},
        request=request,
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut, summary="جزئیات کاربر")
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "کاربر یافت نشد.")
    return user


@router.patch("/{user_id}", response_model=UserOut, summary="ویرایش کاربر / تغییر سطح دسترسی")
def update_user(
    user_id: uuid.UUID,
    data: UserUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "کاربر یافت نشد.")

    changes: dict[str, list] = {}

    def track(field: str, new):
        old = getattr(user, field)
        old_cmp = old.value if isinstance(old, Role) else old
        if new is not None and new != old_cmp and new != old:
            changes[field] = [old_cmp, new.value if isinstance(new, Role) else new]
            setattr(user, field, new)

    # محافظت: مدیر نمی‌تواند نقش یا فعال‌بودن خودش را تغییر دهد (قفل‌شدن حساب)
    if user.id == admin.id:
        if data.role is not None and data.role != user.role:
            raise HTTPException(400, "تغییر سطح دسترسی حساب خودتان مجاز نیست.")
        if data.is_active is False:
            raise HTTPException(400, "غیرفعال‌کردن حساب خودتان مجاز نیست.")

    # محافظت: همیشه باید حداقل یک مدیر فعال باقی بماند
    if user.role == Role.ADMIN and (data.role not in (None, Role.ADMIN) or data.is_active is False):
        remaining = (
            db.query(User)
            .filter(User.role == Role.ADMIN, User.is_active.is_(True), User.id != user.id)
            .count()
        )
        if remaining == 0:
            raise HTTPException(400, "سامانه باید حداقل یک مدیر فعال داشته باشد.")

    track("full_name", data.full_name.strip() if data.full_name is not None else None)
    track("email", (data.email or "").strip() or None if data.email is not None else None)
    track("phone", (data.phone or "").strip() or None if data.phone is not None else None)
    track("role", data.role)
    track("is_active", data.is_active)

    if data.password:
        if err := validate_password_strength(data.password):
            raise HTTPException(400, err)
        user.password_hash = hash_password(data.password)
        user.must_change_password = True
        changes["password"] = ["***", "***"]

    if changes:
        parts = []
        if "role" in changes:
            parts.append(f"سطح دسترسی به «{ROLE_LABELS[Role(changes['role'][1])]}»")
        if "is_active" in changes:
            parts.append("فعال شد" if changes["is_active"][1] else "غیرفعال شد")
        if "password" in changes:
            parts.append("گذرواژه بازنشانی شد")
        detail = "، ".join(parts) if parts else "اطلاعات پروفایل ویرایش شد"
        log_action(
            db,
            action="user_update",
            summary=f"کاربر «{user.username}»: {detail}",
            user=admin,
            entity_type="user",
            entity_id=user.id,
            payload={"changes": changes},
            request=request,
        )
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", summary="حذف کاربر")
def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "کاربر یافت نشد.")
    if user.id == admin.id:
        raise HTTPException(400, "حذف حساب خودتان مجاز نیست.")
    if user.role == Role.ADMIN:
        remaining = (
            db.query(User)
            .filter(User.role == Role.ADMIN, User.is_active.is_(True), User.id != user.id)
            .count()
        )
        if remaining == 0:
            raise HTTPException(400, "سامانه باید حداقل یک مدیر فعال داشته باشد.")

    uname = user.username
    log_action(
        db, action="user_delete", summary=f"کاربر «{uname}» حذف شد",
        user=admin, entity_type="user", entity_id=user.id,
        payload={"username": uname, "role": user.role.value}, request=request,
    )
    db.delete(user)
    db.commit()
    return {"detail": f"کاربر «{uname}» حذف شد."}
