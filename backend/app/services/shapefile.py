"""خواندن و درون‌ریزی شیپ‌فایل (بدون نیاز به GDAL).

از کتابخانه pyshp استفاده می‌شود که خالص پایتون است و روی ویندوز
بدون هیچ کامپایلر یا پیش‌نیاز سیستمی نصب می‌شود.
"""
from __future__ import annotations

import re
import unicodedata
import zipfile
from pathlib import Path
from typing import Any, Iterable, Optional

import shapefile  # pyshp
from fastapi import HTTPException
from pyproj import CRS, Transformer
from shapely.geometry import shape as shapely_shape
from shapely.ops import transform as shapely_transform

from ..models import FieldType

# رمزگذاری‌هایی که برای شیپ‌فایل‌های فارسی آزمایش می‌شوند
ENCODING_CANDIDATES = ["utf-8", "cp1256", "cp1252", "latin-1"]

SHP_TYPE_TO_GEOM = {
    shapefile.POINT: "point", shapefile.POINTZ: "point", shapefile.POINTM: "point",
    shapefile.MULTIPOINT: "point", shapefile.MULTIPOINTZ: "point", shapefile.MULTIPOINTM: "point",
    shapefile.POLYLINE: "linestring", shapefile.POLYLINEZ: "linestring", shapefile.POLYLINEM: "linestring",
    shapefile.POLYGON: "polygon", shapefile.POLYGONZ: "polygon", shapefile.POLYGONM: "polygon",
}

# نگاشت نوع ستون DBF به نوع ستون سامانه
DBF_TYPE_MAP = {
    "C": FieldType.TEXT,
    "N": FieldType.NUMBER,
    "F": FieldType.NUMBER,
    "L": FieldType.BOOLEAN,
    "D": FieldType.DATE,
    "M": FieldType.TEXT,
}

# ترانویسی ساده فارسی→لاتین برای ساخت کلید فنی ستون‌ها
_FA_TO_LATIN = {
    "ا": "a", "آ": "a", "أ": "a", "إ": "a", "ب": "b", "پ": "p", "ت": "t", "ث": "s",
    "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z",
    "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z", "ع": "a",
    "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "ك": "k", "گ": "g", "ل": "l", "م": "m",
    "ن": "n", "و": "v", "ه": "h", "ی": "y", "ي": "y", "ء": "", "ئ": "y", "ؤ": "v",
    "ة": "h", "ۀ": "h", "‌": "_",
}


def slugify_key(label: str, existing: Iterable[str] = ()) -> str:
    """از عنوان (حتی فارسی) یک کلید فنی ASCII و یکتا می‌سازد."""
    s = (label or "").strip()
    out = []
    for ch in s:
        if ch in _FA_TO_LATIN:
            out.append(_FA_TO_LATIN[ch])
        elif ch.isascii() and (ch.isalnum() or ch == "_"):
            out.append(ch.lower())
        elif ch.isspace() or ch in "-./\\":
            out.append("_")
        else:
            # حروف لاتین با علامت (é) را ساده می‌کنیم
            norm = unicodedata.normalize("NFKD", ch)
            ascii_part = "".join(c for c in norm if c.isascii() and c.isalnum())
            out.append(ascii_part.lower() if ascii_part else "_")
    key = re.sub(r"_+", "_", "".join(out)).strip("_")
    if not key or not re.match(r"^[A-Za-z_]", key):
        key = f"f_{key}" if key else "field"
    key = key[:60]
    existing = set(existing)
    if key not in existing:
        return key
    i = 2
    while f"{key}_{i}" in existing:
        i += 1
    return f"{key}_{i}"


# ---------------------------------------------------------------- باز کردن فایل


def extract_archive(path: Path, dest: Path) -> Path:
    """اگر فایل zip باشد باز می‌کند و پوشه حاوی .shp را برمی‌گرداند."""
    dest.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(path) as zf:
                for member in zf.namelist():
                    # جلوگیری از Zip Slip
                    target = (dest / member).resolve()
                    if not str(target).startswith(str(dest.resolve())):
                        raise HTTPException(400, "فایل فشرده حاوی مسیر نامعتبر است.")
                zf.extractall(dest)
        except zipfile.BadZipFile:
            raise HTTPException(400, "فایل فشرده معتبر نیست.")
        return dest
    return path.parent


def find_shp(folder: Path) -> Path:
    shps = sorted(folder.rglob("*.shp")) + sorted(folder.rglob("*.SHP"))
    if not shps:
        raise HTTPException(
            400,
            "فایل .shp یافت نشد. لطفاً یک فایل ZIP شامل shp، shx، dbf و prj آپلود کنید.",
        )
    return shps[0]


def detect_encoding(shp: Path) -> str:
    """رمزگذاری جدول توصیفی را از فایل .cpg یا با آزمون تشخیص می‌دهد."""
    cpg = shp.with_suffix(".cpg")
    if not cpg.exists():
        cpg = shp.with_suffix(".CPG")
    if cpg.exists():
        try:
            raw = cpg.read_text(errors="ignore").strip().lower()
            if "utf" in raw and "8" in raw:
                return "utf-8"
            if raw.isdigit():
                return f"cp{raw}"
            if raw:
                return raw
        except OSError:
            pass

    # آزمون: رمزگذاری‌ای را برمی‌گزینیم که بیشترین متن خوانا تولید کند
    best, best_score = "utf-8", -1.0
    for enc in ENCODING_CANDIDATES:
        try:
            with shapefile.Reader(str(shp), encoding=enc, encodingErrors="strict") as r:
                rows = [r.record(i) for i in range(min(30, len(r)))]
        except Exception:
            continue
        score = _readability(rows)
        if score > best_score:
            best, best_score = enc, score
    return best


def _readability(rows) -> float:
    """نسبت نویسه‌های معنادار (فارسی/لاتین/عدد) به کل — معیار سنجش رمزگذاری."""
    good = total = 0
    for rec in rows:
        for v in rec:
            if not isinstance(v, str):
                continue
            for ch in v:
                total += 1
                o = ord(ch)
                if 0x0600 <= o <= 0x06FF or ch.isascii() and (ch.isalnum() or ch.isspace() or ch in ".,-()_/"):
                    good += 1
    return (good / total) if total else 0.0


def detect_srid(shp: Path) -> Optional[int]:
    """کد EPSG را از فایل .prj استخراج می‌کند."""
    prj = shp.with_suffix(".prj")
    if not prj.exists():
        prj = shp.with_suffix(".PRJ")
    if not prj.exists():
        return None
    try:
        wkt = prj.read_text(errors="ignore").strip()
        if not wkt:
            return None
        crs = CRS.from_wkt(wkt)
        epsg = crs.to_epsg()
        if epsg:
            return int(epsg)
        # تشخیص دستی موارد رایج ایران
        name = (crs.name or "").lower()
        if "wgs_1984" in name or "wgs 84" in name:
            if crs.is_geographic:
                return 4326
        return None
    except Exception:
        return None


# ---------------------------------------------------------------- تبدیل هندسه


def _transformer(src: int, dst: int = 4326):
    if src == dst:
        return None
    return Transformer.from_crs(CRS.from_epsg(src), CRS.from_epsg(dst), always_xy=True)


def _drop_z(geom):
    """بعد سوم (Z) را حذف می‌کند؛ PostGIS ما دوبعدی ذخیره می‌کند."""
    if not geom.has_z:
        return geom
    return shapely_transform(lambda x, y, z=None: (x, y), geom)


def shape_to_geojson(shp_rec, trans) -> Optional[dict[str, Any]]:
    """یک shape از pyshp را به GeoJSON در WGS84 تبدیل می‌کند."""
    try:
        gi = shp_rec.__geo_interface__
    except Exception:
        return None
    if not gi or gi.get("type") is None or not gi.get("coordinates"):
        return None
    try:
        geom = shapely_shape(gi)
    except Exception:
        return None
    if geom.is_empty:
        return None
    geom = _drop_z(geom)
    if trans is not None:
        geom = shapely_transform(lambda x, y: trans.transform(x, y), geom)
    if not geom.is_valid:
        geom = geom.buffer(0) if geom.geom_type in ("Polygon", "MultiPolygon") else geom
    if geom.is_empty:
        return None
    return geom.__geo_interface__


def _clean_value(v: Any) -> Any:
    """مقدار DBF را به چیزی که در JSON ذخیره‌شدنی است تبدیل می‌کند."""
    if v is None:
        return None
    if isinstance(v, bytes):
        for enc in ENCODING_CANDIDATES:
            try:
                v = v.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            return None
    if isinstance(v, str):
        s = v.strip().replace("\x00", "")
        return s or None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        # اعداد صحیحی که به صورت float آمده‌اند را تمیز می‌کنیم (1.0 -> 1)
        if isinstance(v, float) and v.is_integer():
            return int(v)
        return v
    # تاریخ
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


# ---------------------------------------------------------------- خواندن


def read_shapefile(shp: Path, *, encoding: Optional[str] = None, limit: Optional[int] = None):
    """اطلاعات شیپ‌فایل را می‌خواند: ستون‌ها، تعداد، نوع هندسه و رکوردها."""
    enc = encoding or detect_encoding(shp)
    try:
        reader = shapefile.Reader(str(shp), encoding=enc, encodingErrors="replace")
    except shapefile.ShapefileException as e:
        raise HTTPException(400, f"خواندن شیپ‌فایل ناموفق بود: {e}")

    fields = [f for f in reader.fields if f[0] != "DeletionFlag"]
    geom_type = SHP_TYPE_TO_GEOM.get(reader.shapeType, "mixed")
    count = len(reader)

    field_info: list[dict[str, Any]] = []
    used_keys: list[str] = []
    for name, ftype, size, dec in fields:
        key = slugify_key(name, used_keys)
        used_keys.append(key)
        dt = DBF_TYPE_MAP.get(ftype, FieldType.TEXT)
        # ستون عددی با اعشار صفر = عدد صحیح
        if dt == FieldType.NUMBER and ftype in ("N",) and int(dec or 0) == 0:
            dt = FieldType.INTEGER
        field_info.append(
            {
                "source_name": name,
                "key": key,
                "label": name,
                "dbf_type": ftype,
                "data_type": dt.value,
                "size": size,
                "decimals": dec,
            }
        )

    return reader, enc, geom_type, count, field_info


def iter_records(reader, field_info: list[dict[str, Any]], trans, *, limit: Optional[int] = None):
    """رکوردها را به صورت (attributes, geojson) بازمی‌گرداند."""
    names = [f["source_name"] for f in field_info]
    keys = [f["key"] for f in field_info]
    total = len(reader)
    stop = min(total, limit) if limit else total

    for i in range(stop):
        try:
            sr = reader.shapeRecord(i)
        except Exception:
            continue
        rec = sr.record
        attrs: dict[str, Any] = {}
        for name, key in zip(names, keys):
            try:
                raw = rec[name]
            except Exception:
                raw = None
            val = _clean_value(raw)
            if val is not None:
                attrs[key] = val
        geo = shape_to_geojson(sr.shape, trans)
        yield attrs, geo
