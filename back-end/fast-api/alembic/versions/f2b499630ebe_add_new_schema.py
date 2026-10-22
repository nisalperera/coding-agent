"""create user settings

Revision ID: f2b499630ebe
Revises: 68511d57cb58
Create Date: 2026-09-16 11:56:43.639466
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f2b499630ebe"
down_revision: Union[str, Sequence[str], None] = "68511d57cb58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("github_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("github_base_url", sa.String(length=2048), server_default="https://github.com", nullable=False),
        sa.Column("github_scopes", postgresql.JSONB(), nullable=False),
        sa.Column("github_client_id_ciphertext", sa.Text(), nullable=True),
        sa.Column("github_client_secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("gitlab_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("gitlab_base_url", sa.String(length=2048), server_default="https://gitlab.com", nullable=False),
        sa.Column("gitlab_scopes", postgresql.JSONB(), nullable=False),
        sa.Column("gitlab_client_id_ciphertext", sa.Text(), nullable=True),
        sa.Column("gitlab_client_secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("llm_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("llm_provider_name", sa.String(length=100), server_default="Custom", nullable=False),
        sa.Column("llm_endpoint_url", sa.String(length=2048), server_default="https://127.0.0.1:9000/v1/chat/completions", nullable=False),
        sa.Column("llm_model", sa.String(length=255), server_default="Qwen2.5-Coder-14b", nullable=False),
        sa.Column("llm_temperature", sa.Float(), server_default="0.2", nullable=False),
        sa.Column("llm_max_tokens", sa.Integer(), server_default="4096", nullable=False),
        sa.Column("llm_stream_responses", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("llm_api_key_ciphertext", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_settings_user_id", "user_settings", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_settings_user_id", table_name="user_settings")
    op.drop_table("user_settings")