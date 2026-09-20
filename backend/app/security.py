"""رمزنگاری گذرواژه و ساخت/اعتبارسنجی توکن."""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt

from .config import settings

ALGORITHM = "HS256"
BCRYPT_ROUNDS = 12


def _to_bytes(raw: str) -> bytes:
    """bcrypt فقط ۷۲ بایت نخست را در نظر می‌گیرد؛ برش روی بایت انجام می‌شود
    تا نویسه‌های چندبایتی فارسی نیم‌بُر نشوند."""
    return raw.encode("utf-8")[:72]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_to_bytes(raw), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bytes(raw), hashed.encode())
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, extra: Optional[dict[str, Any]] = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


PASSWORD_RULES = "گذرواژه باید حداقل ۸ نویسه و شامل حرف و رقم باشد."


def validate_password_strength(raw: str) -> Optional[str]:
    """در صورت ضعیف بودن، پیام خطا برمی‌گرداند."""
    if len(raw) < 8:
        return PASSWORD_RULES
    if not any(c.isdigit() for c in raw) or not any(c.isalpha() for c in raw):
        return PASSWORD_RULES
    return None
