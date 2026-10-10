import logging
import io
from datetime import datetime, timezone
from PIL import Image

logger = logging.getLogger(__name__)

# Tesseract configuration for receipt text extraction
TESSERACT_CONFIG = '--oem 3 --psm 6'

_rapid_ocr_instance = None

def get_rapid_ocr():
    global _rapid_ocr_instance
    if _rapid_ocr_instance is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _rapid_ocr_instance = RapidOCR()
            logger.info("RapidOCR engine initialized successfully")
        except Exception as e:
            logger.warning("RapidOCR initialization failed: %s", str(e))
    return _rapid_ocr_instance


def extract_with_rapid_ocr(image_bytes: bytes) -> str:
    """
    Extract text using RapidOCR (ONNX Runtime-based offline OCR).
    """
    engine = get_rapid_ocr()
    if engine is None:
        return ""
    
    try:
        result, _ = engine(image_bytes)
        if not result:
            return ""
        lines = [line[1] for line in result if line and len(line) > 1 and line[1]]
        return "\n".join(lines).strip()
    except Exception as e:
        logger.error("RapidOCR execution error: %s", str(e))
        return ""


def extract_text(image_bytes: bytes, raw_image_bytes: bytes = None) -> dict:
    """
    Extract raw text from an image using resilient OCR pipeline:
    1. Try Tesseract OCR if available.
    2. Fall back to RapidOCR (ONNX) if Tesseract is not installed or returns empty text.
    3. Handles both preprocessed and raw image inputs.

    Args:
        image_bytes: Preprocessed or raw image bytes
        raw_image_bytes: Optional original image bytes for fallback

    Returns:
        dict with keys:
            - raw_text (str): Extracted text
            - ocr_engine (str): 'tesseract' or 'rapidocr'
            - ocr_status (str): 'COMPLETED' or 'FAILED'
            - error_message (str|None)
            - processed_at (str): ISO 8601 timestamp
    """
    extracted_text = ""
    engine_used = "tesseract"
    error_details = None

    # Step 1: Try Tesseract if installed
    try:
        import pytesseract
        image = Image.open(io.BytesIO(image_bytes))
        tess_text = pytesseract.image_to_string(image, config=TESSERACT_CONFIG).strip()
        if tess_text:
            extracted_text = tess_text
            engine_used = "tesseract"
            logger.info("Tesseract OCR extracted %d characters", len(tess_text))
    except Exception as tess_err:
        logger.info("Tesseract OCR unavailable or failed (%s); trying RapidOCR engine", str(tess_err))
        error_details = str(tess_err)

    # Step 2: Fallback to RapidOCR if Tesseract gave no text or failed
    if not extracted_text:
        # Try with preprocessed image bytes
        rapid_text = extract_with_rapid_ocr(image_bytes)
        
        # If preprocessed was empty and raw bytes available, try raw
        if not rapid_text and raw_image_bytes:
            rapid_text = extract_with_rapid_ocr(raw_image_bytes)

        if rapid_text:
            extracted_text = rapid_text
            engine_used = "rapidocr"
            error_details = None
            logger.info("RapidOCR extracted %d characters (%d lines)", len(rapid_text), len(rapid_text.splitlines()))

    processed_timestamp = datetime.now(timezone.utc).isoformat()

    if extracted_text:
        return {
            'raw_text': extracted_text,
            'ocr_engine': engine_used,
            'ocr_status': 'COMPLETED',
            'error_message': None,
            'processed_at': processed_timestamp,
        }
    else:
        return {
            'raw_text': '',
            'ocr_engine': engine_used,
            'ocr_status': 'FAILED',
            'error_message': error_details or 'OCR could not detect readable text in the image',
            'processed_at': processed_timestamp,
        }

