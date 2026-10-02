from decimal import Decimal
from datetime import date
from typing import List, Optional, Dict
from pydantic import BaseModel, Field, field_validator

VALID_CATEGORIES = {
    "Meals",
    "Travel",
    "Accommodation",
    "Office Supplies",
    "Software",
    "Transportation",
    "Other"
}

class ReceiptLineItemSchema(BaseModel):
    line_number: int = Field(..., ge=1, description="1-indexed line position")
    description: str = Field(..., min_length=1, max_length=512)
    quantity: Optional[Decimal] = Field(default=Decimal("1.0"), ge=0)
    unit_price: Optional[Decimal] = Field(default=None, ge=0)
    total_price: Optional[Decimal] = Field(default=None, ge=0)

class ReceiptExtractionRequest(BaseModel):
    ocr_raw_text: str = Field(..., description="Raw text output from OCR")
    image_base64: Optional[str] = Field(default=None, description="Optional base64 receipt image")
    mime_type: Optional[str] = Field(default=None, description="Mime type of the image if provided")

class ReceiptExtractionResponse(BaseModel):
    merchant_name: Optional[str] = Field(default=None, max_length=255)
    receipt_date: Optional[date] = Field(default=None)
    total_amount: Optional[Decimal] = Field(default=None, ge=0)
    subtotal_amount: Optional[Decimal] = Field(default=None, ge=0)
    tax_amount: Optional[Decimal] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default="USD", max_length=3)
    receipt_number: Optional[str] = Field(default=None, max_length=100)
    suggested_category: str = Field(default="Other")
    line_items: List[ReceiptLineItemSchema] = Field(default_factory=list)
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    is_flagged_for_review: bool = Field(default=False)
    review_reasons: List[str] = Field(default_factory=list)
    field_confidences: Dict[str, float] = Field(default_factory=dict)
    raw_model_response: Optional[str] = Field(default=None)
    model_provider: Optional[str] = Field(default=None)
    model_name: Optional[str] = Field(default=None)

    @field_validator("suggested_category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            return "Other"
        return v

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return "USD"
        cleaned = v.strip().upper()
        return cleaned[:3] if cleaned else "USD"
