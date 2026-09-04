"""align mysql schema contract

Revision ID: <new_revision_id>
Revises: 24f9344cb6c5
Create Date: 2026-09-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "7af6af1e471d"
down_revision = "24f9344cb6c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bigint = mysql.BIGINT()

    # users
    op.alter_column(
        "users",
        "picture",
        existing_type=mysql.VARCHAR(length=2048),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.alter_column(
        "users",
        "created_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "updated_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )

    # Google login OAuth state
    op.alter_column(
        "oauth_states",
        "state",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.String(length=128),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "code_verifier",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "cookie_nonce",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.String(length=128),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "expires_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "created_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )

    # Sessions
    op.alter_column(
        "sessions",
        "expires_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "sessions",
        "created_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "sessions",
        "last_seen_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )

    # Per-user encrypted integrations
    op.add_column(
        "user_integrations",
        sa.Column("scopes", sa.Text(), nullable=True),
    )
    op.alter_column(
        "user_integrations",
        "token_expires_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=True,
    )
    op.alter_column(
        "user_integrations",
        "connected_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "user_integrations",
        "updated_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )

    # Pending approval-gated actions
    op.alter_column(
        "pending_actions",
        "tool_name",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.String(length=128),
        existing_nullable=False,
    )
    op.alter_column(
        "pending_actions",
        "created_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "pending_actions",
        "expires_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )

    # Provider-specific OAuth callback state
    op.add_column(
        "integration_oauth_states",
        sa.Column(
            "cookie_nonce",
            sa.String(length=128),
            nullable=False,
        ),
    )
    op.alter_column(
        "integration_oauth_states",
        "state",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.String(length=128),
        existing_nullable=False,
    )
    op.alter_column(
        "integration_oauth_states",
        "code_verifier",
        existing_type=mysql.VARCHAR(length=255),
        type_=sa.Text(),
        nullable=True,
        existing_nullable=False,
    )
    op.alter_column(
        "integration_oauth_states",
        "expires_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.alter_column(
        "integration_oauth_states",
        "created_at",
        existing_type=mysql.INTEGER(),
        type_=bigint,
        existing_nullable=False,
    )
    op.create_index(
        "idx_integration_oauth_states_user_provider",
        "integration_oauth_states",
        ["user_id", "provider"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_integration_oauth_states_user_provider",
        table_name="integration_oauth_states",
    )

    op.alter_column(
        "integration_oauth_states",
        "created_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "integration_oauth_states",
        "expires_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "integration_oauth_states",
        "code_verifier",
        existing_type=sa.Text(),
        type_=mysql.VARCHAR(length=255),
        nullable=False,
        existing_nullable=True,
    )
    op.alter_column(
        "integration_oauth_states",
        "state",
        existing_type=mysql.VARCHAR(length=128),
        type_=mysql.VARCHAR(length=255),
        existing_nullable=False,
    )
    op.drop_column("integration_oauth_states", "cookie_nonce")

    op.alter_column(
        "pending_actions",
        "expires_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "pending_actions",
        "created_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "pending_actions",
        "tool_name",
        existing_type=mysql.VARCHAR(length=128),
        type_=mysql.VARCHAR(length=255),
        existing_nullable=False,
    )

    op.alter_column(
        "user_integrations",
        "updated_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "user_integrations",
        "connected_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "user_integrations",
        "token_expires_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=True,
    )
    op.drop_column("user_integrations", "scopes")

    op.alter_column(
        "sessions",
        "last_seen_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "sessions",
        "created_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "sessions",
        "expires_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )

    op.alter_column(
        "oauth_states",
        "created_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "expires_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "cookie_nonce",
        existing_type=mysql.VARCHAR(length=128),
        type_=mysql.VARCHAR(length=255),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "code_verifier",
        existing_type=sa.Text(),
        type_=mysql.VARCHAR(length=255),
        existing_nullable=False,
    )
    op.alter_column(
        "oauth_states",
        "state",
        existing_type=mysql.VARCHAR(length=128),
        type_=mysql.VARCHAR(length=255),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "updated_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "created_at",
        existing_type=mysql.BIGINT(),
        type_=mysql.INTEGER(),
        existing_nullable=False,
    )
    op.alter_column(
        "users",
        "picture",
        existing_type=sa.Text(),
        type_=mysql.VARCHAR(length=2048),
        existing_nullable=True,
    )