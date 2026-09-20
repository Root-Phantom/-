"""تنظیمات سامانه - از متغیرهای محیطی یا فایل .env خوانده می‌شود."""
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- عمومی ---
    APP_NAME: str = "سامانه مدیریت معابر شهر پلدختر"
    APP_ENV: str = "production"
    DEBUG: bool = False

    # --- پایگاه داده ---
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/poldokhtar_gis"

    # --- امنیت ---
    SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    COOKIE_NAME: str = "pol_session"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    # فقط وقتی سامانه پشت IIS/پروکسی معکوس است true شود؛ در غیر این صورت هدر X-Forwarded-For قابل جعل است
    TRUST_PROXY_HEADERS: bool = False

    # --- مدیر اولیه (فقط بار اول ساخته می‌شود) ---
    FIRST_ADMIN_USERNAME: str = "admin"
    FIRST_ADMIN_PASSWORD: str = "Admin@12345"
    FIRST_ADMIN_FULLNAME: str = "مدیر سامانه"

    # --- CORS: دامنه‌های مجاز، با کاما جدا شده ---
    CORS_ORIGINS: str = "http://localhost:5173"

    # --- آپلود ---
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    MAX_UPLOAD_MB: int = 200

    @property
    def cors_origins(self) -> List[str]:
        """فهرست دامنه‌های مجاز. مقدار «*» یعنی همه دامنه‌ها."""
        raw = (self.CORS_ORIGINS or "").strip()
        if not raw:
            return []
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
