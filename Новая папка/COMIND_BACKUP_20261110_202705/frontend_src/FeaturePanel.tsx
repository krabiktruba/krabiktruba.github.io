import { useEffect, useState } from "react";
import "./FeaturePanel.css";
import { appPrompt, appConfirm, appSelect } from "./appDialog";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

type Item = { id: number; [key: string]: any };
type Tab = "profile" | "members" | "community" | "channels" | "voice" | "notifications" | "search" | "moderation";

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const token = localStorage.getItem("comind_access_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(Array.isArray(detail) ? detail.map((x: any) => x.msg || "").join("; ") : detail || `HTTP ${response.status}`);
  }
  return data as T;
}

const tabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Профиль" },
  { id: "members", label: "Участники" },
  { id: "community", label: "Сообщество" },
  { id: "channels", label: "Каналы" },
  { id: "voice", label: "Голосовые" },
  { id: "notifications", label: "Уведомления" },
  { id: "search", label: "Поиск" },
  { id: "moderation", label: "Модерация" },
];

export default function FeaturePanel({
  username, communityId, channelId, onClose, onRefresh, onCommunityDeleted,
}: {
  username: string;
  communityId: number | null;
  channelId: number | null;
  onClose: () => void;
  onRefresh: () => void;
  onCommunityDeleted: () => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState<any>({
    display_name: "", bio: "", avatar_url: "", status: "online",
  });
  const [members, setMembers] = useState<Item[]>([]);
  const [channels, setChannels] = useState<Item[]>([]);
  const [notifications, setNotifications] = useState<Item[]>([]);
  const [reports, setReports] = useState<Item[]>([]);
  const [communityName, setCommunityName] = useState("");
  const [communityDescription, setCommunityDescription] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [channelName, setChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState("text");
  const [newChannelVisibility, setNewChannelVisibility] = useState<"public" | "private">("public");
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceMembers, setVoiceMembers] = useState<Item[]>([]);

  function flash(text: string, failed = false) {
    setError(failed ? text : "");
    setMessage(failed ? "" : text);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  }

  async function loadProfile() {
    const data = await request("/api/profile/me");
    setProfile({
      display_name: data.display_name || "",
      bio: data.bio || "",
      avatar_url: data.avatar_url || "",
      status: data.status || "online",
    });
  }

  async function loadMembers() {
    if (!communityId) return;
    setMembers(await request(`/api/features/communities/${communityId}/members`));
  }

  async function loadChannels() {
    if (!communityId) return;
    const data = await request(`/api/communities/${communityId}/channels`);
    setChannels(Array.isArray(data) ? data : data?.items || []);
  }

  async function loadNotifications() {
    const data = await request("/api/notifications");
    setNotifications(data.items || []);
  }

  async function loadVoiceMembers() {
    if (!channelId) return;
    const data = await request(`/api/voice/${channelId}/presence`);
    setVoiceMembers(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    void loadProfile().catch((e) => flash(e.message, true));
  }, []);

  useEffect(() => {
    setError("");
    setMessage("");
    if (tab === "members") void loadMembers().catch((e) => flash(e.message, true));
    if (tab === "channels") void loadChannels().catch((e) => flash(e.message, true));
    if (tab === "notifications") void loadNotifications().catch((e) => flash(e.message, true));
    if (tab === "moderation") {
      void request("/api/moderation/reports")
        .then((data) => setReports(Array.isArray(data) ? data : []))
        .catch((e) => flash(e.message, true));
    }
    if (tab === "voice" && channelId) {
      void loadVoiceMembers().catch((e) => flash(e.message, true));
    }
  }, [tab, communityId, channelId]);

  useEffect(() => {
    if (tab !== "voice" || !voiceJoined || !channelId) return;
    const timer = window.setInterval(() => {
      void loadVoiceMembers().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [tab, voiceJoined, channelId]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const data = await request("/api/profile/me", {
        method: "PATCH", body: JSON.stringify(profile),
      });
      setProfile({
        display_name: data.display_name || "",
        bio: data.bio || "",
        avatar_url: data.avatar_url || "",
        status: data.status || "online",
      });
      flash("Профиль сохранён.");
      onRefresh();
    });
  }

  async function saveCommunity(event: React.FormEvent) {
    event.preventDefault();
    if (!communityId) return;
    await run(async () => {
      await request(`/api/communities/${communityId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: communityName.trim(), description: communityDescription.trim() }),
      });
      flash("Настройки сообщества сохранены.");
      onRefresh();
    });
  }

  async function deleteCommunity() {
    if (!communityId || !(await appConfirm({ title: "??????? ???????????", message: "?????????? ????? ??????? ?????? ? ??? ????????. ??? ???????? ??????????.", confirmText: "??????? ??????????", danger: true }))) return;
    await run(async () => {
      await request(`/api/communities/${communityId}`, { method: "DELETE" });
      onCommunityDeleted();
      flash("Сообщество удалено.");
      onClose();
    });
  }

  async function createChannel(event: React.FormEvent) {
    event.preventDefault();
    if (!communityId || !channelName.trim()) return;
    await run(async () => {
      const path = newChannelType === "voice"
        ? `/api/communities/${communityId}/voice-channels`
        : `/api/communities/${communityId}/channels`;
      await request(path, { method: "POST", body: JSON.stringify({ name: channelName.trim(), visibility: newChannelVisibility }) });
      setChannelName("");
      setNewChannelVisibility("public");
      await loadChannels();
      onRefresh();
      flash("Канал создан.");
    });
  }

  async function renameChannel(item: Item) {
    const name = await appPrompt({ title: "????????????? ?????", message: "??????? ????? ???????? ??????:", defaultValue: item.name, placeholder: "???????? ??????", confirmText: "?????????" });
    if (!name?.trim()) return;
    await run(async () => {
      await request(`/api/channels/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ name: name.trim() }),
      });
      await loadChannels();
      flash("Канал переименован.");
    });
  }

  async function removeChannel(item: Item) {
    if (!(await appConfirm({ title: "??????? ??????", message: `??????? ????? ?${item.name}??`, confirmText: "??????? ?????", danger: true }))) return;
    await run(async () => {
      await request(`/api/channels/${item.id}`, { method: "DELETE" });
      await loadChannels();
      onRefresh();
      flash("Канал удалён.");
    });
  }

  async function changeRole(item: Item) {
    const role = await appSelect({ title: "???????? ???? ?????????", message: `???????? ???? ??? ${item.username}:`, defaultValue: item.role || "member", options: [{ value: "member", label: "????????" }, { value: "moderator", label: "?????????" }, { value: "admin", label: "?????????????" }], confirmText: "?????????" });
    if (!role || !["member", "moderator", "admin"].includes(role)) return;
    await run(async () => {
      await request(`/api/communities/${communityId}/members/${item.user_id}`, {
        method: "PATCH", body: JSON.stringify({ role }),
      });
      await loadMembers();
      flash("Роль обновлена.");
    });
  }

  async function reportUser(item: Item) {
    const reason = await appPrompt({ title: "???????????? ?? ?????????", message: `??????? ??????? ?????? ?? ${item.username}:`, placeholder: "??????? ??????...", multiline: true, rows: 5, confirmText: "????????? ??????" });
    if (!reason?.trim()) return;
    await run(async () => {
      await request("/api/reports", {
        method: "POST",
        body: JSON.stringify({ target_user_id: item.user_id, reason: reason.trim() }),
      });
      flash("Жалоба отправлена.");
    });
  }

  async function blockMember(item: Item) {
    const reason = await appPrompt({ title: "???????? ?????????", message: `??????? ??????? ???????? ${item.username}:`, defaultValue: "????????? ??????", placeholder: "??????? ????????...", multiline: true, rows: 4, confirmText: "??????????" });
    if (!reason?.trim() || !communityId) return;
    if (!(await appConfirm({ title: "??????? ??????????", message: `????????? ${item.username} ?? ???????????`, confirmText: "?????????", danger: true }))) return;
    await run(async () => {
      await request(`/api/moderation/users/${item.user_id}/block?community_id=${communityId}`, {
        method: "POST", body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadMembers();
      flash("Участник удалён из сообщества.");
    });
  }

  async function searchAll(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    await run(async () => {
      setResults(await request(`/api/search?q=${encodeURIComponent(query.trim())}`));
    });
  }

  async function joinVoice() {
    if (!channelId) {
      flash("Сначала выбери голосовой канал в списке каналов.", true);
      return;
    }
    await run(async () => {
      await request(`/api/voice/${channelId}/join`, { method: "POST" });
      setVoiceJoined(true);
      await loadVoiceMembers();
      flash("Ты подключён к комнате. Передача аудио требует настройки WebRTC.");
    });
  }

  async function leaveVoice() {
    if (!channelId) return;
    await run(async () => {
      await request(`/api/voice/${channelId}/leave`, { method: "POST" });
      setVoiceJoined(false);
      setVoiceMuted(false);
      await loadVoiceMembers();
      flash("Ты покинул голосовую комнату.");
    });
  }

  async function toggleMute() {
    if (!channelId || !voiceJoined) {
      flash("Сначала подключись к голосовой комнате.", true);
      return;
    }
    await run(async () => {
      const muted = !voiceMuted;
      await request(`/api/voice/${channelId}/mute`, {
        method: "PATCH", body: JSON.stringify({ muted }),
      });
      setVoiceMuted(muted);
      flash(muted ? "Микрофон отмечен как выключенный." : "Микрофон отмечен как включённый.");
    });
  }

  async function resolveReport(item: Item, status: "resolved" | "rejected") {
    const resolution = await appPrompt({ title: "??????? ?? ??????", message: "??????? ??????????? ??????????:", defaultValue: status === "resolved" ? "???????????" : "?????????", multiline: true, rows: 4, confirmText: "????????? ???????" });
    if (!resolution?.trim()) return;
    await run(async () => {
      await request(`/api/moderation/reports/${item.id}/resolve`, {
        method: "POST", body: JSON.stringify({ status, resolution: resolution.trim() }),
      });
      setReports((prev) => prev.filter((r) => r.id !== item.id));
      flash("Решение по жалобе сохранено.");
    });
  }

  return (
    <div className="fp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="fp-panel">
        <header className="fp-header">
          <div><span className="fp-eyebrow">COMIND SOON</span><h2>Функции приложения</h2><p>Аккаунт: {username}</p></div>
          <button className="fp-close" onClick={onClose}>×</button>
        </header>

        <nav className="fp-tabs">
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>

        {error && <div className="fp-alert error">{error}</div>}
        {message && <div className="fp-alert">{message}</div>}
        {busy && <div className="fp-busy">Выполняется операция…</div>}

        <div className="fp-content">
          {tab === "profile" && <form onSubmit={saveProfile} className="fp-form">
            <h3>Профиль пользователя</h3>
            {profile.avatar_url && <img className="fp-avatar-preview" src={profile.avatar_url} alt="Аватар" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
            <label>Ссылка на аватар<input value={profile.avatar_url} onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })} placeholder="https://example.com/avatar.png" /></label>
            <label>Отображаемое имя<input value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} maxLength={60} /></label>
            <label>О себе<textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} maxLength={500} rows={3} /></label>
            <label>Статус<select value={profile.status} onChange={(e) => setProfile({ ...profile, status: e.target.value })}><option value="online">В сети</option><option value="away">Отошёл</option><option value="busy">Не беспокоить</option><option value="offline">Не в сети</option></select></label>
            <button disabled={busy} type="submit">Сохранить профиль</button>
          </form>}

          {tab === "members" && <section>
            <h3>Участники сообщества</h3>
            {!communityId ? <p>Сначала выбери сообщество.</p> : members.map((item) => <article className="fp-row" key={item.user_id}>
              <div className="fp-person">{item.avatar_url ? <img src={item.avatar_url} alt="" /> : <span>{String(item.username || "?").slice(0,1).toUpperCase()}</span>}</div>
              <div className="fp-row-main"><strong>{item.display_name || item.username}</strong><small>@{item.username} · {item.role} · {item.status || "online"}</small></div>
              {item.role !== "owner" && <div className="fp-row-actions"><button onClick={() => void changeRole(item)}>Роль</button><button onClick={() => void reportUser(item)}>Жалоба</button><button className="danger" onClick={() => void blockMember(item)}>Удалить</button></div>}
            </article>)}
          </section>}

          {tab === "community" && <section className="fp-form">
            <h3>Управление сообществом</h3>
            {!communityId ? <p>Сначала выбери сообщество.</p> : <>
              <label>Новое название<input value={communityName} onChange={(e) => setCommunityName(e.target.value)} minLength={3} maxLength={60} /></label>
              <label>Описание<textarea value={communityDescription} onChange={(e) => setCommunityDescription(e.target.value)} maxLength={1000} rows={4} /></label>
              <button onClick={() => void run(async () => {
                const c = await request(`/api/communities/${communityId}`);
                setCommunityName(c.name || "");
                setCommunityDescription(c.description || "");
                flash("Данные сообщества загружены.");
              })}>Загрузить текущие настройки</button>
              <button onClick={(e) => {
                e.preventDefault();
                void saveCommunity({ preventDefault: () => {} } as React.FormEvent);
              }}>Сохранить изменения</button>
              <button className="danger" onClick={() => void deleteCommunity()}>Удалить сообщество</button>
            </>}
          </section>}

          {tab === "channels" && <section>
            <h3>Текстовые каналы</h3>
            {!communityId ? <p>Сначала выбери сообщество.</p> : <>
              <form className="fp-inline-form" onSubmit={createChannel}>
                <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Название канала: general" minLength={2} maxLength={50} required />
                <select value={newChannelType} onChange={(e) => setNewChannelType(e.target.value)}><option value="text">Текстовый</option><option value="voice">Голосовой</option></select>
                <select
                  value={newChannelVisibility}
                  onChange={(e) => setNewChannelVisibility(e.target.value as "public" | "private")}
                  aria-label="Channel access"
                >
                  <option value="public">{"\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0439"}</option>
                  <option value="private">{"\u041f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0439"}</option>
                </select>
                <button disabled={busy}>Создать</button>
              </form>
              {channels.map((item) => <article className="fp-row" key={item.id}>
                <div className="fp-row-main"><strong>{item.channel_type === "voice" ? "◖" : "#"} {item.name}</strong><small>{item.channel_type || "text"} · ID {item.id}</small></div>
                <div className="fp-row-actions"><button onClick={() => void renameChannel(item)}>Переименовать</button><button className="danger" onClick={() => void removeChannel(item)}>Удалить</button></div>
              </article>)}
            </>}
          </section>}

          {tab === "voice" && <section>
            <h3>Голосовые комнаты</h3>
            <p>Сначала выбери голосовой канал. Сейчас доступны подключение к комнате и список присутствующих; передача живого звука требует отдельного WebRTC-клиента.</p>
            <div className="fp-actions"><button disabled={busy || voiceJoined || !channelId} onClick={() => void joinVoice()}>Подключиться</button><button disabled={busy || !voiceJoined} onClick={() => void leaveVoice()}>Отключиться</button><button disabled={busy || !voiceJoined} onClick={() => void toggleMute()}>{voiceMuted ? "Включить микрофон" : "Выключить микрофон"}</button><button onClick={() => void run(loadVoiceMembers)}>Обновить участников</button></div>
            <p>Состояние: <strong>{voiceJoined ? "подключён" : "не подключён"}</strong> · Микрофон: <strong>{voiceMuted ? "выключен" : "включён"}</strong></p>
            {voiceMembers.map((item) => <article className="fp-row" key={item.user_id}><div className="fp-row-main"><strong>{item.display_name || item.username}</strong><small>{item.muted ? "Микрофон выключен" : "В комнате"}</small></div></article>)}
          </section>}

          {tab === "notifications" && <section>
            <div className="fp-section-title"><h3>Уведомления</h3><button onClick={() => void run(async () => { await request("/api/notifications/read-all", { method: "POST" }); await loadNotifications(); flash("Все уведомления прочитаны."); })}>Прочитать все</button></div>
            {!notifications.length && <p>Уведомлений пока нет.</p>}
            {notifications.map((item) => <article className={`fp-notification ${item.is_read ? "" : "unread"}`} key={item.id}><strong>{item.title}</strong><p>{item.body}</p><small>{item.created_at}</small>{!item.is_read && <button onClick={() => void run(async () => { await request(`/api/notifications/${item.id}/read`, { method: "POST" }); await loadNotifications(); })}>Прочитано</button>}</article>)}
          </section>}

          {tab === "search" && <section>
            <h3>Поиск по COMIND</h3>
            <form className="fp-inline-form" onSubmit={searchAll}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пользователи, сообщества, сообщения" minLength={2} /><button disabled={busy}>Найти</button></form>
            {results && <>
              <h4>Сообщества</h4>{(results.communities || []).map((x: Item) => <article className="fp-row" key={x.id}><div className="fp-row-main"><strong>{x.name}</strong><small>{x.description}</small></div></article>)}
              <h4>Пользователи</h4>{(results.users || []).map((x: Item) => <article className="fp-row" key={x.id}><div className="fp-row-main"><strong>{x.display_name || x.username}</strong><small>@{x.username}</small></div></article>)}
              <h4>Сообщения</h4>{(results.messages || []).map((x: Item) => <article className="fp-row" key={x.id}><div className="fp-row-main"><strong>{x.username} · канал {x.channel_id}</strong><small>{x.content}</small></div></article>)}
            </>}
          </section>}

          {tab === "moderation" && <section>
            <h3>Администрирование и жалобы</h3>
            <p>Список жалоб и решения доступны аккаунту платформенного администратора. Роли в сообществах настраиваются во вкладке «Участники».</p>
            {!reports.length && <p>Открытых жалоб нет или у аккаунта нет доступа к модерации.</p>}
            {reports.map((item) => <article className="fp-row" key={item.id}>
              <div className="fp-row-main"><strong>Жалоба #{item.id} · {item.status}</strong><small>{item.reason} · пользователь {item.target_user_id ?? "не указан"} · сообщение {item.message_id ?? "не указано"}</small></div>
              {item.status === "open" && <div className="fp-row-actions"><button onClick={() => void resolveReport(item, "resolved")}>Решить</button><button className="danger" onClick={() => void resolveReport(item, "rejected")}>Отклонить</button></div>}
            </article>)}
          </section>}
        </div>
      </section>
    </div>
  );
}