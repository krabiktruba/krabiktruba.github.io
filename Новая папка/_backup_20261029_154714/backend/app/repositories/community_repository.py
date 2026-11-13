from app.core.database import get_db


def create_community(name: str, description: str, owner_id: int) -> dict:
    with get_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO communities (name, description, owner_id)
            VALUES (?, ?, ?)
            """,
            (name, description, owner_id),
        )
        community_id = cursor.lastrowid

        for channel_name, channel_type in (
            ("news", "text"),
            ("general", "text"),
            ("voice", "voice"),
        ):
            connection.execute(
                """
                INSERT INTO channels (community_id, name, channel_type)
                VALUES (?, ?, ?)
                """,
                (community_id, channel_name, channel_type),
            )

        connection.execute(
            """
            INSERT INTO community_members (community_id, user_id, role)
            VALUES (?, ?, 'owner')
            """,
            (community_id, owner_id),
        )

        row = connection.execute(
            "SELECT * FROM communities WHERE id = ?",
            (community_id,),
        ).fetchone()

        return dict(row)


def list_communities() -> list[dict]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT c.*, u.username AS owner_username,
                   (SELECT COUNT(*) FROM community_members m
                    WHERE m.community_id = c.id) AS member_count
            FROM communities c
            JOIN users u ON u.id = c.owner_id
            ORDER BY c.id DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


def get_community(community_id: int) -> dict | None:
    with get_db() as connection:
        row = connection.execute(
            """
            SELECT c.*, u.username AS owner_username,
                   (SELECT COUNT(*) FROM community_members m
                    WHERE m.community_id = c.id) AS member_count
            FROM communities c
            JOIN users u ON u.id = c.owner_id
            WHERE c.id = ?
            """,
            (community_id,),
        ).fetchone()
        return dict(row) if row else None


def join_community(community_id: int, user_id: int) -> bool:
    with get_db() as connection:
        exists = connection.execute(
            "SELECT id FROM communities WHERE id = ?",
            (community_id,),
        ).fetchone()

        if exists is None:
            return False

        connection.execute(
            """
            INSERT OR IGNORE INTO community_members
                (community_id, user_id, role)
            VALUES (?, ?, 'member')
            """,
            (community_id, user_id),
        )
        return True


def list_members(community_id: int) -> list[dict]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT u.id AS user_id, u.username, m.role, m.joined_at
            FROM community_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.community_id = ?
            ORDER BY m.joined_at
            """,
            (community_id,),
        ).fetchall()
        return [dict(row) for row in rows]
