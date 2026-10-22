from typing import Any
from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, current_time_ms, new_uuid
from app.db.models import common as _common  # Register users; no DDL.

class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("revision >= 1", name="ck_projects_revision"),
        CheckConstraint("status IN ('active', 'deleted')", name="ck_projects_status"),
        CheckConstraint("project_type IN ('frontend', 'backend', 'fullstack', 'general')", name="ck_projects_type"),
        Index("ix_projects_owner_status_updated", "owner_id", "status", "updated_at"),
        Base.__table_args__,
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    project_type: Mapped[str] = mapped_column(String(16), nullable=False)
    languages: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    frameworks: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    runtimes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    database_categories: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=current_time_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=current_time_ms)
    deleted_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

class ProjectSettingsVersion(Base):
    __tablename__ = "project_settings_versions"
    __table_args__ = (CheckConstraint("revision >= 1", name="ck_project_settings_revision"), Base.__table_args__)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="RESTRICT"), primary_key=True)
    revision: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    project_status: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=current_time_ms)
