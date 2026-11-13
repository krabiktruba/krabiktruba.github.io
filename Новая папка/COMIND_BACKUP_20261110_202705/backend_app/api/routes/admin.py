from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import current_user
from app.core.database import get_db

router = APIRouter(prefix="/api/admin", tags=["Administration"])


class AdminUpdate(BaseModel):
    is_admin: bool


def require_admin(user: dict) -> None:
    if not bool(user.get("is_admin", 0)):
        raise HTTPException(status_code=403, detail="Доступ только для администратора")


@router.get("/users")
def list_users(user: dict = Depends(current_user)):
    require_admin(user)
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT id, username, email, created_at,
                   COALESCE(is_admin, 0) AS is_admin
            FROM users
            ORDER BY id
            """
        ).fetchall()
        return [dict(row) for row in rows]


@router.patch("/users/{user_id}/admin")
def update_admin(
    user_id: int,
    data: AdminUpdate,
    user: dict = Depends(current_user),
):
    require_admin(user)

    if user_id == user["id"] and not data.is_admin:
        raise HTTPException(
            status_code=400,
            detail="Нельзя снять права администратора со своего аккаунта",
        )

    with get_db() as connection:
        target = connection.execute(
            "SELECT id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

        if target is None:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        connection.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?",
            (1 if data.is_admin else 0, user_id),
        )

    return {"status": "updated", "user_id": user_id, "is_admin": data.is_admin}
