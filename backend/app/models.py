"""مدل‌های پایگاه داده سامانه مدیریت معابر."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, Optional

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


# ---------------------------------------------------------------- نقش‌ها


class Role(str, enum.Enum):
    """سطوح دسترسی سامانه."""

    ADMIN = "admin"        # مدیر کل: همه کارها + مدیریت کاربران
    EDITOR = "editor"      # کارشناس: ویرایش داده‌ها، بدون مدیریت کاربران
    VIEWER = "viewer"      # کاربر ثبت‌نام‌شده: فقط مشاهده
    # کاربر عمومی (بدون لاگین) در کد به صورت None مدیریت می‌شود


class FieldType(str, enum.Enum):
    """انواع داده برای ستون‌های جدول توصیفی (مشابه ArcGIS)."""

    TEXT = "text"
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    DATE = "date"
    SELECT = "select"      # فهرست بازشو با گزینه‌های محدود


class GeomType(str, enum.Enum):
    POINT = "point"
    LINESTRING = "linestring"
    POLYGON = "polygon"
    MIXED = "mixed"


class SuggestionStatus(str, enum.Enum):
    PENDING = "pending"      # در انتظار بررسی
    APPROVED = "approved"    # تأیید شده
    REJECTED = "rejected"    # رد شده


# ---------------------------------------------------------------- کاربران


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    email: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="role_enum"), default=Role.VIEWER, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    @property
    def can_edit(self) -> bool:
        return self.role in (Role.ADMIN, Role.EDITOR)


# ---------------------------------------------------------------- لایه‌ها


class Layer(Base):
    """هر لایه یک مجموعه عارضه است (مثلاً معابر، نقاط شاخص، محدوده‌ها)."""

    __tablename__ = "layers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    geom_type: Mapped[GeomType] = mapped_column(
        Enum(GeomType, name="geom_type_enum"), default=GeomType.MIXED, nullable=False
    )
    srid: Mapped[int] = mapped_column(Integer, default=4326, nullable=False)
    # نمایش روی نقشه
    style: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # نام ستونی که به عنوان برچسب عارضه استفاده می‌شود
    label_field: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    is_visible_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    fields: Mapped[list["FieldDef"]] = relationship(
        back_populates="layer", cascade="all, delete-orphan", order_by="FieldDef.sort_order"
    )
    created_by: Mapped[Optional[User]] = relationship(foreign_keys=[created_by_id])


class FieldDef(Base):
    """تعریف یک ستون در جدول توصیفی لایه — معادل Field در ArcGIS.

    مقدار واقعی هر ستون داخل ستون JSONB عارضه (Feature.attributes) ذخیره می‌شود،
    بنابراین افزودن ستون جدید نیازی به تغییر ساختار جدول ندارد.
    """

    __tablename__ = "field_defs"
    __table_args__ = (UniqueConstraint("layer_id", "key", name="uq_field_layer_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    layer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("layers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)          # کلید فنی در JSON
    label: Mapped[str] = mapped_column(String(150), nullable=False)       # عنوان فارسی نمایشی
    data_type: Mapped[FieldType] = mapped_column(
        Enum(FieldType, name="field_type_enum"), default=FieldType.TEXT, nullable=False
    )
    options: Mapped[list[str]] = mapped_column(JSONB, default=list)       # برای نوع select
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_searchable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # قابل حذف نیست
    default_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # واحد، مثلاً متر
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    layer: Mapped[Layer] = relationship(back_populates="fields")


# ---------------------------------------------------------------- عوارض


class Feature(Base):
    """یک عارضه جغرافیایی (معبر، نقطه، چندضلعی) با جدول توصیفی پویا."""

    __tablename__ = "features"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    layer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("layers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    geom = mapped_column(Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=True), nullable=True)
    # مقادیر ستون‌های توصیفی پویا
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    # شماره نسخه؛ با هر ویرایش یک واحد اضافه می‌شود
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    archive_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    layer: Mapped[Layer] = relationship()
    created_by: Mapped[Optional[User]] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship(foreign_keys=[updated_by_id])


# ایندکس GIN روی JSONB برای جست‌وجوی سریع در جدول توصیفی
Index("ix_features_attributes_gin", Feature.attributes, postgresql_using="gin")


class FeatureRevision(Base):
    """تاریخچه کامل تغییرات هر عارضه — برای پاسخ به «چه کسی چه کاری کرد»."""

    __tablename__ = "feature_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    feature_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("features.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(30), nullable=False)  # create / update / archive / restore
    attributes_before: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    attributes_after: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    # فهرست ستون‌های تغییریافته، برای نمایش سریع
    changed_fields: Mapped[list[str]] = mapped_column(JSONB, default=list)
    geometry_changed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    geom_before = mapped_column(Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user: Mapped[Optional[User]] = relationship()


# ---------------------------------------------------------------- پیشنهاد نام


class NameSuggestion(Base):
    """پیشنهاد نام توسط کاربر عمومی (بدون نیاز به لاگین)."""

    __tablename__ = "name_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    feature_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("features.id", ondelete="CASCADE"), nullable=True, index=True
    )
    suggested_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # اطلاعات تماس پیشنهاددهنده (اختیاری)
    submitter_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    submitter_phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    submitter_ip: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    status: Mapped[SuggestionStatus] = mapped_column(
        Enum(SuggestionStatus, name="suggestion_status_enum"),
        default=SuggestionStatus.PENDING,
        nullable=False,
        index=True,
    )
    admin_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    feature: Mapped[Optional[Feature]] = relationship()
    reviewed_by: Mapped[Optional[User]] = relationship(foreign_keys=[reviewed_by_id])


# ---------------------------------------------------------------- لاگ سامانه


class AuditLog(Base):
    """لاگ تمام اقدامات کاربران در سامانه."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    username: Mapped[str] = mapped_column(String(64), default="مهمان", nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    entity_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    entity_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    # خلاصه فارسی و خوانا برای نمایش در صفحه لاگ
    summary: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    method: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="success", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user: Mapped[Optional[User]] = relationship()


class ImportJob(Base):
    """سابقه آپلود شیپ‌فایل."""

    __tablename__ = "import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    layer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("layers.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    feature_count: Mapped[int] = mapped_column(Integer, default=0)
    detected_fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    source_srid: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[Optional[User]] = relationship()
    layer: Mapped[Optional[Layer]] = relationship()
