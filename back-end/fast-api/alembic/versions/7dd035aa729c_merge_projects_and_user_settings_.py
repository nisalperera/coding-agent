"""merge projects and user settings migrations

Revision ID: 7dd035aa729c
Revises: 20261022_projects, 9e19688f60f0
Create Date: 2026-10-22 23:44:53.239022

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7dd035aa729c'
down_revision: Union[str, Sequence[str], None] = ('20261022_projects', '9e19688f60f0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
