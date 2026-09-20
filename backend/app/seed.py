"""ساخت جداول و کاربر مدیر اولیه."""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine, ensure_extensions
from .models import Role, User
from .security import hash_password

log = logging.getLogger("pol.seed")


def init_db() -> None:
    """افزونه‌ها و جداول را ایجاد می‌کند (idempotent)."""
    ensure_extensions()
    Base.metadata.create_all(bind=engine)
    log.info("جداول پایگاه داده آماده است.")


def create_first_admin() -> None:
    """اگر هیچ مدیری وجود ندارد، مدیر اولیه را از تنظیمات می‌سازد."""
    db: Session = SessionLocal()
    try:
        if db.query(User).filter(User.role == Role.ADMIN).count() > 0:
            return
        if not settings.FIRST_ADMIN_PASSWORD:
            log.error("هیچ مدیری وجود ندارد و FIRST_ADMIN_PASSWORD در .env خالی است؛ مدیر اولیه ساخته نشد.")
            return
        admin = User(
            username=settings.FIRST_ADMIN_USERNAME,
            password_hash=hash_password(settings.FIRST_ADMIN_PASSWORD),
            full_name=settings.FIRST_ADMIN_FULLNAME,
            role=Role.ADMIN,
            is_active=True,
            # کاربر در نخستین ورود باید گذرواژه را تغییر دهد
            must_change_password=True,
        )
        db.add(admin)
        db.commit()
        log.warning(
            "کاربر مدیر اولیه ساخته شد: %s — گذرواژه را پس از نخستین ورود تغییر دهید.",
            settings.FIRST_ADMIN_USERNAME,
        )
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    create_first_admin()
    print("پایگاه داده آماده شد.")
