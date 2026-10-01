"""
OCR service module using Tesseract OCR.

Extracts raw text from preprocessed receipt images.
OCR output is treated as UNTRUSTED extracted data — it is NOT authoritative
for policy, accounting, or business decisions.

AI/VLM receipt understanding is intentionally deferred to Checkpoint 4.
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Tesseract configuration for receipt text extraction
# PSM 6 = Assume a single uniform block of text (good for receipts)
TESSERACT_CONFIG = '--oem 3 --psm 6'


def extract_text(image_bytes: bytes) -> dict:
    """
    Extract raw text from an image using Tesseract OCR.

    Args:
        image_bytes: Preprocessed image bytes (PNG format expected)

    Returns:
        dict with keys:
            - raw_text (str): Extracted text, or empty string on failure
            - ocr_engine (str): OCR engine identifier
            - ocr_status (str): 'COMPLETED' or 'FAILED'
            - error_message (str|None): Error details if failed
            - processed_at (str): ISO 8601 timestamp
    """
    try:
        import pytesseract
        from PIL import Image
        import io

        image = Image.open(io.BytesIO(image_bytes))

        raw_text = pytesseract.image_to_string(image, config=TESSERACT_CONFIG)

        # Strip excessive whitespace but preserve structure
        raw_text = raw_text.strip()

        logger.info(
            "OCR extraction complete: %d characters extracted",
            len(raw_text)
        )

        return {
            'raw_text': raw_text,
            'ocr_engine': 'tesseract',
            'ocr_status': 'COMPLETED',
            'error_message': None,
            'processed_at': datetime.now(timezone.utc).isoformat(),
        }

    except ImportError:
        error_msg = "pytesseract is not installed or Tesseract binary not found"
        logger.error("OCR extraction failed: %s", error_msg)
        return {
            'raw_text': '',
            'ocr_engine': 'tesseract',
            'ocr_status': 'FAILED',
            'error_message': error_msg,
            'processed_at': datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        error_msg = str(e)
        logger.error("OCR extraction failed: %s", error_msg)
        return {
            'raw_text': '',
            'ocr_engine': 'tesseract',
            'ocr_status': 'FAILED',
            'error_message': error_msg,
            'processed_at': datetime.now(timezone.utc).isoformat(),
        }
