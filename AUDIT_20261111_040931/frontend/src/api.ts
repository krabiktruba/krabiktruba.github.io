const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export type ApiRecord = {
  id: number;
  [key: string]: unknown;
};

export type Community = ApiRecord & {
  name: string;
  description?: string | null;
  member_count?: number;
};

export type Channel = ApiRecord & {
  name: string;
  channel_type?: string;
  community_id?: number;
};

export type Message = ApiRecord & {
  content: string;
  user_id?: number;
  username?: string;
  created_at?: string;
  edited_at?: string | null;
};

export type Profile = {
  id: number;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  status: "online" | "away" | "busy" | "offline";
  created_at?: string;
};

export type CommunityMember = {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  status: string;
  role: "owner" | "admin" | "moderator" | "member";
  joined_at?: string;
};

export type Notification = {
  id: number;
  title: string;
  body: string;
  is_read: number;
  created_at: string;
};

export type SearchResults = {
  communities: Community[];
  users: Array<{
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
  }>;
  messages: Message[];
};

export type Report = {
  id: number;
  reporter_id: number;
  target_user_id: number | null;
  message_id: number | null;
  reason: string;
  status: string;
  resolution?: string;
  created_at: string;
};

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  const token = localStorage.getItem("comind_access_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      `Не удалось подключиться к COMIND API (${API_URL}). Проверь backend.`,
    );
  }

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg?: string }) => item.msg || "").filter(Boolean).join("; ")
      : typeof detail === "string"
        ? detail
        : `Ошибка HTTP ${response.status}`;

    if (response.status === 401) {
      throw new Error("Сессия истекла. Войди в аккаунт заново.");
    }

    throw new Error(message);
  }

  return data as T;
}

function list<T>(value: unknown, label: string): T[] {
  if (Array.isArray(value)) return value as T[];

  if (value && typeof value === "object") {
    const obj = value as { items?: unknown; results?: unknown };
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.results)) return obj.results as T[];
  }

  throw new Error(`Неожиданный формат ответа API: ${label}`);
}

function body(data: unknown): string {
  return JSON.stringify(data);
}

export const api = {
  // Сообщества
  async getCommunities(): Promise<Community[]> {
    return list(await request("/api/communities/"), "communities");
  },

  getCommunity(id: number): Promise<Community> {
    return request(`/api/communities/${id}`);
  },

  createCommunity(data: { name: string; description: string }): Promise<Community> {
    return request("/api/communities/", {
      method: "POST",
      body: body(data),
    });
  },

  joinCommunity(id: number) {
    return request<{ status: string; community_id: number }>(
      `/api/communities/${id}/join`,
      { method: "POST" },
    );
  },

  updateCommunity(id: number, data: { name: string; description: string }) {
    return request<Community>(`/api/communities/${id}`, {
      method: "PATCH",
      body: body(data),
    });
  },

  deleteCommunity(id: number) {
    return request<{ status: string; community_id: number }>(
      `/api/communities/${id}`,
      { method: "DELETE" },
    );
  },

  async getMembers(id: number): Promise<CommunityMember[]> {
    return list(await request(`/api/communities/${id}/members`), "members");
  },

  setMemberRole(
    communityId: number,
    userId: number,
    role: "admin" | "moderator" | "member",
  ) {
    return request(`/api/communities/${communityId}/members/${userId}`, {
      method: "PATCH",
      body: body({ role }),
    });
  },

  // Текстовые и голосовые каналы
  async getChannels(communityId: number): Promise<Channel[]> {
    return list(
      await request(`/api/communities/${communityId}/channels`),
      "channels",
    );
  },

  createChannel(communityId: number, name: string): Promise<Channel> {
    return request(`/api/communities/${communityId}/channels`, {
      method: "POST",
      body: body({ name }),
    });
  },

  createVoiceChannel(communityId: number, name: string): Promise<Channel> {
    return request(`/api/communities/${communityId}/voice-channels`, {
      method: "POST",
      body: body({ name }),
    });
  },

  renameChannel(id: number, name: string) {
    return request(`/api/channels/${id}`, {
      method: "PATCH",
      body: body({ name }),
    });
  },

  deleteChannel(id: number) {
    return request(`/api/channels/${id}`, { method: "DELETE" });
  },

  // Сообщения
  async getMessages(channelId: number, limit = 50): Promise<Message[]> {
    return list(
      await request(`/api/channels/${channelId}/messages?limit=${limit}`),
      "messages",
    );
  },

  sendMessage(channelId: number, content: string): Promise<Message> {
    return request(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: body({ content }),
    });
  },

  editMessage(id: number, content: string) {
    return request(`/api/messages/${id}`, {
      method: "PATCH",
      body: body({ content }),
    });
  },

  deleteMessage(id: number) {
    return request(`/api/messages/${id}`, { method: "DELETE" });
  },

  // Профиль пользователя
  getProfile(): Promise<Profile> {
    return request("/api/profile/me");
  },

  updateProfile(data: Partial<Pick<
    Profile,
    "display_name" | "bio" | "avatar_url" | "status"
  >>) {
    return request<Profile>("/api/profile/me", {
      method: "PATCH",
      body: body(data),
    });
  },

  // Поиск
  search(query: string): Promise<SearchResults> {
    return request(`/api/search?q=${encodeURIComponent(query)}`);
  },

  // Уведомления
  getNotifications(limit = 50) {
    return request<{ items: Notification[]; unread: number }>(
      `/api/notifications?limit=${limit}`,
    );
  },

  readNotification(id: number) {
    return request(`/api/notifications/${id}/read`, { method: "POST" });
  },

  readAllNotifications() {
    return request("/api/notifications/read-all", { method: "POST" });
  },

  // Жалобы и модерация
  createReport(data: {
    target_user_id?: number;
    message_id?: number;
    reason: string;
  }) {
    return request<Report>("/api/reports", {
      method: "POST",
      body: body(data),
    });
  },

  getReports() {
    return request<Report[]>("/api/moderation/reports");
  },

  resolveReport(
    id: number,
    status: "resolved" | "rejected",
    resolution: string,
  ) {
    return request(`/api/moderation/reports/${id}/resolve`, {
      method: "POST",
      body: body({ status, resolution }),
    });
  },

  blockUser(userId: number, reason = "", communityId?: number) {
    const query = communityId === undefined
      ? ""
      : `?community_id=${communityId}`;

    return request(`/api/moderation/users/${userId}/block${query}`, {
      method: "POST",
      body: body({ reason }),
    });
  },

  getModerationLog(communityId?: number) {
    const query = communityId === undefined
      ? ""
      : `?community_id=${communityId}`;

    return request(`/api/moderation/log${query}`);
  },

  // Голосовые комнаты: управление участием и сигналами
  joinVoice(channelId: number) {
    return request(`/api/voice/${channelId}/join`, { method: "POST" });
  },

  leaveVoice(channelId: number) {
    return request(`/api/voice/${channelId}/leave`, { method: "POST" });
  },

  getVoicePresence(channelId: number) {
    return request(`/api/voice/${channelId}/presence`);
  },

  muteVoice(channelId: number, muted: boolean) {
    return request(`/api/voice/${channelId}/mute`, {
      method: "PATCH",
      body: body({ muted }),
    });
  },

  sendVoiceSignal(
    channelId: number,
    receiverId: number,
    signal: Record<string, unknown>,
  ) {
    return request(`/api/voice/${channelId}/signal`, {
      method: "POST",
      body: body({
        receiver_id: receiverId,
        payload: JSON.stringify(signal),
      }),
    });
  },

  getVoiceSignals(channelId: number) {
    return request<Array<{
      id: number;
      sender_id: number;
      receiver_id: number;
      payload: string;
    }>>(`/api/voice/${channelId}/signals`);
  },

  // Проверка backend
  health() {
    return request<{ status: string; service?: string }>("/api/health");
  },

  featureHealth() {
    return request<{
      status: string;
      features: string[];
      voice_media: string;
    }>("/api/health/features");
  },
};

export { API_URL };
