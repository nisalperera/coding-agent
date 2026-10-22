"""add user settings last seen timestamp

Revision ID: ba48cbe99624
Revises: f2b499630ebe
Create Date: 2026-09-16 12:30:19.432026
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "ba48cbe99624"
down_revision: Union[str, Sequence[str], None] = "f2b499630ebe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("user_settings", "llm_temperature", existing_type=sa.Float(), server_default="0.2", existing_nullable=False)
    op.alter_column("user_settings", "created_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "updated_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)


def downgrade() -> None:
    op.alter_column("user_settings", "updated_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "created_at", existing_type=sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), existing_nullable=False)
    op.alter_column("user_settings", "llm_temperature", existing_type=sa.Float(), server_default="0.2", existing_nullable=False)
    op.drop_column("user_settings", "last_seen_at")