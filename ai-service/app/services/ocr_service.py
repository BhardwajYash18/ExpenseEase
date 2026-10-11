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
    Extract text using RapidOCR with spatial-aware line merging.

    RapidOCR detects text boxes independently. On receipts where labels
    (e.g., "Total Amount") are left-aligned and amounts (e.g., "$8.75") are
    right-aligned, they end up as separate text-detection boxes. This function
    uses box coordinates to merge fragments that share the same visual line,
    producing coherent lines like "Total Amount $8.75" instead of two separate
    lines "Total Amount" and "$8.75".
    """
    engine = get_rapid_ocr()
    if engine is None:
        return ""

    try:
        result, _ = engine(image_bytes)
        if not result:
            return ""

        # Collect detections with spatial information
        detections = []
        for item in result:
            if not item or len(item) < 2 or not item[1]:
                continue
            box = item[0]   # [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            text = str(item[1]).strip()
            if not text:
                continue
            # Calculate vertical center and left edge from bounding box
            y_center = sum(pt[1] for pt in box) / 4.0
            x_left = min(pt[0] for pt in box)
            box_height = max(pt[1] for pt in box) - min(pt[1] for pt in box)
            detections.append({
                'y_center': y_center,
                'x_left': x_left,
                'text': text,
                'height': max(box_height, 1),
            })

        if not detections:
            return ""

        # Compute dynamic Y-threshold from average text-box height.
        # Boxes whose Y centers are within this threshold are on the same visual line.
        avg_height = sum(d['height'] for d in detections) / len(detections)
        y_threshold = max(avg_height * 0.6, 10)  # At least 10px

        # Sort all detections top-to-bottom
        detections.sort(key=lambda d: d['y_center'])

        # Group detections into visual lines
        lines = []
        current_line = [detections[0]]

        for det in detections[1:]:
            if abs(det['y_center'] - current_line[0]['y_center']) < y_threshold:
                current_line.append(det)
            else:
                lines.append(current_line)
                current_line = [det]
        lines.append(current_line)

        # Within each line, sort left-to-right and join with spaces
        merged_lines = []
        for line_dets in lines:
            line_dets.sort(key=lambda d: d['x_left'])
            merged_text = " ".join(d['text'] for d in line_dets)
            merged_lines.append(merged_text)

        full_text = "\n".join(merged_lines).strip()
        logger.info(
            "RapidOCR extracted %d characters across %d merged lines (from %d raw detections)",
            len(full_text), len(merged_lines), len(detections)
        )
        return full_text
    except Exception as e:
        logger.error("RapidOCR execution error: %s", str(e))
        return ""


def extract_text(image_bytes: bytes, raw_image_bytes: bytes = None) -> dict:
    """
    Extract raw text from an image using resilient multi-engine OCR pipeline:
    1. Try Tesseract OCR if available (benefits from heavy preprocessing / Otsu).
    2. Fall back to RapidOCR (ONNX neural OCR):
       a. Try raw (unprocessed) image first — neural OCR works best on originals.
       b. Try preprocessed image as fallback.
       c. Keep the result with more extracted text.

    Args:
        image_bytes: Preprocessed image bytes (may be Otsu-binarized or light-preprocessed)
        raw_image_bytes: Optional original unmodified image bytes

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

    # Step 1: Try Tesseract if installed (works best with binarized input)
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
        rapid_raw_text = ""
        rapid_prep_text = ""

        # Try raw image FIRST — RapidOCR (neural OCR) works best on unmodified images
        if raw_image_bytes:
            rapid_raw_text = extract_with_rapid_ocr(raw_image_bytes)

        # Also try preprocessed image (may help with very noisy/dark images)
        rapid_prep_text = extract_with_rapid_ocr(image_bytes)

        # Pick the result with more text content (proxy for OCR quality)
        if rapid_raw_text and rapid_prep_text:
            if len(rapid_raw_text) >= len(rapid_prep_text):
                extracted_text = rapid_raw_text
                logger.info("RapidOCR: using raw image result (%d chars vs %d preprocessed)",
                            len(rapid_raw_text), len(rapid_prep_text))
            else:
                extracted_text = rapid_prep_text
                logger.info("RapidOCR: using preprocessed result (%d chars vs %d raw)",
                            len(rapid_prep_text), len(rapid_raw_text))
        elif rapid_raw_text:
            extracted_text = rapid_raw_text
        elif rapid_prep_text:
            extracted_text = rapid_prep_text

        if extracted_text:
            engine_used = "rapidocr"
            error_details = None

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
