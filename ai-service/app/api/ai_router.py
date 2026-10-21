"""
Unified AI receipt processing endpoint.

POST /ai/receipt/process

Full pipeline:
  1. JWT RBAC — any authenticated role (EMPLOYEE, MANAGER, FINANCE).
  2. File validation — size ≤ 5 MB, type ∈ {PNG, JPEG, WEBP}.
  3. Image preprocessing — EXIF rotation, perspective warp, CLAHE, binarisation.
  4. OCR — Tesseract (primary) → RapidOCR (fallback).
  5. AI receipt understanding — LLM (if configured) or mock provider.
  6. Pydantic schema validation of LLM output.
  7. Structured, audit-ready JSON response.

The endpoint is the authoritative Checkpoint-4 integration point:
it replaces the existing /receipt-understanding/extract (which still
accepts raw OCR text) for file-based flows from the Node.js backend.

Security notes:
  - JWT is verified against the same secret as the Node.js backend.
  - receipt_id and tenant_id are logged for audit; image bytes are NOT.
  - OCR text is treated as UNTRUSTED data in the LLM prompt.
  - AI output is fully schema-validated before being returned.
"""

import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, status
from pydantic import BaseModel, Field

from app.core.security import AuthContext, require_auth
from app.processors.image_preprocessor import preprocess_image, preprocess_image_light
from app.schemas.receipt_extraction import ReceiptExtractionResponse
from app.services.ocr_service import extract_text
from app.services.receipt_understanding_service import ReceiptUnderstandingService
from app.utils.file_validator import validate_receipt_upload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["AI Receipt Processing"])


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------

class ReceiptProcessResponse(BaseModel):
    """
    Structured, audit-ready response for the full receipt processing pipeline.
    Wraps ReceiptExtractionResponse with pipeline metadata.
    """

    # Pipeline metadata
    receipt_id: Optional[str] = Field(
        default=None,
        description="Caller-supplied receipt UUID for audit correlation",
    )
    tenant_id: Optional[str] = Field(
        default=None,
        description="Tenant UUID from the verified JWT (never trusted from request body)",
    )
    processing_status: str = Field(
        description="Overall status: 'success' | 'partial' | 'failed'"
    )
    ocr_engine: str = Field(description="OCR engine used: 'tesseract' | 'rapidocr'")
    ocr_status: str = Field(description="OCR result: 'COMPLETED' | 'FAILED'")
    ocr_error: Optional[str] = Field(
        default=None, description="OCR error message if ocr_status == 'FAILED'"
    )
    pipeline_started_at: str = Field(description="ISO 8601 UTC timestamp")
    pipeline_completed_at: str = Field(description="ISO 8601 UTC timestamp")

    # Extracted receipt data
    extraction: ReceiptExtractionResponse


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/receipt/process",
    response_model=ReceiptProcessResponse,
    status_code=status.HTTP_200_OK,
    summary="Full receipt processing pipeline: upload → OCR → AI extraction",
    description=(
        "Accepts a receipt image, pre-processes it, runs OCR, invokes the configured "
        "AI provider for structured field extraction, and returns a validated, "
        "audit-ready JSON response.  Requires a valid JWT from any RBAC role."
    ),
)
async def process_receipt(
    file: UploadFile = File(..., description="Receipt image (PNG / JPEG / WEBP, max 5 MB)"),
    receipt_id: Optional[str] = Form(
        default=None,
        description="Optional receipt UUID for audit log correlation",
    ),
    auth: AuthContext = Depends(require_auth),
) -> ReceiptProcessResponse:
    """
    End-to-end receipt processing pipeline.

    Steps:
      1. Validate file (size, MIME type).
      2. Pre-process image (EXIF fix, perspective warp, CLAHE, binarisation).
      3. Extract raw text via OCR.
      4. Send OCR text (+optional image) to the AI provider.
      5. Return structured, schema-validated extraction.
    """
    started_at = datetime.now(timezone.utc).isoformat()

    log_prefix = f"[receipt_process] receipt_id={receipt_id or 'unknown'} tenant={auth.tenant_id}"
    logger.info("%s user=%s role=%s — pipeline started", log_prefix, auth.user_id, auth.role)

    # -----------------------------------------------------------------------
    # Step 1: File validation
    # -----------------------------------------------------------------------
    raw_image_bytes = await validate_receipt_upload(file)
    logger.info("%s file accepted size_kb=%.1f", log_prefix, len(raw_image_bytes) / 1024)

    # -----------------------------------------------------------------------
    # Step 2: Image preprocessing
    # -----------------------------------------------------------------------
    try:
        # Light preprocessing is preferred for neural OCR (RapidOCR)
        preprocessed_bytes = await asyncio.to_thread(preprocess_image_light, raw_image_bytes)
    except Exception as prep_err:
        logger.warning("%s light preprocessing failed (%s); trying full pipeline", log_prefix, str(prep_err))
        try:
            preprocessed_bytes = await asyncio.to_thread(preprocess_image, raw_image_bytes)
        except Exception:
            logger.warning("%s full preprocessing also failed; using raw bytes", log_prefix)
            preprocessed_bytes = raw_image_bytes

    # -----------------------------------------------------------------------
    # Step 3: OCR (CPU-bound → thread pool)
    # -----------------------------------------------------------------------
    ocr_result = await asyncio.to_thread(
        extract_text, preprocessed_bytes, raw_image_bytes
    )
    logger.info(
        "%s OCR engine=%s status=%s chars=%d",
        log_prefix,
        ocr_result["ocr_engine"],
        ocr_result["ocr_status"],
        len(ocr_result["raw_text"]),
    )

    # -----------------------------------------------------------------------
    # Step 4: AI receipt understanding
    # -----------------------------------------------------------------------
    # Pass the image as base64 to allow vision-capable models to use it.
    image_b64: Optional[str] = None
    mime_type: Optional[str] = None
    try:
        image_b64 = base64.b64encode(raw_image_bytes).decode("ascii")
        mime_type = (file.content_type or "image/png").split(";")[0].strip()
    except Exception:
        pass  # vision enrichment is optional — continue without it

    service = ReceiptUnderstandingService()
    extraction: ReceiptExtractionResponse = await service.extract_receipt_data(
        ocr_raw_text=ocr_result["raw_text"],
        image_base64=image_b64,
        mime_type=mime_type,
    )

    # -----------------------------------------------------------------------
    # Step 5: Derive overall processing_status
    # -----------------------------------------------------------------------
    if ocr_result["ocr_status"] == "FAILED" or extraction.is_flagged_for_review:
        if extraction.confidence_score == 0.0:
            processing_status = "failed"
        else:
            processing_status = "partial"
    else:
        processing_status = "success"

    completed_at = datetime.now(timezone.utc).isoformat()
    logger.info(
        "%s pipeline complete status=%s confidence=%.2f",
        log_prefix,
        processing_status,
        extraction.confidence_score,
    )

    return ReceiptProcessResponse(
        receipt_id=receipt_id,
        tenant_id=auth.tenant_id,
        processing_status=processing_status,
        ocr_engine=ocr_result["ocr_engine"],
        ocr_status=ocr_result["ocr_status"],
        ocr_error=ocr_result.get("error_message"),
        pipeline_started_at=started_at,
        pipeline_completed_at=completed_at,
        extraction=extraction,
    )
