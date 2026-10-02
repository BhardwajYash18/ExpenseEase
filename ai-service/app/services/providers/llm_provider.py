import json
import logging
import httpx
from typing import Optional
from app.services.providers.base import ReceiptUnderstandingProvider
from app.schemas.receipt_extraction import ReceiptExtractionResponse
from app.prompts.receipt_extraction import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger(__name__)

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
        timeout: float = 30.0
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def extract(
        self,
        ocr_raw_text: str,
        image_base64: Optional[str] = None,
        mime_type: Optional[str] = None
    ) -> ReceiptExtractionResponse:
        user_content = build_user_prompt(ocr_raw_text)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content}
        ]

        # If vision support is available and image is provided
        if image_base64 and mime_type and "vision" in self.model.lower():
            messages[1] = {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_content},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_base64}"
                        }
                    }
                ]
            }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.0,
            "response_format": {"type": "json_object"}
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            data = response.json()

        raw_content = data["choices"][0]["message"]["content"]
        parsed = json.loads(raw_content)

        # Inject provider metadata
        parsed["raw_model_response"] = raw_content
        parsed["model_provider"] = "llm"
        parsed["model_name"] = self.model

        # Schema validate through Pydantic
        return ReceiptExtractionResponse.model_validate(parsed)
