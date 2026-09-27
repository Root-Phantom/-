"""ساخت پرس‌وجوی جست‌وجوی حرفه‌ای روی جدول توصیفی (JSONB) و هندسه."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from fastapi import HTTPException
from geoalchemy2.functions import ST_Intersects, ST_MakeEnvelope, ST_SetSRID
from sqlalchemy import Float, Numeric, String, and_, cast, func, not_, or_, select, text
from sqlalchemy.orm import Query, Session
from sqlalchemy.sql.elements import BooleanClauseList, ColumnElement

from ..models import Feature, FieldDef, FieldType, Layer
from ..schemas import SearchCondition, SearchRequest

# ستون‌های مجازی که روی خود جدول features هستند (نه داخل JSON)
META_FIELDS = {
    "__created_at": Feature.created_at,
    "__updated_at": Feature.updated_at,
    "__version": Feature.version,
}

NUMERIC_TYPES = {FieldType.NUMBER, FieldType.INTEGER}


def _json_text(key: str) -> ColumnElement[Any]:
    """مقدار یک کلید JSONB به صورت متن."""
    return Feature.attributes[key].astext


def _json_number(key: str):
    """مقدار یک کلید JSONB به صورت عدد (مقادیر غیرعددی نادیده گرفته می‌شوند)."""
    txt = _json_text(key)
    # فقط رشته‌هایی که الگوی عدد دارند cast می‌شوند تا خطای پستگرس رخ ندهد
    safe = func.nullif(func.regexp_replace(txt, r"^\s+|\s+$", "", "g"), "")
    return cast(
        func.nullif(
            func.regexp_replace(safe, r"^(?!-?\d+(\.\d+)?$).*$", "", "g"), ""
        ),
        Float,
    )


def _as_float(value: Any, label: str) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        raise HTTPException(400, f"مقدار «{value}» برای شرط «{label}» عددی نیست.")


def _escape_like(v: str) -> str:
    return v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_condition(
    cond: SearchCondition, field_types: dict[str, FieldType]
) -> Optional[ColumnElement[bool]]:
    """یک شرط جست‌وجو را به عبارت SQL تبدیل می‌کند."""
    key = cond.field
    op = cond.op

    # --- ستون‌های فرا‌داده‌ای (تاریخ ایجاد/ویرایش و نسخه) ---
    if key in META_FIELDS:
        col = META_FIELDS[key]
        return _build_scalar(col, cond, numeric=True)

    if key not in field_types:
        raise HTTPException(400, f"ستون «{key}» در جدول توصیفی این لایه وجود ندارد.")

    ftype = field_types[key]
    txt = _json_text(key)

    # --- عملگرهای خالی بودن ---
    if op == "is_empty":
        return or_(txt.is_(None), txt == "")
    if op == "is_not_empty":
        return and_(txt.isnot(None), txt != "")

    if op == "in":
        values = cond.value if isinstance(cond.value, list) else [cond.value]
        values = [str(v) for v in values if v is not None and str(v) != ""]
        if not values:
            return None
        return txt.in_(values)

    # --- عددی ---
    if ftype in NUMERIC_TYPES and op in {"eq", "ne", "gt", "gte", "lt", "lte", "between"}:
        num = _json_number(key)
        if op == "between":
            lo = _as_float(cond.value, key)
            hi = _as_float(cond.value2, key)
            if lo > hi:
                lo, hi = hi, lo
            return and_(num >= lo, num <= hi)
        v = _as_float(cond.value, key)
        return {
            "eq": num == v, "ne": num != v, "gt": num > v,
            "gte": num >= v, "lt": num < v, "lte": num <= v,
        }[op]

    # --- تاریخ ---
    if ftype == FieldType.DATE and op in {"eq", "ne", "gt", "gte", "lt", "lte", "between"}:
        # تاریخ‌ها به صورت رشته ISO ذخیره می‌شوند؛ مقایسه متنی درست کار می‌کند
        return _build_scalar(txt, cond, numeric=False)

    # --- بولین ---
    if ftype == FieldType.BOOLEAN and op in {"eq", "ne"}:
        want = str(cond.value).strip().lower() in {"true", "1", "بله", "yes", "on"}
        expr = txt.in_(["true", "True", "1"])
        return expr if (op == "eq") == want else not_(expr)

    # --- متنی ---
    val = "" if cond.value is None else str(cond.value).strip()
    if op in {"contains", "not_contains", "starts_with", "ends_with"} and val == "":
        return None

    if op == "eq":
        return func.lower(txt) == val.lower()
    if op == "ne":
        return or_(txt.is_(None), func.lower(txt) != val.lower())
    if op == "contains":
        return txt.ilike(f"%{_escape_like(val)}%", escape="\\")
    if op == "not_contains":
        return or_(txt.is_(None), not_(txt.ilike(f"%{_escape_like(val)}%", escape="\\")))
    if op == "starts_with":
        return txt.ilike(f"{_escape_like(val)}%", escape="\\")
    if op == "ends_with":
        return txt.ilike(f"%{_escape_like(val)}", escape="\\")

    # عملگرهای مقایسه‌ای روی متن
    return _build_scalar(txt, cond, numeric=False)


def _build_scalar(col, cond: SearchCondition, *, numeric: bool) -> Optional[ColumnElement[bool]]:
    op = cond.op
    v = cond.value
    if op == "between":
        if v is None or cond.value2 is None:
            return None
        lo, hi = (_as_float(v, cond.field), _as_float(cond.value2, cond.field)) if numeric else (str(v), str(cond.value2))
        if lo > hi:
            lo, hi = hi, lo
        return and_(col >= lo, col <= hi)
    if v is None or str(v) == "":
        return None
    cv = _as_float(v, cond.field) if numeric else str(v)
    mapping = {
        "eq": col == cv, "ne": col != cv, "gt": col > cv,
        "gte": col >= cv, "lt": col < cv, "lte": col <= cv,
        "contains": cast(col, String).ilike(f"%{_escape_like(str(v))}%", escape="\\"),
        "starts_with": cast(col, String).ilike(f"{_escape_like(str(v))}%", escape="\\"),
        "ends_with": cast(col, String).ilike(f"%{_escape_like(str(v))}", escape="\\"),
    }
    return mapping.get(op)


# یکسان‌سازی نگارش فارسی/عربی: هر نویسه سمت چپ به نویسه سمت راست تبدیل می‌شود.
# همین نگاشت هم روی متن جست‌وجو و هم (با translate) روی داده‌های پایگاه داده اعمال می‌شود.
_NORMALIZE = {
    "ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه",
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و",
    "\u200c": " ",  # نیم‌فاصله
    **{d: str(i) for i, d in enumerate("۰۱۲۳۴۵۶۷۸۹")},
    **{d: str(i) for i, d in enumerate("٠١٢٣٤٥٦٧٨٩")},
}
_NORM_FROM = "".join(_NORMALIZE)
_NORM_TO = "".join(_NORMALIZE.values())
_NORM_TABLE = str.maketrans(_NORMALIZE)


def _normalize_persian(s: str) -> str:
    """یکسان‌سازی حروف عربی/فارسی و اعداد برای جست‌وجوی روان."""
    return re.sub(r"\s+", " ", s.translate(_NORM_TABLE)).strip()


def _free_text_clause(q: str, searchable: list[str]) -> Optional[ColumnElement[bool]]:
    """جست‌وجوی آزاد در همه ستون‌های قابل جست‌وجو با در نظر گرفتن نگارش فارسی."""
    q = _normalize_persian(q)
    if not q or not searchable:
        return None

    def norm_col(key: str):
        # همان یکسان‌سازی را در سمت پایگاه داده اعمال می‌کنیم
        return func.translate(_json_text(key), _NORM_FROM, _NORM_TO)

    # هر واژه باید در یکی از ستون‌ها پیدا شود (AND بین واژه‌ها، OR بین ستون‌ها)
    word_clauses = []
    for word in q.split(" "):
        if not word:
            continue
        pat = f"%{_escape_like(word)}%"
        word_clauses.append(or_(*[norm_col(k).ilike(pat, escape="\\") for k in searchable]))
    if not word_clauses:
        return None
    return and_(*word_clauses)


def apply_search(
    db: Session, req: SearchRequest, *, public_only: bool
):
    """پرس‌وجوی نهایی جست‌وجو را می‌سازد و برمی‌گرداند."""
    stmt = select(Feature).join(Layer, Feature.layer_id == Layer.id)

    # کاربر عمومی فقط لایه‌های عمومی و آرشیو‌نشده را می‌بیند
    if public_only:
        stmt = stmt.where(Layer.is_visible_public.is_(True), Layer.is_archived.is_(False))

    if req.layer_id:
        stmt = stmt.where(Feature.layer_id == req.layer_id)

    if not req.include_archived:
        stmt = stmt.where(Feature.is_archived.is_(False))

    # --- ستون‌های لایه برای اعتبارسنجی و تعیین نوع ---
    fdq = select(FieldDef)
    if req.layer_id:
        fdq = fdq.where(FieldDef.layer_id == req.layer_id)
    fdefs = db.execute(fdq).scalars().all()
    field_types: dict[str, FieldType] = {}
    searchable: list[str] = []
    for f in fdefs:
        field_types.setdefault(f.key, f.data_type)
        if f.is_searchable and f.key not in searchable:
            searchable.append(f.key)

    clauses: list[ColumnElement[bool]] = []
    for cond in req.conditions:
        c = build_condition(cond, field_types)
        if c is not None:
            clauses.append(c)

    if clauses:
        stmt = stmt.where(and_(*clauses) if req.logic == "and" else or_(*clauses))

    if req.q:
        fc = _free_text_clause(req.q, searchable)
        if fc is not None:
            stmt = stmt.where(fc)

    # --- فیلتر مکانی ---
    if req.bbox:
        minx, miny, maxx, maxy = req.bbox
        env = ST_SetSRID(ST_MakeEnvelope(minx, miny, maxx, maxy), 4326)
        stmt = stmt.where(ST_Intersects(Feature.geom, env))

    if req.intersects:
        geom = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(req.intersects)), 4326)
        stmt = stmt.where(ST_Intersects(Feature.geom, geom))

    # --- مرتب‌سازی ---
    if req.sort_by:
        if req.sort_by in META_FIELDS:
            col = META_FIELDS[req.sort_by]
        elif req.sort_by in field_types:
            col = (
                _json_number(req.sort_by)
                if field_types[req.sort_by] in NUMERIC_TYPES
                else _json_text(req.sort_by)
            )
        else:
            raise HTTPException(400, f"مرتب‌سازی بر اساس ستون ناشناخته «{req.sort_by}».")
        stmt = stmt.order_by(col.desc().nullslast() if req.sort_dir == "desc" else col.asc().nullsfirst())
    else:
        stmt = stmt.order_by(Feature.created_at.desc())

    return stmt
