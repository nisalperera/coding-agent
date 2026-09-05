from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.db.database import SessionLocal
from app.db.models import User
from app.db.users_repository import upsert_google_user_claims


def test_concurrent_google_upserts_create_one_user(google_claims: dict[str, object]) -> None:
    def sign_in() -> dict[str, object]:
        return upsert_google_user_claims(dict(google_claims))

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: sign_in(), range(2)))

    assert results[0]["user_id"] == results[1]["user_id"]

    with SessionLocal() as session:
        count = session.scalar(select(func.count()).select_from(User))
    assert count == 1