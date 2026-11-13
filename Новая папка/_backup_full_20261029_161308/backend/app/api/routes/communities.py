from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.auth import current_user
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
    )


@router.get("/")
def get_communities():
    return community_service.get_all()


@router.get("/{community_id}")
def get_community(community_id: int):
    community = community_service.get_one(community_id)
    if community is None:
        raise HTTPException(status_code=404, detail="Сообщество не найдено")
    return community


@router.post("/{community_id}/join")
def join_community(
    community_id: int,
    user: dict = Depends(current_user),
):
    joined = community_service.join(community_id, user["id"])
    if not joined:
        raise HTTPException(status_code=404, detail="Сообщество не найдено")
    return {"status": "joined", "community_id": community_id}


@router.get("/{community_id}/members")
def get_members(community_id: int):
    if community_service.get_one(community_id) is None:
        raise HTTPException(status_code=404, detail="Сообщество не найдено")
    return community_service.get_members(community_id)
