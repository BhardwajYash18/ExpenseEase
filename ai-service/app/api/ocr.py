"""
OCR API router for the AI service.

Accepts receipt images and returns raw OCR text.
This endpoint performs ONLY text extraction — no AI understanding,
no categorization, no policy decisions. Those are deferred to CP4.
"""

import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.processors.image_preprocessor import preprocess_image, preprocess_image_light
from app.services.ocr_service import extract_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ocr", tags=["OCR"])


class OCRResponse(BaseModel):
    """Response model for OCR extraction results."""
    raw_text: str
    ocr_engine: str
    ocr_status: str
    error_message: Optional[str] = None
    processed_at: str


@router.post("/extract", response_model=OCRResponse)
async def ocr_extract(file: UploadFile = File(...)):
    """
    Extract text from a receipt image using OCR.

    Pipeline: Image → Preprocessing → Tesseract OCR → Raw Text

    This endpoint does NOT perform:
    - AI/LLM receipt understanding
    - Structured field extraction
    - Expense categorization
    - Policy validation

    Those are deferred to Checkpoint 4.
    """
    # Read the uploaded file
    try:
        image_bytes = await file.read()
    except Exception as e:
        logger.error("Failed to read uploaded file: %s", str(e))
        raise HTTPException(status_code=400, detail="Failed to read uploaded file")

    if not image_bytes or len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Step 1: Light preprocessing for neural OCR (RapidOCR)
    # Light preprocessing preserves grayscale gradients that neural OCR models use.
    # Otsu binarization (preprocess_image) is kept for Tesseract if ever installed.
    try:
        preprocessed_bytes = preprocess_image_light(image_bytes)
    except ValueError as e:
        logger.warning("Light preprocessing failed: %s", str(e))
        try:
            preprocessed_bytes = preprocess_image(image_bytes)
        except ValueError:
            preprocessed_bytes = image_bytes

    # Step 2: Extract text via OCR
    # extract_text tries raw image first for RapidOCR (neural OCR works best on originals)
    result = extract_text(preprocessed_bytes, raw_image_bytes=image_bytes)

    return OCRResponse(**result)

