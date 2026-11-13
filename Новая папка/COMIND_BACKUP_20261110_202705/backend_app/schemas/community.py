from pydantic import BaseModel, Field


class CommunityCreate(BaseModel):
    name: str = Field(min_length=3, max_length=60)
    description: str = Field(default="", max_length=1000)
    visibility: str = Field(
        default="public",
        pattern="^(public|private)$",
    )


class CommunityResponse(BaseModel):
    id: int
    name: str
    description: str
    owner_id: int
    created_at: str


class CommunityMemberResponse(BaseModel):
    community_id: int
    user_id: int
    role: str
    joined_at: str
