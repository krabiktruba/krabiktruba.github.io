from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.routes.auth import current_user
from app.repositories import channel_repository as repo
from app.schemas.channel import ChannelCreate, MessageCreate
from app.services import channel_service

router = APIRouter(tags=["Channels and Messages"])


@router.get("/api/communities/{community_id}/channels")
def get_channels(
    community_id: int,
    user: dict = Depends(current_user),
):
    if not repo.community_exists(community_id):
        raise HTTPException(status_code=404, detail="Сообщество не найдено")

    if not repo.is_member(community_id, user["id"]):
        raise HTTPException(
            status_code=403,
            detail="Вступите в сообщество, чтобы просматривать каналы",
        )

    return channel_service.get_channels(community_id)


@router.post("/api/communities/{community_id}/channels", status_code=201)
def create_channel(
    community_id: int,
    data: ChannelCreate,
    user: dict = Depends(current_user),
):
    if not repo.community_exists(community_id):
        raise HTTPException(status_code=404, detail="Сообщество не найдено")

    if not repo.is_owner(community_id, user["id"]):
        raise HTTPException(
            status_code=403,
            detail="Создавать каналы может только владелец сообщества",
        )

    try:
        return channel_service.create_text_channel(
            community_id,
            data.name,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error))


@router.get("/api/channels/{channel_id}/messages")
def get_messages(
    channel_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(current_user),
):
    channel = channel_service.get_channel(channel_id)

    if channel is None:
        raise HTTPException(status_code=404, detail="Канал не найден")

    if not repo.is_member(channel["community_id"], user["id"]):
        raise HTTPException(
            status_code=403,
            detail="Вступите в сообщество, чтобы читать сообщения",
        )

    if channel["channel_type"] != "text":
        raise HTTPException(
            status_code=400,
            detail="История сообщений доступна только для текстовых каналов",
        )

    return channel_service.get_messages(channel_id, limit)


@router.post("/api/channels/{channel_id}/messages", status_code=201)
def send_message(
    channel_id: int,
    data: MessageCreate,
    user: dict = Depends(current_user),
):
    channel = channel_service.get_channel(channel_id)

    if channel is None:
        raise HTTPException(status_code=404, detail="Канал не найден")

    if not repo.is_member(channel["community_id"], user["id"]):
        raise HTTPException(
            status_code=403,
            detail="Вступите в сообщество, чтобы отправлять сообщения",
        )

    if channel["channel_type"] != "text":
        raise HTTPException(
            status_code=400,
            detail="Отправлять сообщения можно только в текстовые каналы",
        )

    content = data.content.strip()
    if not content:
        raise HTTPException(
            status_code=422,
            detail="Сообщение не может быть пустым",
        )

    return channel_service.send_message(
        channel_id,
        user["id"],
        content,
    )

@router.delete("/api/messages/{message_id}")
def delete_message(
    message_id: int,
    user: dict = Depends(current_user),
):
    message = repo.get_message(message_id)

    if message is None:
        raise HTTPException(
            status_code=404,
            detail="Сообщение не найдено",
        )

    is_author = message["user_id"] == user["id"]
    is_community_owner = repo.is_owner(
        message["community_id"],
        user["id"],
    )

    if not is_author and not is_community_owner:
        raise HTTPException(
            status_code=403,
            detail="Недостаточно прав для удаления сообщения",
        )

    repo.delete_message(message_id)

    return {
        "status": "deleted",
        "message_id": message_id,
    }
