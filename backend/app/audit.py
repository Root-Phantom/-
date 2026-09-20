"""سرویس ثبت لاگ سامانه."""
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from .config import settings
from .models import AuditLog, User


def _client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    # پشت پروکسی معکوس (IIS/ARR) آدرس واقعی کاربر در این هدر است
    if settings.TRUST_PROXY_HEADERS:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            ip = fwd.split(",")[0].strip()
            # IIS/ARR ممکن است شماره پورت را هم اضافه کند (1.2.3.4:5678)
            if ip.count(":") == 1:
                ip = ip.split(":")[0]
            return ip
    return request.client.host if request.client else None


def log_action(
    db: Session,
    *,
    action: str,
    summary: str,
    user: Optional[User] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[Any] = None,
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
    status: str = "success",
    commit: bool = False,
) -> AuditLog:
    """یک رویداد را در لاگ ثبت می‌کند.

    به صورت پیش‌فرض commit نمی‌کند تا لاگ در همان تراکنش عملیات اصلی ذخیره شود.
    """
    entry = AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else "مهمان",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        summary=summary,
        payload=payload,
        ip_address=_client_ip(request),
        user_agent=(request.headers.get("user-agent") if request else None),
        method=request.method if request else None,
        path=str(request.url.path) if request else None,
        status=status,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry
