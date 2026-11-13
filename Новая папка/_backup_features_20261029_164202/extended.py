import sqlite3
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.core.database import get_db, DATABASE_PATH
from app.api.routes.auth import current_user

router = APIRouter(tags=["COMIND SOON Extended Features"])

def init_extended():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reporter_id INTEGER NOT NULL REFERENCES users(id),
          target_user_id INTEGER REFERENCES users(id),
          message_id INTEGER,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          moderator_id INTEGER REFERENCES users(id),
          resolution TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS moderation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER NOT NULL REFERENCES users(id),
          community_id INTEGER REFERENCES communities(id) ON DELETE CASCADE,
          target_user_id INTEGER REFERENCES users(id),
          action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_blocks (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(user_id, blocked_user_id)
        );
        CREATE TABLE IF NOT EXISTS voice_signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,is_read);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id,id);
        """)
        columns = {r["name"] for r in db.execute("PRAGMA table_info(users)")}
        for name, declaration in [
            ("display_name", "TEXT NOT NULL DEFAULT ''"),
            ("avatar_url", "TEXT NOT NULL DEFAULT ''"),
            ("bio", "TEXT NOT NULL DEFAULT ''"),
            ("status", "TEXT NOT NULL DEFAULT 'online'"),
            ("is_admin", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            if name not in columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {name} {declaration}")
        columns = {r["name"] for r in db.execute("PRAGMA table_info(messages)")}
        if "edited_at" not in columns:
            db.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT")

init_extended()

class ProfileUpdate(BaseModel):
    display_name: str = Field(default="", max_length=60)
    bio: str = Field(default="", max_length=500)
    avatar_url: str = Field(default="", max_length=500000)
    status: str = Field(default="online", pattern="^(online|away|busy|offline)$")

class CommunityUpdate(BaseModel):
    name: str = Field(min_length=3, max_length=60)
    description: str = Field(default="", max_length=1000)

class ChannelUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")

class RoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|moderator|member)$")

class MessageUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)

class ReportCreate(BaseModel):
    target_user_id: int | None = None
    message_id: int | None = None
    reason: str = Field(min_length=5, max_length=1000)

class ReportResolve(BaseModel):
    status: str = Field(pattern="^(resolved|rejected)$")
    resolution: str = Field(min_length=2, max_length=1000)

class BlockCreate(BaseModel):
    reason: str = Field(default="", max_length=500)

class VoiceSignal(BaseModel):
    receiver_id: int
    payload: str = Field(min_length=1, max_length=50000)

def member(db, cid, uid):
    return db.execute(
        "SELECT role FROM community_members WHERE community_id=? AND user_id=?",
        (cid, uid)
    ).fetchone()

def require_member(db, cid, uid):
    m = member(db, cid, uid)
    if not m:
        raise HTTPException(403, "Вы не участник сообщества")
    return m["role"]

def require_manager(db, cid, uid):
    role = require_member(db, cid, uid)
    if role not in ("owner", "admin", "moderator"):
        raise HTTPException(403, "Недостаточно прав")
    return role

def notify(db, uid, title, body=""):
    db.execute(
        "INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)",
        (uid, title[:200], body[:1000])
    )

def log_action(db, actor, cid, target, action, details=""):
    db.execute(
        "INSERT INTO moderation_log(actor_id,community_id,target_user_id,action,details) VALUES(?,?,?,?,?)",
        (actor, cid, target, action, details[:1000])
    )

@router.get("/api/profile/me")
def get_profile(user=Depends(current_user)):
    with get_db() as db:
        return dict(db.execute(
            "SELECT id,username,email,display_name,avatar_url,bio,status,created_at FROM users WHERE id=?",
            (user["id"],)
        ).fetchone())

@router.patch("/api/profile/me")
def update_profile(data: ProfileUpdate, user=Depends(current_user)):
    avatar = data.avatar_url.strip()
    if avatar and not (avatar.startswith("https://") or avatar.startswith("data:image/png;base64,") or avatar.startswith("data:image/jpeg;base64,") or avatar.startswith("data:image/webp;base64,")):
        raise HTTPException(422, "Аватар должен быть HTTPS URL или PNG/JPEG/WebP data URL")
    if avatar.startswith("data:image/") and len(avatar) > 400000:
        raise HTTPException(413, "Аватар слишком большой")
    with get_db() as db:
        db.execute(
            "UPDATE users SET display_name=?,bio=?,avatar_url=?,status=? WHERE id=?",
            (data.display_name.strip(),data.bio.strip(),avatar,data.status,user["id"])
        )
        return dict(db.execute(
            "SELECT id,username,email,display_name,avatar_url,bio,status,created_at FROM users WHERE id=?",
            (user["id"],)
        ).fetchone())

@router.get("/api/communities/{cid}/members")
def members(cid: int, user=Depends(current_user)):
    with get_db() as db:
        require_member(db,cid,user["id"])
        return [dict(r) for r in db.execute("""
          SELECT u.id AS user_id,u.username,u.display_name,u.avatar_url,u.status,
                 m.role,m.joined_at
          FROM community_members m JOIN users u ON u.id=m.user_id
          WHERE m.community_id=? ORDER BY m.joined_at
        """,(cid,))]

@router.patch("/api/communities/{cid}/members/{target}")
def change_role(cid: int, target: int, data: RoleUpdate, user=Depends(current_user)):
    with get_db() as db:
        actor = require_manager(db,cid,user["id"])
        row = member(db,cid,target)
        if not row:
            raise HTTPException(404,"Участник не найден")
        if actor != "owner":
            raise HTTPException(403,"Назначать роли может только владелец")
        if row["role"] == "owner" or target == user["id"]:
            raise HTTPException(403,"Нельзя изменить роль владельца или собственную роль")
        db.execute("UPDATE community_members SET role=? WHERE community_id=? AND user_id=?",(data.role,cid,target))
        notify(db,target,"Роль в сообществе изменена",data.role)
        log_action(db,user["id"],cid,target,"role_changed",data.role)
        return {"status":"updated","user_id":target,"role":data.role}

@router.patch("/api/communities/{cid}")
def update_community(cid: int, data: CommunityUpdate, user=Depends(current_user)):
    with get_db() as db:
        if not member(db,cid,user["id"]) or not member(db,cid,user["id"])["role"] == "owner":
            raise HTTPException(403,"Только владелец может изменить сообщество")
        db.execute("UPDATE communities SET name=?,description=? WHERE id=?",(data.name.strip(),data.description.strip(),cid))
        return dict(db.execute("SELECT * FROM communities WHERE id=?",(cid,)).fetchone())

@router.delete("/api/communities/{cid}")
def delete_community(cid: int, user=Depends(current_user)):
    with get_db() as db:
        if not member(db,cid,user["id"]) or member(db,cid,user["id"])["role"] != "owner":
            raise HTTPException(403,"Удалить сообщество может только владелец")
        db.execute("DELETE FROM communities WHERE id=?",(cid,))
        return {"status":"deleted","community_id":cid}

@router.patch("/api/channels/{channel_id}")
def rename_channel(channel_id: int, data: ChannelUpdate, user=Depends(current_user)):
    with get_db() as db:
        ch = db.execute("SELECT * FROM channels WHERE id=?",(channel_id,)).fetchone()
        if not ch: raise HTTPException(404,"Канал не найден")
        if require_manager(db,ch["community_id"],user["id"]) not in ("owner","admin"):
            raise HTTPException(403,"Недостаточно прав")
        if db.execute("SELECT 1 FROM channels WHERE community_id=? AND name=? COLLATE NOCASE AND id<>?",(ch["community_id"],data.name,channel_id)).fetchone():
            raise HTTPException(409,"Такой канал уже существует")
        db.execute("UPDATE channels SET name=? WHERE id=?",(data.name,channel_id))
        return {"status":"updated","id":channel_id,"name":data.name}

@router.delete("/api/channels/{channel_id}")
def remove_channel(channel_id: int, user=Depends(current_user)):
    with get_db() as db:
        ch = db.execute("SELECT * FROM channels WHERE id=?",(channel_id,)).fetchone()
        if not ch: raise HTTPException(404,"Канал не найден")
        if require_manager(db,ch["community_id"],user["id"]) not in ("owner","admin"):
            raise HTTPException(403,"Недостаточно прав")
        db.execute("DELETE FROM channels WHERE id=?",(channel_id,))
        return {"status":"deleted"}

@router.patch("/api/messages/{message_id}")
def edit_message(message_id: int, data: MessageUpdate, user=Depends(current_user)):
    with get_db() as db:
        msg = db.execute("SELECT * FROM messages WHERE id=?",(message_id,)).fetchone()
        if not msg: raise HTTPException(404,"Сообщение не найдено")
        require_member(db,db.execute("SELECT community_id FROM channels WHERE id=?",(msg["channel_id"],)).fetchone()["community_id"],user["id"])
        if msg["user_id"] != user["id"]:
            raise HTTPException(403,"Можно редактировать только свои сообщения")
        content=data.content.strip()
        if not content: raise HTTPException(422,"Пустое сообщение")
        db.execute("UPDATE messages SET content=?,edited_at=CURRENT_TIMESTAMP WHERE id=?",(content,message_id))
        return {"status":"updated","id":message_id,"content":content}

@router.get("/api/notifications")
def notifications(user=Depends(current_user), limit: int=Query(50,ge=1,le=100)):
    with get_db() as db:
        rows=[dict(r) for r in db.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?",(user["id"],limit))]
        return {"items":rows,"unread":sum(not r["is_read"] for r in rows)}

@router.post("/api/notifications/{nid}/read")
def read_notification(nid: int, user=Depends(current_user)):
    with get_db() as db:
        cur=db.execute("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",(nid,user["id"]))
        if not cur.rowcount: raise HTTPException(404,"Уведомление не найдено")
        return {"status":"read"}

@router.post("/api/notifications/read-all")
def read_all(user=Depends(current_user)):
    with get_db() as db:
        db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?",(user["id"],))
        return {"status":"all_read"}

@router.get("/api/search")
def search(q: str=Query(min_length=2,max_length=100), user=Depends(current_user)):
    term="%"+q.strip().replace("%","\\%").replace("_","\\_")+"%"
    with get_db() as db:
        communities=[dict(r) for r in db.execute("""
          SELECT c.id,c.name,c.description,c.owner_id,
          (SELECT COUNT(*) FROM community_members m WHERE m.community_id=c.id) member_count
          FROM communities c WHERE c.name LIKE ? ESCAPE '\\' LIMIT 20
        """,(term,))]
        users=[dict(r) for r in db.execute("""
          SELECT id,username,display_name,avatar_url FROM users
          WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 20
        """,(term,term))]
        messages=[dict(r) for r in db.execute("""
          SELECT m.id,m.channel_id,m.user_id,u.username,m.content,m.created_at,c.community_id
          FROM messages m JOIN users u ON u.id=m.user_id JOIN channels c ON c.id=m.channel_id
          JOIN community_members cm ON cm.community_id=c.community_id AND cm.user_id=?
          WHERE m.content LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 30
        """,(user["id"],term))]
        return {"communities":communities,"users":users,"messages":messages}

@router.post("/api/reports",status_code=201)
def create_report(data: ReportCreate, user=Depends(current_user)):
    if data.target_user_id is None and data.message_id is None:
        raise HTTPException(422,"Укажите пользователя или сообщение")
    with get_db() as db:
        if data.target_user_id == user["id"]:
            raise HTTPException(422,"Нельзя пожаловаться на себя")
        if data.target_user_id is not None and not db.execute("SELECT 1 FROM users WHERE id=?",(data.target_user_id,)).fetchone():
            raise HTTPException(404,"Пользователь не найден")
        if data.message_id is not None and not db.execute("SELECT 1 FROM messages WHERE id=?",(data.message_id,)).fetchone():
            raise HTTPException(404,"Сообщение не найдено")
        cur=db.execute("INSERT INTO reports(reporter_id,target_user_id,message_id,reason) VALUES(?,?,?,?)",(user["id"],data.target_user_id,data.message_id,data.reason.strip()))
        return {"id":cur.lastrowid,"status":"open"}

@router.get("/api/moderation/reports")
def list_reports(user=Depends(current_user)):
    with get_db() as db:
        if not user.get("is_admin"):
            raise HTTPException(403,"Требуется администратор платформы")
        return [dict(r) for r in db.execute("SELECT * FROM reports ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC LIMIT 200")]

@router.post("/api/moderation/reports/{rid}/resolve")
def resolve_report(rid: int, data: ReportResolve, user=Depends(current_user)):
    with get_db() as db:
        if not user.get("is_admin"):
            raise HTTPException(403,"Требуется администратор платформы")
        cur=db.execute("UPDATE reports SET status=?,resolution=?,moderator_id=? WHERE id=? AND status='open'",(data.status,data.resolution,user["id"],rid))
        if not cur.rowcount: raise HTTPException(404,"Открытая жалоба не найдена")
        report=db.execute("SELECT * FROM reports WHERE id=?",(rid,)).fetchone()
        notify(report["reporter_id"],"Жалоба рассмотрена",data.resolution)
        log_action(db,user["id"],None,report["target_user_id"],"report_"+data.status,data.resolution)
        return {"status":data.status}

@router.post("/api/moderation/users/{target}/block")
def block_user(target: int, data: BlockCreate, community_id: int | None=None, user=Depends(current_user)):
    with get_db() as db:
        if target == user["id"]: raise HTTPException(422,"Нельзя заблокировать себя")
        if not db.execute("SELECT 1 FROM users WHERE id=?",(target,)).fetchone(): raise HTTPException(404,"Пользователь не найден")
        if community_id is not None:
            actor=require_manager(db,community_id,user["id"])
            if actor not in ("owner","admin","moderator"): raise HTTPException(403,"Недостаточно прав")
            if member(db,community_id,target):
                db.execute("DELETE FROM community_members WHERE community_id=? AND user_id=?",(community_id,target))
            log_action(db,user["id"],community_id,target,"community_block",data.reason)
        else:
            if not user.get("is_admin"): raise HTTPException(403,"Для блокировки на платформе нужен администратор")
            log_action(db,user["id"],None,target,"platform_block",data.reason)
        db.execute("INSERT OR IGNORE INTO user_blocks(user_id,blocked_user_id,reason) VALUES(?,?,?)",(user["id"],target,data.reason))
        notify(db,target,"Ограничение доступа",data.reason)
        return {"status":"blocked","user_id":target}

@router.get("/api/moderation/log")
def moderation_log(community_id: int | None=None, user=Depends(current_user)):
    with get_db() as db:
        if community_id is not None:
            require_manager(db,community_id,user["id"])
            return [dict(r) for r in db.execute("SELECT * FROM moderation_log WHERE community_id=? ORDER BY id DESC LIMIT 200",(community_id,))]
        if not user.get("is_admin"): raise HTTPException(403,"Требуется администратор платформы")
        return [dict(r) for r in db.execute("SELECT * FROM moderation_log ORDER BY id DESC LIMIT 200")]

@router.post("/api/voice/{channel_id}/signal",status_code=201)
def send_voice_signal(channel_id: int, data: VoiceSignal, user=Depends(current_user)):
    import json
    try: payload=json.loads(data.payload)
    except Exception: raise HTTPException(422,"payload должен быть JSON")
    if not isinstance(payload,dict) or payload.get("type") not in ("offer","answer","candidate","hangup"):
        raise HTTPException(422,"Недопустимый тип сигнала")
    with get_db() as db:
        ch=db.execute("SELECT * FROM channels WHERE id=? AND channel_type='voice'",(channel_id,)).fetchone()
        if not ch: raise HTTPException(404,"Голосовая комната не найдена")
        require_member(db,ch["community_id"],user["id"])
        require_member(db,ch["community_id"],data.receiver_id)
        cur=db.execute("INSERT INTO voice_signals(community_id,channel_id,sender_id,receiver_id,payload) VALUES(?,?,?,?,?)",(ch["community_id"],channel_id,user["id"],data.receiver_id,data.payload))
        return {"id":cur.lastrowid,"status":"queued","transport":"signaling-only"}

@router.get("/api/voice/{channel_id}/signals")
def poll_voice_signals(channel_id: int, user=Depends(current_user)):
    with get_db() as db:
        ch=db.execute("SELECT * FROM channels WHERE id=? AND channel_type='voice'",(channel_id,)).fetchone()
        if not ch: raise HTTPException(404,"Голосовая комната не найдена")
        require_member(db,ch["community_id"],user["id"])
        rows=[dict(r) for r in db.execute("SELECT * FROM voice_signals WHERE channel_id=? AND receiver_id=? ORDER BY id LIMIT 100",(channel_id,user["id"]))]
        if rows:
            ids=[r["id"] for r in rows]
            db.execute("DELETE FROM voice_signals WHERE receiver_id=? AND id IN ("+",".join("?" for _ in ids)+")",[user["id"],*ids])
        return rows

@router.get("/api/health/features")
def feature_health():
    return {"status":"ok","features":["profiles","members_roles","community_management","channels_messages","voice_signaling","notifications","search","moderation","windows_build"],"voice_media":"requires WebRTC client and STUN/TURN configuration"}
