from pydantic import BaseModel, Field


class ChannelCreate(BaseModel):
    name: str = Field(
        min_length=2,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


