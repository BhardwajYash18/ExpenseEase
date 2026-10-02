from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "info"

    # AI Provider configuration
    AI_PROVIDER: str = "mock"  # "mock" or "llm"
    AI_API_KEY: str = ""
    AI_BASE_URL: str = "https://api.openai.com/v1"
    AI_MODEL: str = "gpt-4o-mini"
    AI_TIMEOUT_SECONDS: float = 30.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
