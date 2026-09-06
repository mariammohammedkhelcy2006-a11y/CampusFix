import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jwt
import psycopg
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

import database
from models import UserRole


load_dotenv(Path(__file__).resolve().parents[1] / ".env")

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
TOKEN_EXPIRE_MINUTES = 60


def hash_password(password: str) -> str:
	return password_hash.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
	return password_hash.verify(password, stored_hash)


def create_access_token(user: dict[str, Any]) -> str:
	secret_key = os.getenv("JWT_SECRET_KEY")
	if not secret_key:
		raise RuntimeError("JWT_SECRET_KEY is not configured")
	expires_at = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
	return jwt.encode(
		{"sub": str(user["id"]), "exp": expires_at},
		secret_key,
		algorithm="HS256",
	)


def get_current_user(
	credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
	if credentials is None:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

	secret_key = os.getenv("JWT_SECRET_KEY")
	if not secret_key:
		raise HTTPException(status_code=503, detail="Authentication is unavailable")
	try:
		payload = jwt.decode(credentials.credentials, secret_key, algorithms=["HS256"])
		user_id = int(payload["sub"])
	except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

	try:
		user = database.get_user_by_id(user_id)
	except (RuntimeError, psycopg.Error):
		raise HTTPException(status_code=503, detail="Authentication is unavailable")
	if user is None:
		raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
	return user


def require_admin(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
	if current_user["role"] != UserRole.ADMIN.value:
		raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
	return current_user