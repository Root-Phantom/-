"""ورود، خروج و اطلاعات کاربر جاری."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..audit import _client_ip, log_action
from ..config import settings
from ..db import get_db
from ..deps import get_current_user, get_current_user_optional
from ..models import AuditLog, Role, User
from ..schemas import ChangePasswordIn, LoginIn, UserOut
from ..security import (
    create_access_token,
    hash_password,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["احراز هویت"])

# حداکثر تلاش ناموفق ورود در بازه زمانی مشخص: برای یک نام کاربری از یک IP،
# و سقف بالاتر برای کل IP (کارکنان یک اداره معمولاً پشت یک IP مشترک هستند)
MAX_FAILED_LOGINS = 10
MAX_FAILED_LOGINS_PER_IP = 50
FAILED_LOGIN_WINDOW = timedelta(minutes=15)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


@router.post("/login", response_model=UserOut, summary="ورود به سامانه")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    if ip:
        failures = db.query(AuditLog).filter(
            AuditLog.action == "login_failed",
            AuditLog.ip_address == ip,
            AuditLog.created_at > datetime.now(timezone.utc) - FAILED_LOGIN_WINDOW,
        )
        if (
            failures.filter(AuditLog.entity_id == data.username).count() >= MAX_FAILED_LOGINS
            or failures.count() >= MAX_FAILED_LOGINS_PER_IP
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="تعداد تلاش‌های ناموفق زیاد است. ۱۵ دقیقه بعد دوباره تلاش کنید.",
            )

    user = db.query(User).filter(User.username == data.username.strip()).one_or_none()

    if user is None or not verify_password(data.password, user.password_hash):
        # تلاش ناموفق هم در لاگ ثبت می‌شود
        log_action(
            db,
            action="login_failed",
            summary=f"تلاش ناموفق برای ورود با نام کاربری «{data.username}»",
            entity_type="user",
            entity_id=data.username,
            request=request,
            status="failed",
            commit=True,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="نام کاربری یا گذرواژه نادرست است.",
        )

    if not user.is_active:
        log_action(
            db, action="login_blocked", summary=f"ورود کاربر غیرفعال «{user.username}»",
            user=user, entity_type="user", entity_id=user.id, request=request,
            status="failed", commit=True,
        )
        raise HTTPException(status_code=403, detail="حساب کاربری شما غیرفعال است.")

    user.last_login_at = datetime.now(timezone.utc)
    token = create_access_token(str(user.id), {"role": user.role.value, "username": user.username})
    _set_cookie(response, token)
    log_action(
        db, action="login", summary=f"«{user.full_name or user.username}» وارد سامانه شد",
        user=user, entity_type="user", entity_id=user.id, request=request,
    )
    db.commit()
    db.refresh(user)
    return user


@router.post("/logout", summary="خروج از سامانه")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    if user:
        log_action(
            db, action="logout", summary=f"«{user.full_name or user.username}» از سامانه خارج شد",
            user=user, entity_type="user", entity_id=user.id, request=request, commit=True,
        )
    response.delete_cookie(settings.COOKIE_NAME, path="/")
    return {"detail": "خروج انجام شد."}


@router.get("/me", summary="اطلاعات کاربر جاری")
def me(user: Optional[User] = Depends(get_current_user_optional)):
    """برای کاربر عمومی (بدون لاگین) مقدار authenticated=false برمی‌گردد."""
    if user is None:
        return {
            "authenticated": False,
            "role": "public",
            "permissions": {"view": True, "edit": False, "admin": False, "suggest": True},
        }
    return {
        "authenticated": True,
        "role": user.role.value,
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "permissions": {
            "view": True,
            "edit": user.can_edit,
            "admin": user.role == Role.ADMIN,
            "suggest": True,
        },
    }


@router.post("/change-password", summary="تغییر گذرواژه خود")
def change_password(
    data: ChangePasswordIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "گذرواژه کنونی نادرست است.")
    if err := validate_password_strength(data.new_password):
        raise HTTPException(400, err)
    user.password_hash = hash_password(data.new_password)
    user.must_change_password = False
    log_action(
        db, action="change_password", summary=f"«{user.username}» گذرواژه خود را تغییر داد",
        user=user, entity_type="user", entity_id=user.id, request=request,
    )
    db.commit()
    return {"detail": "گذرواژه با موفقیت تغییر کرد."}
