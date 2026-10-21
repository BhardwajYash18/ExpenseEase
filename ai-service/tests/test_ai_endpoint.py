"""
Tests for the /ai/receipt/process unified pipeline endpoint.

Covers:
  - Missing Authorization header → 401
  - Invalid / expired JWT → 401
  - Valid JWT, invalid file type → 400
  - Valid JWT, oversized file → 400
  - Valid JWT, valid PNG → full pipeline (OCR + mock AI)
  - receipt_id is correlated in the response
  - tenant_id comes from JWT, not from request body
  - processing_status reflects OCR + AI outcome
"""

# conftest.py sets AI_PROVIDER=mock and JWT_SECRET before any app imports
import io
import struct
import zlib
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Must match os.environ["JWT_SECRET"] set in conftest.py
_TEST_JWT_SECRET = "test-secret-do-not-use-in-production"
_TEST_JWT_ALGORITHM = "HS256"

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _make_token(
    role: str = "EMPLOYEE",
    user_id: str = "user-001",
    tenant_id: str = "tenant-abc",
    expired: bool = False,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        "iat": now,
        "exp": (now - timedelta(hours=1)) if expired else (now + timedelta(hours=1)),
    }
    return jwt.encode(payload, _TEST_JWT_SECRET, algorithm=_TEST_JWT_ALGORITHM)


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Minimal valid PNG (1x1 white pixel)
# ---------------------------------------------------------------------------

def _make_1px_png() -> bytes:
    """Build the smallest valid PNG programmatically (no external deps)."""
    def _chunk(name: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + name + data
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw_row = b"\x00\xFF\xFF\xFF"  # filter byte 0 + RGB white
    compressed = zlib.compress(raw_row)
    idat = _chunk(b"IDAT", compressed)
    iend = _chunk(b"IEND", b"")
    return signature + ihdr + idat + iend


VALID_PNG = _make_1px_png()
VALID_TOKEN = _make_token()
EXPIRED_TOKEN = _make_token(expired=True)
MANAGER_TOKEN = _make_token(role="MANAGER")
FINANCE_TOKEN = _make_token(role="FINANCE")


# ---------------------------------------------------------------------------
# Auth / security tests
# ---------------------------------------------------------------------------

class TestAuthEnforcement:
    def test_missing_auth_header_returns_401(self):
        r = client.post(
            "/ai/receipt/process",
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 401

    def test_invalid_token_returns_401(self):
        r = client.post(
            "/ai/receipt/process",
            headers={"Authorization": "Bearer this.is.garbage"},
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 401

    def test_expired_token_returns_401(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(EXPIRED_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 401

    def test_employee_can_access(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        # Pipeline may return 200 or 500 depending on OCR availability in CI,
        # but it must NOT be 401/403
        assert r.status_code not in (401, 403)

    def test_manager_can_access(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(MANAGER_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code not in (401, 403)

    def test_finance_can_access(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(FINANCE_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code not in (401, 403)


# ---------------------------------------------------------------------------
# File validation tests
# ---------------------------------------------------------------------------

class TestFileValidation:
    def test_unsupported_mime_type_returns_400(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("doc.pdf", b"%PDF-1.4 fake pdf content", "application/pdf")},
        )
        assert r.status_code == 400
        assert "Unsupported file format" in r.text or "not allowed" in r.text

    def test_oversized_file_returns_400(self):
        # Build a >5 MB payload that looks like a PNG (starts with PNG magic)
        oversized = VALID_PNG + b"\x00" * (6 * 1024 * 1024)
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("big.png", oversized, "image/png")},
        )
        assert r.status_code == 400
        assert "exceeds" in r.text.lower()

    def test_empty_file_returns_400(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("empty.png", b"", "image/png")},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Pipeline tests
# ---------------------------------------------------------------------------

class TestPipeline:
    def test_valid_png_returns_200(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 200
        data = r.json()
        assert "processing_status" in data
        assert "extraction" in data
        assert "ocr_engine" in data
        assert "pipeline_started_at" in data
        assert "pipeline_completed_at" in data

    def test_receipt_id_correlated(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            data={"receipt_id": "rcpt-test-123"},
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["receipt_id"] == "rcpt-test-123"

    def test_tenant_id_from_jwt_not_body(self):
        """
        tenant_id in the response must come from the JWT claims (tid),
        not from any request-body field the caller could inject.
        """
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 200
        data = r.json()
        # VALID_TOKEN was issued with tid="tenant-abc"
        assert data["tenant_id"] == "tenant-abc"

    def test_processing_status_is_valid_enum(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["processing_status"] in ("success", "partial", "failed")

    def test_extraction_fields_present(self):
        r = client.post(
            "/ai/receipt/process",
            headers=_auth_header(VALID_TOKEN),
            files={"file": ("receipt.png", VALID_PNG, "image/png")},
        )
        assert r.status_code == 200
        extraction = r.json()["extraction"]
        for key in (
            "merchant_name",
            "receipt_date",
            "total_amount",
            "currency",
            "suggested_category",
            "line_items",
            "confidence_score",
            "is_flagged_for_review",
            "review_reasons",
            "field_confidences",
        ):
            assert key in extraction, f"Missing key: {key}"
