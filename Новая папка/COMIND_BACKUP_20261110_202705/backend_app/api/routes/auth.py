import sqlite3

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется авторизация",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный или просроченный токен",
            headers={"WWW-Authenticate": "Bearer"},
        )

    with get_db() as connection:
        user = connection.execute(
            "SELECT id, username, email, created_at, COALESCE(is_admin, 0) AS is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if user is None:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    return dict(user)


@router.post("/register", response_model=UserResponse, status_code=201)
def register(data: RegisterRequest):
    with get_db() as connection:
        try:
            cursor = connection.execute(
                """
                INSERT INTO users (username, email, password_hash)
                VALUES (?, ?, ?)
                """,
                (
                    data.username,
                    str(data.email).lower(),
                    hash_password(data.password),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=409,
                detail="Имя пользователя или email уже заняты",
            )

        user = connection.execute(
            "SELECT id, username, email, created_at, COALESCE(is_admin, 0) AS is_admin FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return dict(user)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest):
    with get_db() as connection:
        user = connection.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (str(data.email).lower(),),
        ).fetchone()

    if user is None or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Неверный email или пароль",
        )

    return {
        "access_token": create_access_token(user["id"]),
        "token_type": "bearer",
    }


@router.get("/me", response_model=UserResponse)
def me(user: dict = Depends(current_user)):
    return user
