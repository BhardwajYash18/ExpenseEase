"""
Production LLM provider for ExpenseEase AI Service.

Implements the OpenAI chat-completions API (compatible with OpenAI,
Groq, Ollama, and any OpenAI-compatible endpoint) using httpx without
heavy vendor SDKs.

Robustness features:
  - Retry up to AI_MAX_RETRIES times on network / 5xx errors.
  - Per-field confidence validation:  missing or type-invalid fields
    are coerced to null / 0.0 rather than raising hard errors.
  - Vision support:  if the model name contains "vision" or "gpt-4o"
    and an image is provided, the request is sent as a multi-modal
    message.
  - Prompt-injection defence:  OCR text is wrapped in sentinel markers
    so the LLM sees it as inert data (see prompts/receipt_extraction.py).
  - All LLM errors are surfaced as structured partial responses rather
    than raw exceptions, preserving the audit trail.

Security:
  - api_key is never logged.
  - raw_model_response is stored for auditability but NEVER acted upon
    without Pydantic schema validation first.
"""

import asyncio
import json
import logging
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.prompts.receipt_extraction import SYSTEM_PROMPT, build_user_prompt
from app.schemas.receipt_extraction import ReceiptExtractionResponse
from app.services.providers.base import ReceiptUnderstandingProvider

logger = logging.getLogger(__name__)

# Fields that must be numeric (Decimal-coercible)
_DECIMAL_FIELDS = {"total_amount", "subtotal_amount", "tax_amount"}

# Confidence fields that must be float in [0, 1]
_CONFIDENCE_FIELD_NAMES = {"merchant", "date", "total_amount", "category"}


def _coerce_decimal(value: Any, field: str) -> Any:
    """
    Attempt to coerce *value* to a Decimal-compatible type.
    Returns None (and logs a warning) if coercion fails, so the
    downstream Pydantic model records null instead of crashing.
    """
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        logger.warning(
            "[llm_provider] Field '%s' has non-numeric value %r; setting to null",
            field,
            value,
        )
        return None


def _coerce_confidence(value: Any, key: str) -> float:
    """Clamp a confidence value to [0.0, 1.0], defaulting to 0.0."""
    try:
        f = float(value)
        if not (0.0 <= f <= 1.0):
            logger.warning(
                "[llm_provider] field_confidences['%s']=%r out of range; clamping", key, value
            )
            return max(0.0, min(1.0, f))
        return f
    except (TypeError, ValueError):
        return 0.0


def _sanitise_parsed(parsed: dict) -> dict:
    """
    Walk the parsed LLM JSON and:
      1. Coerce monetary fields to Decimal-safe values or null.
      2. Clamp field_confidences to [0.0, 1.0].
      3. Ensure review_reasons is a list of strings.
      4. Ensure line_items entries have required keys.

    This is the firewall between raw LLM output and our Pydantic schema.
    """
    for field in _DECIMAL_FIELDS:
        if field in parsed:
            parsed[field] = _coerce_decimal(parsed[field], field)

    # Normalise field_confidences
    fc = parsed.get("field_confidences")
    if not isinstance(fc, dict):
        parsed["field_confidences"] = {k: 0.0 for k in _CONFIDENCE_FIELD_NAMES}
    else:
        for key in _CONFIDENCE_FIELD_NAMES:
            fc[key] = _coerce_confidence(fc.get(key, 0.0), key)
        parsed["field_confidences"] = fc

    # Ensure review_reasons is a list of strings
    rr = parsed.get("review_reasons")
    if not isinstance(rr, list):
        parsed["review_reasons"] = []
    else:
        parsed["review_reasons"] = [str(r) for r in rr]

    # Clamp overall confidence_score
    cs = parsed.get("confidence_score", 0.0)
    parsed["confidence_score"] = _coerce_confidence(cs, "confidence_score")

    # Sanitise line_items
    items = parsed.get("line_items")
    if not isinstance(items, list):
        parsed["line_items"] = []
    else:
        clean_items = []
        for i, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            item.setdefault("line_number", i)
            item.setdefault("description", "Unknown item")
            for price_field in ("unit_price", "total_price"):
                item[price_field] = _coerce_decimal(item.get(price_field), price_field)
            try:
                item["quantity"] = Decimal(str(item.get("quantity", "1.0")))
            except Exception:
                item["quantity"] = Decimal("1.0")
            clean_items.append(item)
        parsed["line_items"] = clean_items

    return parsed


def _build_failed_response(reason: str, raw: Optional[str] = None) -> ReceiptExtractionResponse:
    """Return a minimal failed ReceiptExtractionResponse for audit visibility."""
    return ReceiptExtractionResponse(
        merchant_name=None,
        receipt_date=None,
        total_amount=None,
        subtotal_amount=None,
        tax_amount=None,
        currency="USD",
        receipt_number=None,
        suggested_category="Other",
        line_items=[],
        confidence_score=0.0,
        is_flagged_for_review=True,
        review_reasons=[reason],
        field_confidences={k: 0.0 for k in _CONFIDENCE_FIELD_NAMES},
        raw_model_response=raw,
        model_provider="llm",
        model_name="unknown",
    )


class ConfigurableLLMProvider(ReceiptUnderstandingProvider):
    """
    OpenAI-compatible HTTP provider using httpx without heavy vendor SDKs.
    Can connect to OpenAI, Ollama, Groq, or any OpenAI-compatible API.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o-mini",
        timeout: float = 30.0,
        max_retries: int = 1,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.max_retries = max(0, max_retries)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_messages(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str],
        mime_type: Optional[str],
    ) -> list:
        user_text = build_user_prompt(ocr_raw_text)

        # Vision support: gpt-4o / gpt-4-vision / models with "vision" in name
        use_vision = (
            image_base64
            and mime_type
            and mime_type in ("image/png", "image/jpeg", "image/webp")
            and any(kw in self.model.lower() for kw in ("vision", "gpt-4o"))
        )

        if use_vision:
            user_content = [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{image_base64}"},
                },
            ]
        else:
            user_content = user_text

        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

    async def _call_api(self, messages: list) -> str:
        """
        Make a single HTTP call to the LLM endpoint.

        Returns the raw content string from the first choice.
        Raises httpx exceptions on network / HTTP errors.
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        return data["choices"][0]["message"]["content"]

    async def _call_with_retry(self, messages: list) -> str:
        """
        Call _call_api up to (1 + max_retries) times with exponential backoff.
        Raises the last exception if all attempts fail.
        """
        last_exc: Exception = RuntimeError("No attempts made")
        for attempt in range(self.max_retries + 1):
            try:
                return await self._call_api(messages)
            except httpx.TimeoutException as exc:
                last_exc = exc
                logger.warning(
                    "[llm_provider] LLM request timed out (attempt %d/%d)",
                    attempt + 1,
                    self.max_retries + 1,
                )
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                logger.warning(
                    "[llm_provider] LLM HTTP %s (attempt %d/%d)",
                    exc.response.status_code,
                    attempt + 1,
                    self.max_retries + 1,
                )
                # Do not retry on client errors (4xx)
                if exc.response.status_code < 500:
                    raise
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "[llm_provider] LLM call error (attempt %d/%d): %s",
                    attempt + 1,
                    self.max_retries + 1,
                    str(exc),
                )

            if attempt < self.max_retries:
                await asyncio.sleep(2 ** attempt)  # 1 s, 2 s, …

        raise last_exc

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def extract(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str] = None,
        mime_type: Optional[str] = None,
    ) -> ReceiptExtractionResponse:
        messages = self._build_messages(ocr_raw_text, image_base64, mime_type)

        # --- Network / API call ---
        try:
            raw_content = await self._call_with_retry(messages)
        except httpx.TimeoutException:
            logger.error("[llm_provider] All retries exhausted: timeout")
            return _build_failed_response(
                "AI service timed out after all retries; manual review required"
            )
        except Exception as exc:
            logger.error("[llm_provider] All retries exhausted: %s", str(exc))
            return _build_failed_response(
                f"AI service unavailable: {type(exc).__name__}; manual review required"
            )

        # --- JSON parsing ---
        try:
            parsed: dict = json.loads(raw_content)
        except json.JSONDecodeError:
            logger.error(
                "[llm_provider] LLM returned non-JSON content (length=%d)", len(raw_content)
            )
            return _build_failed_response(
                "AI returned unparseable response; manual review required",
                raw=raw_content[:2000],  # truncate to avoid log bloat
            )

        if not isinstance(parsed, dict):
            return _build_failed_response(
                "AI response was not a JSON object", raw=raw_content[:2000]
            )

        # --- Field-level sanitisation ---
        parsed = _sanitise_parsed(parsed)

        # Inject provider metadata
        parsed["raw_model_response"] = raw_content
        parsed["model_provider"] = "llm"
        parsed["model_name"] = self.model

        # --- Pydantic schema validation ---
        try:
            return ReceiptExtractionResponse.model_validate(parsed)
        except ValidationError as exc:
            logger.error(
                "[llm_provider] Pydantic validation failed after sanitisation: %s",
                exc.json(indent=0),
            )
            # Return a partial response flagged for review rather than crashing
            return _build_failed_response(
                "AI response failed schema validation; manual review required",
                raw=raw_content[:2000],
            )
