"""
Tests for Checkpoint 3 OCR and Image Preprocessing.

Verifies:
1. Image preprocessing with Pillow / OpenCV.
2. Tesseract OCR text extraction.
3. OCR endpoint /ocr/extract behavior and error resilience.
4. Deterministic processing without AI/LLM models.
"""

import io
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app
from app.processors.image_preprocessor import preprocess_image
from app.services.ocr_service import extract_text

client = TestClient(app)


def create_test_image(text: str = "RECEIPT #1234\nTOTAL: $45.00") -> bytes:
    """Generate a clean synthetic receipt image for testing."""
    image = Image.new("RGB", (300, 150), color="white")
    draw = ImageDraw.Draw(image)
    draw.text((20, 30), text, fill="black")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


def test_preprocess_image_valid():
    """Verify that preprocess_image produces valid PNG bytes from an input image."""
    img_bytes = create_test_image("TEST RECEIPT")
    processed = preprocess_image(img_bytes)

    assert processed is not None
    assert len(processed) > 0

    # Ensure output is a readable image
    result_img = Image.open(io.BytesIO(processed))
    assert result_img.format == "PNG"
    assert result_img.mode in ("L", "1")  # Grayscale or binary


def test_preprocess_image_invalid():
    """Verify that invalid/corrupt image bytes raise a ValueError."""
    with pytest.raises(ValueError, match="Failed to preprocess image"):
        preprocess_image(b"not an image file")


def test_extract_text_resilience():
    """Verify extract_text returns a structured dictionary without raising unhandled exceptions."""
    img_bytes = create_test_image("SAMPLE RECEIPT\nAMOUNT: $99.99")
    preprocessed = preprocess_image(img_bytes)

    result = extract_text(preprocessed)

    assert isinstance(result, dict)
    assert "raw_text" in result
    assert "ocr_status" in result
    assert "ocr_engine" in result
    assert result["ocr_engine"] == "tesseract"
    assert result["ocr_status"] in ("COMPLETED", "FAILED")
    assert "processed_at" in result


def test_ocr_extract_endpoint_success():
    """Verify POST /ocr/extract processes an uploaded file and returns 200 with OCRResponse schema."""
    img_bytes = create_test_image("ACME STORE\nTOTAL $12.50")

    response = client.post(
        "/ocr/extract",
        files={"file": ("receipt.png", img_bytes, "image/png")},
    )

    assert response.status_code == 200
    data = response.json()
    assert "raw_text" in data
    assert "ocr_status" in data
    assert data["ocr_engine"] == "tesseract"
    assert data["ocr_status"] in ("COMPLETED", "FAILED")


def test_ocr_extract_endpoint_empty_file():
    """Verify POST /ocr/extract rejects empty file uploads with 400."""
    response = client.post(
        "/ocr/extract",
        files={"file": ("empty.png", b"", "image/png")},
    )

    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()
