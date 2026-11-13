from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.routes.auth import current_user


router = APIRouter(prefix="/api/dm", tags=["Direct Messages"])


class ConversationCreate(BaseModel):
    friend_id: int


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


def init_dm():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS dm_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_low_id, user_high_id),
                CHECK(user_low_id < user_high_id)
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS dm_participants (
                conversation_id INTEGER NOT NULL
                    REFERENCES dm_conversations(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,
                last_read_message_id INTEGER NOT NULL DEFAULT 0,
                joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(conversation_id, user_id)
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS dm_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL
                    REFERENCES dm_conversations(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        participant_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(dm_participants)")
        }

        if "cleared_before_message_id" not in participant_columns:
            db.execute("""
                ALTER TABLE dm_participants
                ADD COLUMN cleared_before_message_id INTEGER NOT NULL DEFAULT 0
            """)

        if "hidden_at" not in participant_columns:
            db.execute("""
                ALTER TABLE dm_participants
                ADD COLUMN hidden_at TEXT
            """)

        message_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(dm_messages)")
        }

        if "edited_at" not in message_columns:
            db.execute("ALTER TABLE dm_messages ADD COLUMN edited_at TEXT")

        if "deleted_at" not in message_columns:
            db.execute("ALTER TABLE dm_messages ADD COLUMN deleted_at TEXT")

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation
            ON dm_messages(conversation_id, id)
        """)


def _participant(db, conversation_id, user_id):
    return db.execute("""
        SELECT *
        FROM dm_participants
        WHERE conversation_id=? AND user_id=?
    """, (conversation_id, user_id)).fetchone()


def _get_conversation(db, conversation_id, user_id):
    row = db.execute("""
        SELECT *
        FROM dm_conversations
        WHERE id=?
    """, (conversation_id,)).fetchone()

    if row is None:
        raise HTTPException(404, "Диалог не найден")

    if not _participant(db, conversation_id, user_id):
        raise HTTPException(403, "Нет доступа к диалогу")

    friend_id = (
        row["user_high_id"]
        if row["user_low_id"] == user_id
        else row["user_low_id"]
    )

    return row, friend_id


def _blocked(db, a, b):
    return db.execute("""
        SELECT 1
        FROM user_blocks
        WHERE (user_id=? AND blocked_user_id=?)
           OR (user_id=? AND blocked_user_id=?)
        LIMIT 1
    """, (a, b, b, a)).fetchone() is not None


def _blocked_by_me(db, user_id, friend_id):
    return db.execute("""
        SELECT 1 FROM user_blocks
        WHERE user_id=? AND blocked_user_id=?
    """, (user_id, friend_id)).fetchone() is not None


def _blocked_by_them(db, user_id, friend_id):
    return _blocked_by_me(db, friend_id, user_id)


def _friends(db, a, b):
    return db.execute("""
        SELECT 1
        FROM friend_requests
        WHERE status='accepted'
          AND (
            (sender_id=? AND receiver_id=?)
            OR
            (sender_id=? AND receiver_id=?)
          )
        LIMIT 1
    """, (a, b, b, a)).fetchone() is not None


def _can_send(db, a, b):
    return _friends(db, a, b) and not _blocked(db, a, b)


def _conversation(db, a, b):
    low, high = sorted((a, b))

    db.execute("""
        INSERT OR IGNORE INTO dm_conversations(user_low_id, user_high_id)
        VALUES (?, ?)
    """, (low, high))

    row = db.execute("""
        SELECT id FROM dm_conversations
        WHERE user_low_id=? AND user_high_id=?
    """, (low, high)).fetchone()

    conversation_id = row["id"]

    db.execute("""
        INSERT OR IGNORE INTO dm_participants(conversation_id, user_id)
        VALUES (?, ?), (?, ?)
    """, (conversation_id, a, conversation_id, b))

    return conversation_id


def _message_dict(row):
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "sender_id": row["sender_id"],
        "sender_username": row["sender_username"],
        "content": row["content"],
        "created_at": row["created_at"],
        "edited_at": row["edited_at"],
        "is_deleted": bool(row["deleted_at"]),
    }


def _fetch_message(db, message_id, conversation_id):
    return db.execute("""
        SELECT
            m.id,
            m.conversation_id,
            m.sender_id,
            u.username AS sender_username,
            m.content,
            m.created_at,
            m.edited_at,
            m.deleted_at
        FROM dm_messages m
        JOIN users u ON u.id=m.sender_id
        WHERE m.id=? AND m.conversation_id=?
    """, (message_id, conversation_id)).fetchone()


@router.get("/conversations")
def list_conversations(user=Depends(current_user)):
    uid = user["id"]

    with get_db() as db:
        rows = db.execute("""
            SELECT
                c.id,
                CASE
                    WHEN c.user_low_id=? THEN c.user_high_id
                    ELSE c.user_low_id
                END AS friend_id,
                u.username AS friend_username,
                p.last_read_message_id,
                p.cleared_before_message_id,
                (
                    SELECT CASE
                        WHEN m.deleted_at IS NOT NULL
                        THEN 'Сообщение удалено'
                        ELSE m.content
                    END
                    FROM dm_messages m
                    WHERE m.conversation_id=c.id
                      AND m.id > p.cleared_before_message_id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message,
                (
                    SELECT m.id
                    FROM dm_messages m
                    WHERE m.conversation_id=c.id
                      AND m.id > p.cleared_before_message_id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message_id,
                (
                    SELECT m.created_at
                    FROM dm_messages m
                    WHERE m.conversation_id=c.id
                      AND m.id > p.cleared_before_message_id
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS last_message_at
            FROM dm_conversations c
            JOIN dm_participants p
              ON p.conversation_id=c.id AND p.user_id=?
            JOIN users u
              ON u.id=CASE
                WHEN c.user_low_id=? THEN c.user_high_id
                ELSE c.user_low_id
              END
            WHERE p.hidden_at IS NULL
            ORDER BY COALESCE(last_message_id, 0) DESC, c.id DESC
        """, (uid, uid, uid)).fetchall()

        result = []

        for row in rows:
            item = dict(row)
            friend_id = item["friend_id"]

            item["is_blocked_by_me"] = _blocked_by_me(
                db, uid, friend_id
            )
            item["is_blocked_by_them"] = _blocked_by_them(
                db, uid, friend_id
            )
            item["can_send"] = _can_send(db, uid, friend_id)

            result.append(item)

        return result


@router.post("/conversations")
def create_conversation(
    data: ConversationCreate,
    user=Depends(current_user)
):
    uid = user["id"]
    friend_id = data.friend_id

    if friend_id == uid:
        raise HTTPException(400, "Нельзя создать диалог с самим собой")

    with get_db() as db:
        if not db.execute(
            "SELECT id FROM users WHERE id=?",
            (friend_id,)
        ).fetchone():
            raise HTTPException(404, "Пользователь не найден")

        if _blocked(db, uid, friend_id):
            raise HTTPException(403, "Пользователь заблокирован")

        if not _friends(db, uid, friend_id):
            raise HTTPException(
                403,
                "Личные сообщения доступны только друзьям"
            )

        conversation_id = _conversation(db, uid, friend_id)

        db.execute("""
            UPDATE dm_participants
            SET hidden_at=NULL
            WHERE conversation_id=? AND user_id=?
        """, (conversation_id, uid))

        return {"id": conversation_id, "friend_id": friend_id}


@router.get("/{conversation_id}/messages")
def get_messages(
    conversation_id: int,
    after_id: int = 0,
    user=Depends(current_user)
):
    with get_db() as db:
        participant = _participant(db, conversation_id, user["id"])

        if participant is None:
            raise HTTPException(403, "Нет доступа к переписке")

        rows = db.execute("""
            SELECT
                m.id,
                m.conversation_id,
                m.sender_id,
                u.username AS sender_username,
                m.content,
                m.created_at,
                m.edited_at,
                m.deleted_at
            FROM dm_messages m
            JOIN users u ON u.id=m.sender_id
            WHERE m.conversation_id=?
              AND m.id > MAX(?, ?)
            ORDER BY m.id ASC
            LIMIT 200
        """, (
            conversation_id,
            max(0, after_id),
            participant["cleared_before_message_id"]
        )).fetchall()

        return [_message_dict(row) for row in rows]


@router.get("/{conversation_id}/updates")
def get_updates(
    conversation_id: int,
    after_id: int = 0,
    user=Depends(current_user)
):
    return get_messages(conversation_id, after_id, user)


@router.post("/{conversation_id}/messages")
def send_message(
    conversation_id: int,
    data: MessageCreate,
    user=Depends(current_user)
):
    uid = user["id"]
    content = data.content.strip()

    if not content:
        raise HTTPException(400, "Сообщение не может быть пустым")

    with get_db() as db:
        conversation, friend_id = _get_conversation(
            db, conversation_id, uid
        )

        if _blocked(db, uid, friend_id):
            raise HTTPException(403, "Отправка сообщений запрещена")

        if not _friends(db, uid, friend_id):
            raise HTTPException(
                403,
                "Пользователь больше не является другом"
            )

        cursor = db.execute("""
            INSERT INTO dm_messages(conversation_id, sender_id, content)
            VALUES (?, ?, ?)
        """, (conversation_id, uid, content))

        row = _fetch_message(db, cursor.lastrowid, conversation_id)
        return _message_dict(row)


@router.patch("/{conversation_id}/messages/{message_id}")
def edit_message(
    conversation_id: int,
    message_id: int,
    data: MessageCreate,
    user=Depends(current_user)
):
    uid = user["id"]
    content = data.content.strip()

    if not content:
        raise HTTPException(400, "Сообщение не может быть пустым")

    with get_db() as db:
        _get_conversation(db, conversation_id, uid)

        row = _fetch_message(db, message_id, conversation_id)

        if row is None:
            raise HTTPException(404, "Сообщение не найдено")

        if row["sender_id"] != uid:
            raise HTTPException(
                403,
                "Можно редактировать только собственные сообщения"
            )

        if row["deleted_at"]:
            raise HTTPException(
                409,
                "Удалённое сообщение нельзя редактировать"
            )

        db.execute("""
            UPDATE dm_messages
            SET content=?, edited_at=CURRENT_TIMESTAMP
            WHERE id=? AND conversation_id=?
        """, (content, message_id, conversation_id))

        updated = _fetch_message(db, message_id, conversation_id)
        return _message_dict(updated)


@router.delete("/{conversation_id}/messages/{message_id}")
def delete_message(
    conversation_id: int,
    message_id: int,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        _get_conversation(db, conversation_id, uid)

        row = _fetch_message(db, message_id, conversation_id)

        if row is None:
            raise HTTPException(404, "Сообщение не найдено")

        if row["sender_id"] != uid:
            raise HTTPException(
                403,
                "Можно удалять только собственные сообщения"
            )

        if not row["deleted_at"]:
            db.execute("""
                UPDATE dm_messages
                SET content='Сообщение удалено',
                    deleted_at=CURRENT_TIMESTAMP
                WHERE id=? AND conversation_id=?
            """, (message_id, conversation_id))

        updated = _fetch_message(db, message_id, conversation_id)
        return _message_dict(updated)


@router.post("/{conversation_id}/clear")
def clear_conversation(
    conversation_id: int,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        _get_conversation(db, conversation_id, uid)

        maximum = db.execute("""
            SELECT COALESCE(MAX(id), 0) AS value
            FROM dm_messages
            WHERE conversation_id=?
        """, (conversation_id,)).fetchone()["value"]

        db.execute("""
            UPDATE dm_participants
            SET cleared_before_message_id=
                MAX(cleared_before_message_id, ?)
            WHERE conversation_id=? AND user_id=?
        """, (maximum, conversation_id, uid))

        return {
            "status": "ok",
            "cleared_before_message_id": maximum
        }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        _get_conversation(db, conversation_id, uid)

        db.execute("""
            UPDATE dm_participants
            SET hidden_at=CURRENT_TIMESTAMP
            WHERE conversation_id=? AND user_id=?
        """, (conversation_id, uid))

        return {"status": "ok", "hidden": True}


@router.post("/{conversation_id}/block")
def block_conversation(
    conversation_id: int,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        _, friend_id = _get_conversation(db, conversation_id, uid)

        db.execute("""
            INSERT OR IGNORE INTO user_blocks(user_id, blocked_user_id)
            VALUES (?, ?)
        """, (uid, friend_id))

        return {"status": "ok", "blocked": True}


@router.delete("/{conversation_id}/block")
def unblock_conversation(
    conversation_id: int,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        _, friend_id = _get_conversation(db, conversation_id, uid)

        db.execute("""
            DELETE FROM user_blocks
            WHERE user_id=? AND blocked_user_id=?
        """, (uid, friend_id))

        return {"status": "ok", "blocked": False}


@router.post("/{conversation_id}/read")
def mark_read(
    conversation_id: int,
    message_id: int = 0,
    user=Depends(current_user)
):
    uid = user["id"]

    with get_db() as db:
        if not _participant(db, conversation_id, uid):
            raise HTTPException(403, "Нет доступа к переписке")

        maximum = db.execute("""
            SELECT COALESCE(MAX(id), 0) AS value
            FROM dm_messages
            WHERE conversation_id=?
        """, (conversation_id,)).fetchone()["value"]

        safe_id = min(max(0, message_id), maximum)

        db.execute("""
            UPDATE dm_participants
            SET last_read_message_id=
                MAX(last_read_message_id, ?)
            WHERE conversation_id=? AND user_id=?
        """, (safe_id, conversation_id, uid))

        return {
            "status": "ok",
            "last_read_message_id": safe_id
        }