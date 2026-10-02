from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.health import router as health_router
from app.api.ocr import router as ocr_router
from app.api.receipt_understanding import router as receipt_understanding_router
from app.core.config import settings

app = FastAPI(
    title="ExpensEase AI Service",
    description="Dedicated AI and document-processing service for ExpensEase",
    version="0.1.0",
)

# Foundational CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount health routes (GET /health)
app.include_router(health_router)
# Mount OCR routes (POST /ocr/extract)
app.include_router(ocr_router)
# Mount Receipt Understanding routes (POST /receipt-understanding/extract)
app.include_router(receipt_understanding_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
