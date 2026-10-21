"""
JWT-based RBAC dependency for ExpenseEase AI Service.

Tokens are issued by the Node.js backend using HS256 and the shared
JWT_SECRET.  This module verifies those tokens so every protected
endpoint inherits the same auth posture as the main backend.

Claims payload expected from the backend:
  sub  – user UUID
  tid  – tenant UUID
  role – EMPLOYEE | MANAGER | FINANCE
  iat  – issued-at
  exp  – expiry
"""

import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)

ALLOWED_ROLES = {"EMPLOYEE", "MANAGER", "FINANCE"}


class AuthContext:
    """Parsed and validated JWT claims attached to a request."""

    def __init__(self, user_id: str, tenant_id: str, role: str) -> None:
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.role = role

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AuthContext user={self.user_id} role={self.role}>"


def _verify_token(token: str) -> dict:
    """
    Decode and verify a JWT.

    Raises HTTPException 401 for all decode failures so callers never
    receive a raw exception that leaks internal detail.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("[security] JWT expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("[security] Invalid JWT: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> AuthContext:
    """
    FastAPI dependency — require a valid JWT from any allowed role.

    Usage::

        @router.post("/...")
        async def endpoint(auth: AuthContext = Depends(require_auth)):
            ...
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _verify_token(credentials.credentials)

    user_id: Optional[str] = payload.get("sub")
    tenant_id: Optional[str] = payload.get("tid")
    role: Optional[str] = payload.get("role")

    if not user_id or not tenant_id or not role:
        logger.warning("[security] JWT missing required claims")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing required claims",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if role not in ALLOWED_ROLES:
        logger.warning("[security] Unrecognised role in JWT: %s", role)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )

    return AuthContext(user_id=user_id, tenant_id=tenant_id, role=role)
