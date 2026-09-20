"""آپلود و درون‌ریزی شیپ‌فایل معابر.

روند کار دو مرحله‌ای است:
  ۱) آپلود فایل ZIP و دریافت پیش‌نمایش (ستون‌ها، تعداد، سیستم تصویر)
  ۲) تأیید نگاشت ستون‌ها و درون‌ریزی در یک لایه جدید یا موجود
"""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import log_action
from ..config import settings
from ..db import get_db
from ..deps import require_editor
from ..models import (
    Feature,
    FeatureRevision,
    FieldDef,
    FieldType,
    GeomType,
    ImportJob,
    Layer,
    User,
)
from ..schemas import ShapefileImportIn, ShapefilePreview
from ..services.shapefile import (
    detect_encoding,
    detect_srid,
    extract_archive,
    find_shp,
    iter_records,
    read_shapefile,
    slugify_key,
    _transformer,
)
from .layers import _unique_slug

router = APIRouter(prefix="/api/upload", tags=["آپلود شیپ‌فایل"])

ALLOWED_EXT = {".zip", ".shp", ".dbf", ".shx", ".prj", ".cpg"}
# اندازه دسته‌های درج در پایگاه داده
BATCH_SIZE = 500


# فایل‌های آپلود موقتی که درون‌ریزی نشده‌اند پس از این مدت پاک می‌شوند
STALE_UPLOAD_SECONDS = 24 * 3600


def _workdir(token: str) -> Path:
    if not token.isalnum():
        raise HTTPException(400, "شناسه فایل آپلودشده نامعتبر است.")
    return settings.UPLOAD_DIR / token


def _cleanup_stale_uploads() -> None:
    now = time.time()
    for d in settings.UPLOAD_DIR.iterdir():
        try:
            if d.is_dir() and now - d.stat().st_mtime > STALE_UPLOAD_SECONDS:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


@router.post("/shapefile/preview", response_model=ShapefilePreview, summary="آپلود و پیش‌نمایش شیپ‌فایل")
async def preview_shapefile(
    request: Request,
    file: UploadFile = File(..., description="فایل ZIP شامل shp/shx/dbf/prj"),
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    name = Path(file.filename or "upload.zip").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            400,
            "فقط فایل ZIP (یا اجزای شیپ‌فایل) پذیرفته می‌شود. پیشنهاد: همه فایل‌ها را در یک ZIP قرار دهید.",
        )

    _cleanup_stale_uploads()
    token = uuid.uuid4().hex
    wd = _workdir(token)
    wd.mkdir(parents=True, exist_ok=True)
    dest = wd / name

    # نوشتن فایل روی دیسک به صورت تکه‌ای با کنترل حجم
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        413, f"حجم فایل بیش از حد مجاز ({settings.MAX_UPLOAD_MB} مگابایت) است."
                    )
                out.write(chunk)
    except HTTPException:
        shutil.rmtree(wd, ignore_errors=True)
        raise
    finally:
        await file.close()

    try:
        folder = extract_archive(dest, wd / "extracted")
        shp = find_shp(folder)
        encoding = detect_encoding(shp)
        srid = detect_srid(shp)
        reader, enc, geom_type, count, field_info = read_shapefile(shp, encoding=encoding)

        if count == 0:
            raise HTTPException(400, "شیپ‌فایل هیچ عارضه‌ای ندارد.")

        trans = _transformer(srid) if srid else None
        sample = []
        for attrs, geo in iter_records(reader, field_info, trans, limit=5):
            sample.append({"attributes": attrs, "geometry_type": geo["type"] if geo else None})

        # مسیر شیپ‌فایل را برای مرحله دوم نگه می‌داریم
        (wd / "meta.json").write_text(
            json.dumps(
                {"shp": str(shp), "encoding": enc, "srid": srid, "filename": name},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except HTTPException:
        shutil.rmtree(wd, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(wd, ignore_errors=True)
        raise HTTPException(400, f"خواندن شیپ‌فایل ناموفق بود: {e}")

    log_action(
        db,
        action="shapefile_preview",
        summary=f"شیپ‌فایل «{name}» با {count} عارضه بررسی شد",
        user=user,
        entity_type="import",
        entity_id=token,
        payload={"filename": name, "count": count, "srid": srid, "geom_type": geom_type},
        request=request,
        commit=True,
    )

    return ShapefilePreview(
        token=token,
        filename=name,
        geom_type=geom_type,
        feature_count=count,
        source_srid=srid,
        encoding=enc,
        fields=field_info,
        sample=sample,
    )
    

@router.post("/shapefile/import", summary="درون‌ریزی شیپ‌فایل در لایه")
def import_shapefile(
    data: ShapefileImportIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    wd = _workdir(data.token)
    meta_path = wd / "meta.json"
    if not meta_path.exists():
        raise HTTPException(
            400, "فایل آپلودشده یافت نشد یا منقضی شده است. لطفاً مرحله پیش‌نمایش را دوباره انجام دهید."
        )

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    shp = Path(meta["shp"])
    if not shp.exists():
        raise HTTPException(400, "فایل شیپ‌فایل در سرور یافت نشد.")

    srid = data.source_srid or meta.get("srid")
    if not srid:
        raise HTTPException(
            400,
            "سیستم تصویر (prj) تشخیص داده نشد. لطفاً کد EPSG مبدأ را مشخص کنید "
            "(مثلاً 4326 برای WGS84 یا 32639 برای UTM زون 39N).",
        )

    reader, enc, geom_type, count, field_info = read_shapefile(shp, encoding=meta.get("encoding"))

    job = ImportJob(
        filename=meta.get("filename", shp.name),
        status="running",
        feature_count=0,
        detected_fields=field_info,
        source_srid=srid,
        user_id=user.id,
    )
    db.add(job)
    db.flush()

    try:
        # --- لایه مقصد ---
        if data.target_layer_id:
            layer = db.get(Layer, data.target_layer_id)
            if not layer:
                raise HTTPException(404, "لایه مقصد یافت نشد.")
            if layer.is_archived:
                raise HTTPException(400, "لایه مقصد آرشیو شده است.")
            created_layer = False
        else:
            gt = {
                "point": GeomType.POINT,
                "linestring": GeomType.LINESTRING,
                "polygon": GeomType.POLYGON,
            }.get(geom_type, GeomType.MIXED)
            layer = Layer(
                name=data.layer_name.strip(),
                slug=_unique_slug(db, data.layer_name),
                description=f"درون‌ریزی از شیپ‌فایل «{meta.get('filename')}»",
                geom_type=gt,
                srid=4326,
                style={"color": "#1d4ed8", "weight": 3},
                created_by_id=user.id,
            )
            db.add(layer)
            db.flush()
            created_layer = True

        job.layer_id = layer.id

        # --- ساخت/تطبیق ستون‌های جدول توصیفی ---
        existing = {f.key: f for f in db.query(FieldDef).filter(FieldDef.layer_id == layer.id).all()}
        used_keys = list(existing.keys())
        # نگاشت: نام ستون شیپ‌فایل -> کلید سامانه
        key_for_source: dict[str, str] = {}
        active_fields = [f for f in field_info if f["source_name"] not in set(data.skip_fields)]

        order = int(
            db.query(func.coalesce(func.max(FieldDef.sort_order), 0))
            .filter(FieldDef.layer_id == layer.id)
            .scalar()
            or 0
        )

        new_field_labels = []
        for f in active_fields:
            src = f["source_name"]
            mapped = (data.field_map or {}).get(src)
            if mapped and mapped in existing:
                key_for_source[src] = mapped
                continue
            key = mapped or f["key"]
            if key in used_keys:
                key = slugify_key(key, used_keys)
            used_keys.append(key)
            key_for_source[src] = key
            order += 1
            fd = FieldDef(
                layer_id=layer.id,
                key=key,
                label=src,               # عنوان فارسی اصلی شیپ‌فایل حفظ می‌شود
                data_type=FieldType(f["data_type"]),
                is_searchable=True,
                sort_order=order,
            )
            db.add(fd)
            existing[key] = fd
            new_field_labels.append(src)
        db.flush()

        # --- برچسب لایه ---
        if data.label_field:
            lf = key_for_source.get(data.label_field, data.label_field)
            if lf in existing:
                layer.label_field = lf
        if not layer.label_field:
            # حدس هوشمندانه: اولین ستون متنی که «نام» در عنوانش هست
            for f in active_fields:
                if f["data_type"] == "text" and ("نام" in f["source_name"] or "name" in f["source_name"].lower()):
                    layer.label_field = key_for_source[f["source_name"]]
                    break

        # --- درج عوارض ---
        trans = _transformer(int(srid))
        inserted = skipped_no_geom = 0
        pending = 0

        for attrs, geo in iter_records(reader, field_info, trans):
            # کلیدهای شیپ‌فایل به کلیدهای سامانه نگاشت می‌شوند
            mapped_attrs: dict[str, Any] = {}
            for f in active_fields:
                src_key = f["key"]
                if src_key in attrs:
                    mapped_attrs[key_for_source[f["source_name"]]] = attrs[src_key]

            feat = Feature(
                layer_id=layer.id,
                attributes=mapped_attrs,
                created_by_id=user.id,
                updated_by_id=user.id,
                version=1,
            )
            if geo:
                feat.geom = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geo)), 4326)
            else:
                skipped_no_geom += 1
            db.add(feat)
            inserted += 1
            pending += 1
            if pending >= BATCH_SIZE:
                db.flush()
                pending = 0

        db.flush()
        job.status = "success"
        job.feature_count = inserted

        log_action(
            db,
            action="shapefile_import",
            summary=(
                f"{inserted} عارضه از شیپ‌فایل «{job.filename}» در لایه «{layer.name}» "
                f"درون‌ریزی شد" + (f" (+{len(new_field_labels)} ستون جدید)" if new_field_labels else "")
            ),
            user=user,
            entity_type="layer",
            entity_id=layer.id,
            payload={
                "filename": job.filename,
                "layer": layer.name,
                "layer_created": created_layer,
                "inserted": inserted,
                "without_geometry": skipped_no_geom,
                "source_srid": srid,
                "new_fields": new_field_labels,
            },
            request=request,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        job2 = ImportJob(
            filename=meta.get("filename", shp.name), status="failed",
            error=str(e)[:2000], source_srid=srid, user_id=user.id,
        )
        db.add(job2)
        log_action(
            db, action="shapefile_import",
            summary=f"درون‌ریزی شیپ‌فایل «{meta.get('filename')}» با خطا متوقف شد",
            user=user, entity_type="import", payload={"error": str(e)[:500]},
            request=request, status="failed", commit=True,
        )
        raise HTTPException(500, f"درون‌ریزی ناموفق بود: {e}")
    finally:
        shutil.rmtree(wd, ignore_errors=True)

    return {
        "detail": f"{inserted} عارضه با موفقیت درون‌ریزی شد.",
        "layer_id": str(layer.id),
        "layer_name": layer.name,
        "inserted": inserted,
        "without_geometry": skipped_no_geom,
        "new_fields": new_field_labels,
    }


@router.get("/jobs", summary="سابقه درون‌ریزی‌ها")
def list_jobs(db: Session = Depends(get_db), _: User = Depends(require_editor)):
    rows = db.query(ImportJob).order_by(ImportJob.created_at.desc()).limit(50).all()
    return [
        {
            "id": str(j.id),
            "filename": j.filename,
            "status": j.status,
            "feature_count": j.feature_count,
            "source_srid": j.source_srid,
            "layer_name": j.layer.name if j.layer else None,
            "user": (j.user.full_name or j.user.username) if j.user else None,
            "error": j.error,
            "created_at": j.created_at.isoformat() if j.created_at else None,
        }
        for j in rows
    ]
