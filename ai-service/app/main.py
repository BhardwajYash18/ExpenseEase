import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai_router import router as ai_router
from app.api.health import router as health_router
from app.api.ocr import router as ocr_router
from app.api.receipt_understanding import router as receipt_understanding_router
from app.core.config import settings

logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

app = FastAPI(
    title="ExpenseEase AI Service",
    description="Dedicated AI and document-processing service for ExpenseEase",
    version="1.0.0",
)

# CORS — restrict to same-origin in production; allow all in dev/test
_cors_origins = (
    ["*"] if settings.ENVIRONMENT in ("development", "test") else []
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# Health check (GET /health)
app.include_router(health_router)
# Raw OCR text extraction (POST /ocr/extract)
app.include_router(ocr_router)
# Text-based receipt understanding (POST /receipt-understanding/extract)
app.include_router(receipt_understanding_router)
# CP4: Unified AI pipeline — file upload → OCR → LLM (POST /ai/receipt/process)
app.include_router(ai_router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
