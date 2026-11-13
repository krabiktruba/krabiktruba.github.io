from pydantic import BaseModel, Field


class ChannelCreate(BaseModel):
    name: str = Field(
        min_length=2,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    visibility: str = Field(default="public", pattern=r"^(public|private)$")


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


