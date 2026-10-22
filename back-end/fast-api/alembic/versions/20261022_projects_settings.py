"""Private projects and immutable settings versions.
Revision ID: 20261022_projects; Revises: 68511d57cb58.
"""
from alembic import op
import sqlalchemy as sa

revision = "20261022_projects"
down_revision = "68511d57cb58"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("project_type", sa.String(16), nullable=False),
        *[sa.Column(key, sa.JSON(), nullable=False) for key in ("languages", "frameworks", "runtimes", "database_categories")],
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.BigInteger(), nullable=True),
        sa.Column("deleted_by", sa.String(36), nullable=True),
        sa.CheckConstraint("revision >= 1", name="ck_projects_revision"),
        sa.CheckConstraint("status IN ('active', 'deleted')", name="ck_projects_status"),
        sa.CheckConstraint("project_type IN ('frontend', 'backend', 'fullstack', 'general')", name="ck_projects_type"),
        mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci")
    op.create_index("ix_projects_owner_status_updated", "projects", ["owner_id", "status", "updated_at"])
    op.create_table("project_settings_versions",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("revision", sa.BigInteger(), primary_key=True),
        sa.Column("settings_json", sa.JSON(), nullable=False),
        sa.Column("project_status", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_project_settings_revision"),
        mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci")

def downgrade():
    op.drop_table("project_settings_versions")
    op.drop_index("ix_projects_owner_status_updated", table_name="projects")
    op.drop_table("projects")
