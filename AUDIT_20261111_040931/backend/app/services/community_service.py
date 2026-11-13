from app.repositories.community_repository import (
    create_community,
    get_community,
    join_community,
    list_communities,
    list_members,
)


def create(
    name: str,
    description: str,
    owner_id: int,
    visibility: str = "public",
) -> dict:
    return create_community(name, description, owner_id, visibility)


def get_all(user_id: int | None = None) -> list[dict]:
    return list_communities(user_id)


def get_one(community_id: int) -> dict | None:
    return get_community(community_id)


def join(community_id: int, user_id: int) -> bool:
    return join_community(community_id, user_id)


def get_members(community_id: int) -> list[dict]:
    return list_members(community_id)
