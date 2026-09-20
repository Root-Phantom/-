"""وابستگی‌های FastAPI: کاربر جاری و کنترل سطح دسترسی."""
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Role, User
from .security import decode_token


def _token_from_request(request: Request) -> Optional[str]:
    # ۱) هدر Authorization
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    # ۲) کوکی امن (روش اصلی در رابط کاربری)
    return request.cookies.get(settings.COOKIE_NAME)


def get_current_user_optional(
    request: Request, db: Session = Depends(get_db)
) -> Optional[User]:
    """کاربر جاری یا None برای کاربر عمومی (بدون لاگین)."""
    token = _token_from_request(request)
    if not token:
        return None
    payload = decode_token(token)
    if not payload or not payload.get("sub"):
        return None
    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        return None
    return user


def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    """کاربر احرازهویت‌شده؛ در غیر این صورت خطای ۴۰۱."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="برای انجام این عملیات باید وارد سامانه شوید.",
        )
    return user


def require_editor(user: User = Depends(get_current_user)) -> User:
    """دسترسی ویرایش: مدیر یا کارشناس."""
    if not user.can_edit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="شما اجازه ویرایش اطلاعات را ندارید.",
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """دسترسی مدیریتی: فقط مدیر کل."""
    if user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="این بخش تنها در دسترس مدیر سامانه است.",
        )
    return user
