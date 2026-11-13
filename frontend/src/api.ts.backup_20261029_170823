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
};

function getToken(): string {
  return localStorage.getItem("comind_access_token") || "";
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (options.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      `Не удалось подключиться к COMIND API (${API_URL}). Проверь, запущен ли backend.`,
    );
  }

  if (!response.ok) {
    let detail = `Ошибка сервера: HTTP ${response.status}`;

    try {
      const data = await response.json();
      if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((item: { msg?: string }) => item.msg || "")
          .filter(Boolean)
          .join("; ");
      }
    } catch {
      // Оставляем сообщение с HTTP-кодом.
    }

    if (response.status === 401) {
      throw new Error("Сессия истекла. Войди в аккаунт заново.");
    }

    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function asArray<T>(value: unknown, label: string): T[] {
  if (Array.isArray(value)) return value as T[];

  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: T[] }).items;
  }

  throw new Error(`Неожиданный формат ответа API: ${label}`);
}

export const api = {
  async getCommunities(): Promise<Community[]> {
    const result = await request<unknown>("/api/communities/");
    return asArray<Community>(result, "communities");
  },

  getCommunity(id: number): Promise<Community> {
    return request<Community>(`/api/communities/${id}`);
  },

  createCommunity(data: {
    name: string;
    description: string;
  }): Promise<Community> {
    return request<Community>("/api/communities/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  joinCommunity(id: number): Promise<{ status: string; community_id: number }> {
    return request(`/api/communities/${id}/join`, {
      method: "POST",
    });
  },

  async getChannels(communityId: number): Promise<Channel[]> {
    const result = await request<unknown>(
      `/api/communities/${communityId}/channels`,
    );
    return asArray<Channel>(result, "channels");
  },

  createChannel(
    communityId: number,
    name: string,
  ): Promise<Channel> {
    return request(`/api/communities/${communityId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async getMessages(channelId: number, limit = 50): Promise<Message[]> {
    const result = await request<unknown>(
      `/api/channels/${channelId}/messages?limit=${limit}`,
    );
    return asArray<Message>(result, "messages");
  },

  sendMessage(channelId: number, content: string): Promise<Message> {
    return request(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  },

  deleteMessage(messageId: number): Promise<{ status: string; message_id: number }> {
    return request(`/api/messages/${messageId}`, {
      method: "DELETE",
    });
  },
};

export { API_URL };
