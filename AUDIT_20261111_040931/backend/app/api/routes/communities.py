from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.routes.auth import current_user
from app.core.database import get_db
from app.schemas.community import CommunityCreate
from app.services import community_service

router = APIRouter(prefix="/api/communities", tags=["Communities"])

@router.post("/", status_code=201)
def create_community(
    data: CommunityCreate,
    user: dict = Depends(current_user),
):
    return community_service.create(
        data.name,
        data.description,
        user["id"],
        data.visibility,
    )

@router.get("/")
def get_communities(user: dict = Depends(current_user)):
    return community_service.get_all(user["id"])

@router.get("/{community_id}")
def get_community(
    community_id: int,
    user: dict = Depends(current_user),
):
    community = community_service.get_one(community_id)

    if community is None:
        raise HTTPException(404, "\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e")

    if community.get("visibility", "public") == "private":
        with get_db() as db:
            membership = db.execute(
                """
                SELECT 1 FROM community_members
                WHERE community_id=? AND user_id=?
                """,
                (community_id, user["id"]),
            ).fetchone()

        if not membership:
            raise HTTPException(404, "\u0414\u043e\u0441\u0442\u0443\u043f \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u043e\u0432 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u0430")

    return community

@router.post("/{community_id}/join")
def join_community(
    community_id: int,
    user: dict = Depends(current_user),
):
    with get_db() as db:
        community = db.execute(
            "SELECT visibility FROM communities WHERE id=?",
            (community_id,),
        ).fetchone()

        if community is None:
            raise HTTPException(404, "\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e")

        membership = db.execute(
            """
            SELECT 1 FROM community_members
            WHERE community_id=? AND user_id=?
            """,
            (community_id, user["id"]),
        ).fetchone()

        if community["visibility"] == "private" and not membership:
            raise HTTPException(404, "\u041f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e: \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435")

    if not community_service.join(community_id, user["id"]):
        raise HTTPException(404, "\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e")

    return {"status": "joined", "community_id": community_id}

@router.get("/{community_id}/members")
def get_members(
    community_id: int,
    user: dict = Depends(current_user),
):
    community = community_service.get_one(community_id)

    if community is None:
        raise HTTPException(404, "\u0421\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e")

    if community.get("visibility", "public") == "private":
        with get_db() as db:
            membership = db.execute(
                """
                SELECT 1 FROM community_members
                WHERE community_id=? AND user_id=?
                """,
                (community_id, user["id"]),
            ).fetchone()

        if not membership:
            raise HTTPException(404, "\u041f\u0440\u0438\u0432\u0430\u0442\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e")

    return community_service.get_members(community_id)

@router.delete("/{community_id}/leave")
def leave_community(community_id: int, user: dict = Depends(current_user)):
    with get_db() as db:
        community = db.execute(
            "SELECT id, owner_id FROM communities WHERE id=?",
            (community_id,),
        ).fetchone()
        if community is None:
            raise HTTPException(404, "Сообщество не найдено")

        membership = db.execute(
            "SELECT role FROM community_members WHERE community_id=? AND user_id=?",
            (community_id, user["id"]),
        ).fetchone()
        if membership is None:
            raise HTTPException(404, "Вы не состоите в этом сообществе")

        is_owner = int(community["owner_id"]) == int(user["id"]) or membership["role"] == "owner"
        new_owner_id = None
        if is_owner:
            successor = db.execute(
                """
                SELECT user_id
                FROM community_members
                WHERE community_id=? AND user_id<>?
                ORDER BY
                  CASE role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                  joined_at ASC, user_id ASC
                LIMIT 1
                """,
                (community_id, user["id"]),
            ).fetchone()
            if successor is None:
                raise HTTPException(
                    409,
                    "Ты единственный участник. Удали сообщество, чтобы закрыть его, или пригласи другого участника и повтори выход.",
                )

            new_owner_id = int(successor["user_id"])
            db.execute(
                "UPDATE communities SET owner_id=? WHERE id=?",
                (new_owner_id, community_id),
            )
            db.execute(
                "UPDATE community_members SET role='member' WHERE community_id=? AND user_id=?",
                (community_id, user["id"]),
            )
            db.execute(
                "UPDATE community_members SET role='owner' WHERE community_id=? AND user_id=?",
                (community_id, new_owner_id),
            )

        db.execute(
            """
            DELETE FROM channel_members
            WHERE user_id=? AND channel_id IN (
                SELECT id FROM channels WHERE community_id=?
            )
            """,
            (user["id"], community_id),
        )
        db.execute(
            """
            DELETE FROM voice_signals
            WHERE channel_id IN (SELECT id FROM channels WHERE community_id=?)
              AND (sender_id=? OR receiver_id=?)
            """,
            (community_id, user["id"], user["id"]),
        )
        db.execute(
            "DELETE FROM voice_presence WHERE community_id=? AND user_id=?",
            (community_id, user["id"]),
        )
        db.execute(
            "DELETE FROM community_members WHERE community_id=? AND user_id=?",
            (community_id, user["id"]),
        )

        return {
            "status": "left",
            "community_id": community_id,
            "new_owner_id": new_owner_id,
        }
