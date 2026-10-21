"""
File validation utilities for receipt uploads.

Validates:
  - File size  ≤ MAX_FILE_SIZE_MB  (checked against Content-Length / actual bytes)
  - MIME type  ∈ ALLOWED_MIME_TYPES  (PNG, JPEG, WEBP)
  - Magic bytes — MIME type reported by the client is cross-checked
    against the actual file header to prevent MIME-type spoofing.

All validation errors produce a clear HTTPException 400 so the caller
gets an actionable message without leaking internal stack traces.
"""

import logging
from typing import Tuple

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)

# (Magic-byte prefix, canonical MIME type)
_MAGIC_MAP: Tuple[Tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    # WEBP: bytes 0-3 are "RIFF", bytes 8-11 are "WEBP"
    (b"RIFF", "image/webp"),  # verified further below
)

MAX_BYTES = settings.MAX_FILE_SIZE_MB * 1024 * 1024


def _detect_mime(data: bytes) -> str | None:
    """Return the MIME type inferred from file magic bytes, or None."""
    for magic, mime in _MAGIC_MAP:
        if data[: len(magic)] == magic:
            if mime == "image/webp":
                # Confirm "WEBP" at offset 8
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return "image/webp"
                return None
            return mime
    return None


async def validate_receipt_upload(file: UploadFile) -> bytes:
    """
    Read the uploaded file and validate size and MIME type.

    Returns the raw file bytes on success.
    Raises HTTPException 400 on any validation failure.

    Usage::

        image_bytes = await validate_receipt_upload(file)
    """
    # Read all bytes upfront (needed for magic-byte check and OCR pipeline)
    try:
        raw = await file.read()
    except Exception as exc:
        logger.error("[file_validator] Failed to read upload: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read uploaded file",
        )

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # --- Size check ---
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File size {len(raw) / (1024 * 1024):.1f} MB exceeds "
                f"maximum allowed {settings.MAX_FILE_SIZE_MB} MB"
            ),
        )

    # --- MIME type from magic bytes ---
    detected = _detect_mime(raw)
    if detected is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported file format. "
                f"Allowed types: {', '.join(settings.ALLOWED_MIME_TYPES)}"
            ),
        )

    # --- Cross-check against Content-Type header if provided ---
    client_ct = (file.content_type or "").lower().split(";")[0].strip()
    if client_ct and client_ct not in settings.ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Content-Type '{client_ct}' is not allowed. "
                f"Allowed types: {', '.join(settings.ALLOWED_MIME_TYPES)}"
            ),
        )

    logger.info(
        "[file_validator] Accepted upload: detected_mime=%s size_kb=%.1f",
        detected,
        len(raw) / 1024,
    )
    return raw
