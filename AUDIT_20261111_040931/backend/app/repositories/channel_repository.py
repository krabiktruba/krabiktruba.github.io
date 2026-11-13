from app.core.database import get_db


def is_member(community_id: int, user_id: int) -> bool:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT 1
            FROM community_members
            WHERE community_id = ? AND user_id = ?
            """,
            (community_id, user_id),
        ).fetchone()
        return row is not None


def is_owner(community_id: int, user_id: int) -> bool:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT 1
            FROM community_members
            WHERE community_id = ? AND user_id = ? AND role = 'owner'
            """,
            (community_id, user_id),
        ).fetchone()
        return row is not None


def community_exists(community_id: int) -> bool:
    with get_db() as connection:
        row = connection.execute(
            "SELECT 1 FROM communities WHERE id = ?",
            (community_id,),
        ).fetchone()
        return row is not None


def list_channels(community_id: int) -> list[dict]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT id, community_id, name, channel_type, visibility, created_at
            FROM channels
            WHERE community_id = ?
            ORDER BY id
            """,
            (community_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def get_channel(channel_id: int) -> dict | None:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT id, community_id, name, channel_type, visibility, created_at
            FROM channels
            WHERE id = ?
            """,
            (channel_id,),
        ).fetchone()
        return dict(row) if row else None


def create_channel(
    community_id: int,
    name: str,
    creator_id: int,
    visibility: str = "public",
) -> dict:
    if visibility not in {"public", "private"}:
        raise ValueError("Недопустимый тип доступа к каналу")

    with get_db() as connection:
        existing = connection.execute(
            """
            SELECT id FROM channels
            WHERE community_id = ? AND name = ? COLLATE NOCASE
            """,
            (community_id, name),
        ).fetchone()

        if existing:
            raise ValueError("Канал с таким именем уже существует")

        cursor = connection.execute(
            """
            INSERT INTO channels (community_id, name, channel_type, visibility)
            VALUES (?, ?, 'text', ?)
            """,
            (community_id, name, visibility),
        )
        channel_id = cursor.lastrowid

        if visibility == "private":
            connection.execute(
                """
                INSERT OR IGNORE INTO channel_members (channel_id, user_id)
                VALUES (?, ?)
                """,
                (channel_id, creator_id),
            )

        row = connection.execute(
            """
            SELECT id, community_id, name, channel_type, visibility, created_at
            FROM channels WHERE id = ?
            """,
            (channel_id,),
        ).fetchone()
        return dict(row)



def create_message(channel_id: int, user_id: int, content: str) -> dict:
    with get_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO messages (channel_id, user_id, content)
            VALUES (?, ?, ?)
            """,
            (channel_id, user_id, content),
        )

        row = connection.execute(
            """
            SELECT m.id, m.channel_id, m.user_id, u.username, u.status,
                   m.content, m.created_at
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()

        return dict(row)


def list_messages(channel_id: int, limit: int = 50) -> list[dict]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT m.id, m.channel_id, m.user_id, u.username, u.status,
                   m.content, m.created_at
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.channel_id = ?
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (channel_id, limit),
        ).fetchall()

        # От старых к новым — удобнее для отображения в чате.
        return [dict(row) for row in reversed(rows)]

def get_message(message_id: int) -> dict | None:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT m.id, m.channel_id, m.user_id, u.username, u.status,
                   m.content, m.created_at, c.community_id
            FROM messages m
            JOIN users u ON u.id = m.user_id
            JOIN channels c ON c.id = m.channel_id
            WHERE m.id = ?
            """,
            (message_id,),
        ).fetchone()
        return dict(row) if row else None


def delete_message(message_id: int) -> bool:
    with get_db() as connection:
        cursor = connection.execute(
            "DELETE FROM messages WHERE id = ?",
            (message_id,),
        )
        return cursor.rowcount > 0


def can_access_channel(
    channel_id: int,
    user_id: int,
    is_admin: bool = False,
) -> bool:
    channel = get_channel(channel_id)
    if channel is None:
        return False

    if is_owner(channel["community_id"], user_id):
        return True

    if not is_member(channel["community_id"], user_id):
        return False

    if channel.get("visibility", "public") != "private":
        return True

    with get_db() as connection:
        row = connection.execute(
            "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?",
            (channel_id, user_id),
        ).fetchone()
        return row is not None


def find_community_member(community_id: int, username: str) -> dict | None:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT u.id, u.username
            FROM users u
            JOIN community_members cm ON cm.user_id = u.id
            WHERE cm.community_id = ? AND u.username = ? COLLATE NOCASE
            """,
            (community_id, username),
        ).fetchone()
        return dict(row) if row else None


def add_channel_member(channel_id: int, user_id: int) -> None:
    with get_db() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO channel_members (channel_id, user_id)
            VALUES (?, ?)
            """,
            (channel_id, user_id),
        )


def update_message(message_id: int, content: str) -> dict | None:
    with get_db() as connection:
        connection.execute(
            "UPDATE messages SET content = ? WHERE id = ?",
            (content, message_id),
        )
        row = connection.execute(
            """
            SELECT m.id, m.channel_id, m.user_id, u.username, u.status,
                   m.content, m.created_at, c.community_id
            FROM messages m
            JOIN users u ON u.id = m.user_id
            JOIN channels c ON c.id = m.channel_id
            WHERE m.id = ?
            """,
            (message_id,),
        ).fetchone()
        return dict(row) if row else None


