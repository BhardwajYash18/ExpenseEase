from fastapi import APIRouter

router = APIRouter(tags=["Health"])

@router.get("/health")
async def get_health():
    """Foundational health check endpoint."""
    return {"status": "ok"}
