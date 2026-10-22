"""convert user settings timestamps to epoch milliseconds

Revision ID: 755acc6ee7f0
Revises: df4f637ddd6c
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "755acc6ee7f0"
down_revision: Union[str, Sequence[str], None] = "df4f637ddd6c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EPOCH_MS_DEFAULT = sa.text(
    "CAST(ROUND(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000) AS BIGINT)"
)


def _convert_timestamptz_to_epoch_ms(
    source_column: str,
    target_column: str,
    *,
    nullable: bool,
) -> None:
    op.add_column("user_settings", sa.Column(target_column, sa.BigInteger(), nullable=True))
    op.execute(
        sa.text(
            f"""
            UPDATE user_settings
            SET {target_column} = CASE
                WHEN {source_column} IS NULL THEN NULL
                ELSE ROUND(EXTRACT(EPOCH FROM {source_column}) * 1000)::bigint
            END
            """
        )
    )
    if not nullable:
        op.alter_column("user_settings", target_column, existing_type=sa.BigInteger(), nullable=False)

    op.drop_column("user_settings", source_column)
    op.alter_column(
        "user_settings",
        target_column,
        new_column_name=source_column,
        existing_type=sa.BigInteger(),
        existing_nullable=nullable,
    )
    if not nullable:
        op.alter_column(
            "user_settings",
            source_column,
            existing_type=sa.BigInteger(),
            existing_nullable=False,
            server_default=EPOCH_MS_DEFAULT,
        )


def upgrade() -> None:
    op.alter_column(
        "user_settings",
        "llm_endpoint_url",
        existing_type=sa.String(length=2048),
        server_default="https://llm.nisalchperera.com/v1/chat/completions",
        existing_nullable=False,
    )
    op.alter_column(
        "user_settings",
        "llm_temperature",
        existing_type=sa.Float(),
        server_default="0.2",
        existing_nullable=False,
    )
    _convert_timestamptz_to_epoch_ms("created_at", "created_at_ms", nullable=False)
    _convert_timestamptz_to_epoch_ms("updated_at", "updated_at_ms", nullable=False)
    _convert_timestamptz_to_epoch_ms("last_seen_at", "last_seen_at_ms", nullable=True)


def downgrade() -> None:
    def restore_epoch_ms(source_column: str, target_column: str, *, nullable: bool) -> None:
        op.add_column("user_settings", sa.Column(target_column, sa.DateTime(timezone=True), nullable=True))
        op.execute(
            sa.text(
                f"""
                UPDATE user_settings
                SET {target_column} = CASE
                    WHEN {source_column} IS NULL THEN NULL
                    ELSE to_timestamp({source_column} / 1000.0)
                END
                """
            )
        )
        if not nullable:
            op.alter_column(
                "user_settings",
                target_column,
                existing_type=sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            )
        op.drop_column("user_settings", source_column)
        op.alter_column(
            "user_settings",
            target_column,
            new_column_name=source_column,
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=nullable,
        )

    restore_epoch_ms("last_seen_at", "last_seen_at_ts", nullable=True)
    restore_epoch_ms("updated_at", "updated_at_ts", nullable=False)
    restore_epoch_ms("created_at", "created_at_ts", nullable=False)
    op.alter_column("user_settings", "llm_temperature", existing_type=sa.Float(), server_default="0.2", existing_nullable=False)