from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "info"

    # --- JWT Security ---
    # Must match the JWT_SECRET used by the Node.js backend so tokens are
    # mutually verifiable.  No default is provided — startup fails fast if
    # the secret is missing in production.
    JWT_SECRET: str = "changeme-dev-only"
    JWT_ALGORITHM: str = "HS256"

    # --- AI Provider ---
    AI_PROVIDER: str = "mock"   # "mock" or "llm"
    AI_API_KEY: str = ""
    AI_BASE_URL: str = "https://api.openai.com/v1"
    AI_MODEL: str = "gpt-4o-mini"
    AI_TIMEOUT_SECONDS: float = 30.0
    AI_MAX_RETRIES: int = 1     # extra attempts after first LLM failure

    # --- File Validation ---
    MAX_FILE_SIZE_MB: int = 5
    ALLOWED_MIME_TYPES: List[str] = ["image/png", "image/jpeg", "image/webp"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

