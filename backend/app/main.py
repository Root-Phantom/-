"""نقطه ورود برنامه — سامانه مدیریت معابر شهر پلدختر."""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DIR, settings
from .routers import audit, auth, export, features, layers, search, suggestions, upload, users
from .seed import create_first_admin, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("pol")

@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("راه‌اندازی %s", settings.APP_NAME)
    init_db()
    create_first_admin()
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_NAME,
    description="سامانه ثبت، نام‌گذاری و مدیریت معابر و خیابان‌های شهر پلدختر",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Time-ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"
    return response


@app.get("/api/health", tags=["سامانه"], summary="بررسی سلامت سامانه")
def health():
    from sqlalchemy import text

    from .db import engine

    try:
        with engine.connect() as conn:
            pg = conn.execute(text("SELECT version()")).scalar_one()
            gis = conn.execute(text("SELECT postgis_version()")).scalar_one()
        return {"status": "ok", "database": "connected", "postgresql": pg.split(",")[0], "postgis": gis}
    except Exception as e:
        return JSONResponse(
            status_code=503, content={"status": "error", "database": "unavailable", "detail": str(e)}
        )


@app.get("/api/info", tags=["سامانه"], summary="اطلاعات عمومی سامانه")
def info():
    return {
        "app_name": settings.APP_NAME,
        "version": "1.0.0",
        "city": "پلدختر",
        # مرکز نقشه و بزرگ‌نمایی پیش‌فرض روی شهر پلدختر
        "default_center": [33.1430, 47.7172],
        "default_zoom": 14,
    }


# ---- روترها ----
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(layers.router)
app.include_router(features.router)
app.include_router(search.router)
app.include_router(suggestions.router)
app.include_router(audit.router)
app.include_router(upload.router)
app.include_router(export.router)


# ---- رابط کاربری (فایل‌های ساخته‌شده React) ----
FRONTEND_DIR = BASE_DIR.parent / "frontend" / "dist"

if FRONTEND_DIR.exists():
    app.mount(
        "/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets"
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """همه مسیرهای غیر API به index.html هدایت می‌شوند (مسیریابی سمت کلاینت)."""
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "مسیر یافت نشد."})
        candidate = (FRONTEND_DIR / full_path).resolve()
        # جلوگیری از خروج از پوشه dist با «../» (مثلاً برای خواندن backend/.env)
        if full_path and candidate.is_relative_to(FRONTEND_DIR.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIR / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def no_frontend():
        return JSONResponse(
            content={
                "detail": "رابط کاربری ساخته نشده است. در پوشه frontend دستور «npm run build» را اجرا کنید.",
                "api_docs": "/api/docs",
            }
        )
