from fastapi import APIRouter, HTTPException, status
from app.schemas.receipt_extraction import ReceiptExtractionRequest, ReceiptExtractionResponse
from app.services.receipt_understanding_service import receipt_understanding_service

router = APIRouter(prefix="/receipt-understanding", tags=["Receipt Understanding"])

@router.post(
    "/extract",
    response_model=ReceiptExtractionResponse,
    status_code=status.HTTP_200_OK,
    summary="Extract structured receipt fields using AI understanding"
)
async def extract_receipt_fields(request: ReceiptExtractionRequest) -> ReceiptExtractionResponse:
    try:
        result = await receipt_understanding_service.extract_receipt_data(
            ocr_raw_text=request.ocr_raw_text,
            image_base64=request.image_base64,
            mime_type=request.mime_type
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Receipt understanding processing failed: {str(e)}"
        )
