"""اتصال به پایگاه داده و Session."""
from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_extensions() -> None:
    """نصب افزونه‌های لازم پستگرس (PostGIS و pg_trgm).

    اگر کاربر پایگاه داده اجازه ساخت افزونه نداشته باشد و افزونه از قبل
    توسط postgres نصب شده باشد، خطا نادیده گرفته می‌شود.
    """
    for ext in ("postgis", "pg_trgm"):
        try:
            with engine.begin() as conn:
                conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext}"))
        except Exception as e:  # noqa: BLE001
            with engine.connect() as conn:
                exists = conn.execute(
                    text("SELECT 1 FROM pg_extension WHERE extname = :n"), {"n": ext}
                ).first()
            if not exists:
                raise RuntimeError(
                    f"افزونه {ext} نصب نیست و کاربر پایگاه داده اجازه نصب آن را ندارد. "
                    f"با کاربر postgres دستور CREATE EXTENSION {ext}; را اجرا کنید."
                ) from e
