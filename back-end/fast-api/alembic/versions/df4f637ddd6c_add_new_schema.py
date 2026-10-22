"""update user settings defaults

Revision ID: df4f637ddd6c
Revises: ba48cbe99624
Create Date: 2026-09-18 01:02:57.684716
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "df4f637ddd6c"
down_revision: Union[str, Sequence[str], None] = "ba48cbe99624"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("user_settings", "llm_endpoint_url", existing_type=sa.String(length=2048), server_default="https://vllm.ganisalchperera.com/v1/chat/completions", existing_nullable=False)
    op.alter_column("user_settings", "llm_temperature", existing_type=sa.Float(), server_default="0.2", existing_nullable=False)
    op.alter_column("user_settings", "created_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "updated_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)


def downgrade() -> None:
    op.alter_column("user_settings", "updated_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "created_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "llm_temperature", existing_type=sa.Float(), server_default="0.2", existing_nullable=False)
    op.alter_column("user_settings", "llm_endpoint_url", existing_type=sa.String(length=2048), server_default="https://127.0.0.1:9000/v1/chat/completions", existing_nullable=False)