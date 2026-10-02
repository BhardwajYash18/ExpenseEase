from abc import ABC, abstractmethod
from typing import Optional
from app.schemas.receipt_extraction import ReceiptExtractionResponse

class ReceiptUnderstandingProvider(ABC):
    @abstractmethod
    async def extract(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str] = None,
        mime_type: Optional[str] = None
    ) -> ReceiptExtractionResponse:
        """
        Extract structured receipt data from OCR text and optional image.
        """
        pass
