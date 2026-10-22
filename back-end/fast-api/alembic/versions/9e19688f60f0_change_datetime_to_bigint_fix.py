"""remove obsolete user settings expiry field

Revision ID: 9e19688f60f0
Revises: 755acc6ee7f0
Create Date: 2026-09-29 01:20:47.197638
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "9e19688f60f0"
down_revision: Union[str, Sequence[str], None] = "755acc6ee7f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "user_settings",
        "llm_temperature",
        existing_type=sa.Float(),
        server_default="0.2",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "expires_at",
            sa.BigInteger(),
            server_default=sa.text(
                "CAST(ROUND(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000) AS BIGINT)"
            ),
            nullable=False,
        ),
    )
    op.alter_column(
        "user_settings",
        "llm_temperature",
        existing_type=sa.Float(),
        server_default="0.2",
        existing_nullable=False,
    )