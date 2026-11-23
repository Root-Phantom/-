"""ساخت جداول و کاربر مدیر اولیه."""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine, ensure_extensions
from .models import Role, User
from .security import hash_password

log = logging.getLogger("veysian.seed")


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


def seed_default_layer() -> None:
    """در صورتی که هیچ لایه‌ای در سامانه نباشد، شیپ‌فایل ویسیان را خودکار درون‌ریزی می‌کند."""
    import json
    from pathlib import Path
    from sqlalchemy import func
    from .models import Feature, FieldDef, FieldType, GeomType, Layer
    from .services.shapefile import _transformer, detect_encoding, detect_srid, iter_records, read_shapefile

    db: Session = SessionLocal()
    try:
        if db.query(Layer).count() > 0:
            return

        admin = db.query(User).filter(User.role == Role.ADMIN).first()
        if not admin:
            return

        candidates = [
            settings.BASE_DIR.parent / "veysian_final" / "veysian99.shp",
            settings.BASE_DIR / "veysian_final" / "veysian99.shp",
            Path("/app/veysian_final/veysian99.shp"),
        ]
        shp_path = None
        for c in candidates:
            if c.exists():
                shp_path = c
                break
        if not shp_path:
            return

        enc = detect_encoding(shp_path) or "utf-8"
        srid = detect_srid(shp_path) or 4326

        reader, enc, geom_type, count, field_info = read_shapefile(shp_path, encoding=enc)

        layer = Layer(
            name="معابر شهر ویسیان",
            slug="veysian-streets",
            description="شیپ‌فایل معابر و خیابان‌های شهر ویسیان",
            geom_type=GeomType.LINESTRING,
            srid=4326,
            style={"color": "#1d4ed8", "weight": 4},
            created_by_id=admin.id,
        )
        db.add(layer)
        db.flush()

        for idx, f in enumerate(field_info):
            fd = FieldDef(
                layer_id=layer.id,
                key=f["key"],
                label=f["label"] or f["source_name"],
                data_type=FieldType(f["data_type"]),
                is_searchable=True,
                sort_order=idx + 1,
            )
            db.add(fd)
            if f["key"] == "name":
                layer.label_field = "name"

        db.flush()

        trans = _transformer(int(srid))
        for attrs, geo in iter_records(reader, field_info, trans):
            feat = Feature(
                layer_id=layer.id,
                attributes=attrs,
                created_by_id=admin.id,
                updated_by_id=admin.id,
                version=1,
            )
            if geo:
                feat.geom = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geo)), 4326)
            db.add(feat)

        db.commit()
        log.info("شیپ‌فایل پیش‌فرض ویسیان درون‌ریزی شد: %d معبر", count)
    except Exception as e:
        db.rollback()
        log.warning("درون‌ریزی خودکار شیپ‌فایل ویسیان انجام نشد: %s", e)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    create_first_admin()
    seed_default_layer()
    print("پایگاه داده آماده شد.")
