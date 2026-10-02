import logging
from typing import Optional
from app.core.config import settings
from app.schemas.receipt_extraction import ReceiptExtractionResponse
from app.services.providers.base import ReceiptUnderstandingProvider
from app.services.providers.mock_provider import MockReceiptProvider
from app.services.providers.llm_provider import ConfigurableLLMProvider

logger = logging.getLogger(__name__)

class ReceiptUnderstandingService:
    def __init__(self, provider: Optional[ReceiptUnderstandingProvider] = None):
        if provider:
            self.provider = provider
        else:
            if settings.AI_PROVIDER == "llm" and settings.AI_API_KEY:
                self.provider = ConfigurableLLMProvider(
                    api_key=settings.AI_API_KEY,
                    base_url=settings.AI_BASE_URL,
                    model=settings.AI_MODEL,
                    timeout=settings.AI_TIMEOUT_SECONDS
                )
            else:
                self.provider = MockReceiptProvider()

    async def extract_receipt_data(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str] = None,
        mime_type: Optional[str] = None
    ) -> ReceiptExtractionResponse:
        """
        Extract structured receipt data using configured provider with graceful fallback.
        """
        try:
            return await self.provider.extract(
                ocr_raw_text=ocr_raw_text,
                image_base64=image_base64,
                mime_type=mime_type
            )
        except Exception as e:
            logger.error(f"[ReceiptUnderstandingService] Provider error: {str(e)}. Falling back to MockReceiptProvider.")
            # If the primary provider was not mock and failed, fall back to mock
            if not isinstance(self.provider, MockReceiptProvider):
                mock_provider = MockReceiptProvider()
                result = await mock_provider.extract(
                    ocr_raw_text=ocr_raw_text,
                    image_base64=image_base64,
                    mime_type=mime_type
                )
                result.review_reasons.append(f"Primary AI provider failed: {str(e)}; fallback used")
                result.is_flagged_for_review = True
                return result
            raise e

# Default singleton instance
receipt_understanding_service = ReceiptUnderstandingService()
