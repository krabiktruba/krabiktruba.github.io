import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.api.routes.auth import current_user
from app.repositories import channel_repository as channel_repo

router = APIRouter(prefix="/api/voice", tags=["Voice / WebRTC"])

TICKETS: dict[str, dict[str, Any]] = {}
ROOMS: dict[int, dict[str, dict[str, Any]]] = {}
TICKET_TTL = 60


@router.post("/{channel_id}/ticket")
def create_voice_ticket(channel_id: int, user: dict = Depends(current_user)):
    channel = channel_repo.get_channel(channel_id)
    if channel is None:
        raise HTTPException(404, "Voice channel not found")
    if channel["channel_type"] != "voice":
        raise HTTPException(400, "This is not a voice channel")
    if not channel_repo.can_access_channel(
        channel_id, user["id"], bool(user.get("is_admin", False))
    ):
        raise HTTPException(403, "No access to this voice channel")

    ticket = secrets.token_urlsafe(32)
    TICKETS[ticket] = {
        "channel_id": channel_id,
        "user_id": user["id"],
        "username": user["username"],
        "is_admin": bool(user.get("is_admin", False)),
        "expires_at": time.time() + TICKET_TTL,
    }
    return {"ticket": ticket, "expires_in": TICKET_TTL}


@router.websocket("/ws")
async def voice_signalling(websocket: WebSocket):
    ticket = websocket.query_params.get("ticket", "")
    grant = TICKETS.pop(ticket, None)

    if not grant or grant["expires_at"] < time.time():
        await websocket.close(code=1008, reason="Invalid or expired ticket")
        return

    channel_id = int(grant["channel_id"])
    channel = channel_repo.get_channel(channel_id)

    if (
        channel is None
        or channel["channel_type"] != "voice"
        or not channel_repo.can_access_channel(
            channel_id,
            int(grant["user_id"]),
            bool(grant.get("is_admin", False)),
        )
    ):
        await websocket.close(code=1008, reason="No access to voice channel")
        return

    await websocket.accept()

    peer_id = secrets.token_hex(8)
    username = str(grant["username"])
    room = ROOMS.setdefault(channel_id, {})

    existing = [
        {"peer_id": other_id, "username": peer["username"]}
        for other_id, peer in room.items()
    ]

    room[peer_id] = {
        "socket": websocket,
        "user_id": int(grant["user_id"]),
        "username": username,
    }

    await websocket.send_json({
        "type": "hello",
        "peer_id": peer_id,
        "peers": existing,
    })

    for other_id, peer in list(room.items()):
        if other_id == peer_id:
            continue
        try:
            await peer["socket"].send_json({
                "type": "peer-joined",
                "peer_id": peer_id,
                "username": username,
            })
        except Exception:
            pass

    try:
        while True:
            message = await websocket.receive_json()

            if not isinstance(message, dict):
                continue

            kind = message.get("type")
            if kind == "leave":
                break

            if kind not in {"offer", "answer", "ice-candidate"}:
                continue

            target_id = message.get("to")
            if not isinstance(target_id, str) or target_id == peer_id:
                continue

            target = room.get(target_id)
            if target is None:
                continue

            outgoing: dict[str, Any] = {
                "type": kind,
                "from": peer_id,
                "username": username,
            }

            if kind in {"offer", "answer"}:
                sdp = message.get("sdp")
                if not isinstance(sdp, dict):
                    continue
                if sdp.get("type") != kind:
                    continue
                if not isinstance(sdp.get("sdp"), str) or len(sdp["sdp"]) > 150000:
                    continue
                outgoing["sdp"] = {"type": kind, "sdp": sdp["sdp"]}
            else:
                candidate = message.get("candidate")
                if not isinstance(candidate, dict):
                    continue
                if not isinstance(candidate.get("candidate"), str):
                    continue
                outgoing["candidate"] = candidate

            try:
                await target["socket"].send_json(outgoing)
            except Exception:
                pass

    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        current_room = ROOMS.get(channel_id)
        if current_room is not None:
            current_room.pop(peer_id, None)

            for peer in list(current_room.values()):
                try:
                    await peer["socket"].send_json({
                        "type": "peer-left",
                        "peer_id": peer_id,
                    })
                except Exception:
                    pass

            if not current_room:
                ROOMS.pop(channel_id, None)