"""add local authentication fields

Revision ID: 68511d57cb58
Revises: 7af6af1e471d
Create Date: 2026-09-10 04:20:51.665009
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "68511d57cb58"
down_revision: Union[str, Sequence[str], None] = "7af6af1e471d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("oauth_states", "state", existing_type=sa.String(length=128), type_=sa.String(length=255), existing_nullable=False)
    op.alter_column("oauth_states", "code_verifier", existing_type=sa.Text(), type_=sa.String(length=255), existing_nullable=False)
    op.alter_column("oauth_states", "cookie_nonce", existing_type=sa.String(length=128), type_=sa.String(length=255), existing_nullable=False)
    op.alter_column("pending_actions", "tool_name", existing_type=sa.String(length=128), type_=sa.String(length=255), existing_nullable=False)

    op.add_column("users", sa.Column("username", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("auth_provider", sa.String(length=32), nullable=False, server_default="google"))
    op.alter_column("users", "auth_provider", server_default=None, existing_type=sa.String(length=32), existing_nullable=False)

    op.alter_column("users", "google_sub", existing_type=sa.String(length=255), nullable=True)
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])
    op.alter_column("users", "google_sub", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "password_hash")
    op.drop_column("users", "username")
    op.alter_column("pending_actions", "tool_name", existing_type=sa.String(length=255), type_=sa.String(length=128), existing_nullable=False)
    op.alter_column("oauth_states", "cookie_nonce", existing_type=sa.String(length=255), type_=sa.String(length=128), existing_nullable=False)
    op.alter_column("oauth_states", "code_verifier", existing_type=sa.String(length=255), type_=sa.Text(), existing_nullable=False)
    op.alter_column("oauth_states", "state", existing_type=sa.String(length=255), type_=sa.String(length=128), existing_nullable=False)