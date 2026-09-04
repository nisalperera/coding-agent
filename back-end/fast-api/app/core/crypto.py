"""Symmetric encryption for provider OAuth tokens at rest.

Uses Fernet from ``cryptography``. Configure
INTEGRATION_TOKEN_ENCRYPTION_KEY as a urlsafe-base64-encoded 32-byte Fernet key:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class TokenEncryptionError(RuntimeError):
    """Raised when token encryption or decryption cannot be performed safely."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    settings.require_integration_encryption()
    try:
        return Fernet(settings.INTEGRATION_TOKEN_ENCRYPTION_KEY.encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise TokenEncryptionError(
            "INTEGRATION_TOKEN_ENCRYPTION_KEY must be a valid urlsafe-base64 "
            "32-byte Fernet key"
        ) from exc


def encrypt_token(plaintext: str) -> str:
    """Encrypt a non-empty provider token for ciphertext storage."""
    if not plaintext:
        raise TokenEncryptionError("Cannot encrypt an empty token")
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a non-empty provider token read from ciphertext storage."""
    if not ciphertext:
        raise TokenEncryptionError("Cannot decrypt an empty ciphertext")
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError) as exc:
        raise TokenEncryptionError(
            "Token ciphertext is invalid or was encrypted with a different key"
        ) from exc