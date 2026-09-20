"""طرح‌های ورودی/خروجی (Pydantic)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import FieldType, GeomType, Role, SuggestionStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- احراز هویت


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


class UserOut(ORMModel):
    id: uuid.UUID
    username: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Role
    is_active: bool
    must_change_password: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime


class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=8, max_length=200)
    full_name: str = Field(default="", max_length=150)
    email: Optional[str] = Field(default=None, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    role: Role = Role.VIEWER
    is_active: bool = True


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)


# ---------------------------------------------------------------- لایه‌ها


class LayerOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    geom_type: GeomType
    srid: int
    style: dict[str, Any]
    label_field: Optional[str] = None
    is_visible_public: bool
    is_archived: bool
    created_at: datetime
    feature_count: int = 0


class LayerCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    slug: Optional[str] = Field(default=None, max_length=80, pattern=r"^[a-z0-9_\-]+$")
    description: str = ""
    geom_type: GeomType = GeomType.MIXED
    style: dict[str, Any] = Field(default_factory=dict)
    label_field: Optional[str] = None
    is_visible_public: bool = True


class LayerUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=150)
    description: Optional[str] = None
    style: Optional[dict[str, Any]] = None
    label_field: Optional[str] = None
    is_visible_public: Optional[bool] = None


# ---------------------------------------------------------------- ستون‌ها


class FieldDefOut(ORMModel):
    id: uuid.UUID
    layer_id: uuid.UUID
    key: str
    label: str
    data_type: FieldType
    options: list[str]
    is_required: bool
    is_searchable: bool
    is_system: bool
    default_value: Optional[str] = None
    unit: Optional[str] = None
    sort_order: int


class FieldDefCreateIn(BaseModel):
    key: Optional[str] = Field(default=None, max_length=80, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=150)
    data_type: FieldType = FieldType.TEXT
    options: list[str] = Field(default_factory=list)
    is_required: bool = False
    is_searchable: bool = True
    default_value: Optional[str] = None
    unit: Optional[str] = Field(default=None, max_length=30)
    sort_order: int = 0

    @field_validator("options")
    @classmethod
    def _clean_options(cls, v: list[str]) -> list[str]:
        return [o.strip() for o in v if o and o.strip()]


class FieldDefUpdateIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=150)
    options: Optional[list[str]] = None
    is_required: Optional[bool] = None
    is_searchable: Optional[bool] = None
    default_value: Optional[str] = None
    unit: Optional[str] = Field(default=None, max_length=30)
    sort_order: Optional[int] = None


# ---------------------------------------------------------------- عوارض


class FeatureOut(ORMModel):
    id: uuid.UUID
    layer_id: uuid.UUID
    attributes: dict[str, Any]
    version: int
    is_archived: bool
    geometry: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


class FeatureCreateIn(BaseModel):
    layer_id: uuid.UUID
    attributes: dict[str, Any] = Field(default_factory=dict)
    geometry: Optional[dict[str, Any]] = None   # GeoJSON geometry


class FeatureUpdateIn(BaseModel):
    attributes: Optional[dict[str, Any]] = None
    geometry: Optional[dict[str, Any]] = None
    note: Optional[str] = None


class ArchiveIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class BulkFieldUpdateIn(BaseModel):
    """اعمال یک مقدار روی چند عارضه به‌صورت یکجا."""

    feature_ids: list[uuid.UUID] = Field(min_length=1)
    key: str
    value: Any = None


# ---------------------------------------------------------------- جست‌وجو


Operator = Literal[
    "eq", "ne", "contains", "not_contains", "starts_with", "ends_with",
    "gt", "gte", "lt", "lte", "between", "in", "is_empty", "is_not_empty",
]


class SearchCondition(BaseModel):
    field: str
    op: Operator = "contains"
    value: Any = None
    value2: Any = None           # برای between


class SearchRequest(BaseModel):
    layer_id: Optional[uuid.UUID] = None
    # عبارت آزاد: در همه ستون‌های قابل جست‌وجو گشته می‌شود
    q: Optional[str] = None
    conditions: list[SearchCondition] = Field(default_factory=list)
    logic: Literal["and", "or"] = "and"
    include_archived: bool = False
    # محدوده مکانی: [minLon, minLat, maxLon, maxLat]
    bbox: Optional[list[float]] = None
    # چندضلعی دلخواه به صورت GeoJSON برای فیلتر مکانی
    intersects: Optional[dict[str, Any]] = None
    sort_by: Optional[str] = None
    sort_dir: Literal["asc", "desc"] = "asc"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=1000)
    include_geometry: bool = False

    @field_validator("bbox")
    @classmethod
    def _check_bbox(cls, v):
        if v is not None and len(v) != 4:
            raise ValueError("bbox باید چهار عدد باشد: [minLon, minLat, maxLon, maxLat]")
        return v


class SearchResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[FeatureOut]


# ---------------------------------------------------------------- پیشنهاد نام


class SuggestionCreateIn(BaseModel):
    feature_id: Optional[uuid.UUID] = None
    suggested_name: str = Field(min_length=2, max_length=255)
    reason: Optional[str] = Field(default=None, max_length=2000)
    submitter_name: Optional[str] = Field(default=None, max_length=150)
    submitter_phone: Optional[str] = Field(default=None, max_length=30)


class SuggestionOut(ORMModel):
    id: uuid.UUID
    feature_id: Optional[uuid.UUID] = None
    suggested_name: str
    reason: Optional[str] = None
    submitter_name: Optional[str] = None
    submitter_phone: Optional[str] = None
    status: SuggestionStatus
    admin_note: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    reviewed_by_name: Optional[str] = None
    feature_label: Optional[str] = None


class SuggestionReviewIn(BaseModel):
    status: Literal["approved", "rejected"]
    admin_note: Optional[str] = Field(default=None, max_length=2000)
    # در صورت تأیید: مقدار را در این ستون عارضه بنویس
    apply_to_field: Optional[str] = None


# ---------------------------------------------------------------- لاگ


class AuditLogOut(ORMModel):
    id: int
    username: str
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    summary: str
    payload: Optional[dict[str, Any]] = None
    ip_address: Optional[str] = None
    method: Optional[str] = None
    path: Optional[str] = None
    status: str
    created_at: datetime


class RevisionOut(ORMModel):
    id: uuid.UUID
    feature_id: uuid.UUID
    version: int
    action: str
    changed_fields: list[str]
    geometry_changed: bool
    attributes_before: Optional[dict[str, Any]] = None
    attributes_after: Optional[dict[str, Any]] = None
    note: Optional[str] = None
    created_at: datetime
    user_name: Optional[str] = None


class Paginated(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[Any]


# ---------------------------------------------------------------- آپلود


class ShapefilePreview(BaseModel):
    # شناسه فایل آپلودشده؛ در مرحله درون‌ریزی باید همین مقدار ارسال شود
    token: str
    filename: str
    geom_type: str
    feature_count: int
    source_srid: Optional[int] = None
    encoding: str
    fields: list[dict[str, Any]]
    sample: list[dict[str, Any]]


class ShapefileImportIn(BaseModel):
    token: str                       # شناسه فایل آپلودشده موقت
    layer_name: str = Field(min_length=1, max_length=150)
    # نگاشت ستون شیپ‌فایل به ستون سامانه: {"نام": "name"}
    field_map: dict[str, str] = Field(default_factory=dict)
    # ستون‌هایی که باید نادیده گرفته شوند
    skip_fields: list[str] = Field(default_factory=list)
    label_field: Optional[str] = None
    source_srid: Optional[int] = None
    target_layer_id: Optional[uuid.UUID] = None   # افزودن به لایه موجود
