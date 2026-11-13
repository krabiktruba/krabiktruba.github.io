from app.repositories import channel_repository as repo


def get_channels(community_id: int) -> list[dict]:
    return repo.list_channels(community_id)


def create_text_channel(
    community_id: int,
    name: str,
    creator_id: int,
    visibility: str = "public",
) -> dict:
    return repo.create_channel(community_id, name, creator_id, visibility)


def get_channel(channel_id: int) -> dict | None:
    return repo.get_channel(channel_id)


def send_message(channel_id: int, user_id: int, content: str) -> dict:
    return repo.create_message(channel_id, user_id, content.strip())


def get_messages(channel_id: int, limit: int = 50) -> list[dict]:
    return repo.list_messages(channel_id, limit)
