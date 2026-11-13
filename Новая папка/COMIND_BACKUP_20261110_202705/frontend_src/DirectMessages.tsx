import { useCallback, useEffect, useRef, useState } from "react";

const DM_API = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

type Conversation = {
  id: number;
  friend_id: number;
  friend_username: string;
  last_message: string;
  last_message_id: number | null;
  last_message_at: string | null;
  last_read_message_id: number;
  is_blocked_by_me: boolean;
  is_blocked_by_them: boolean;
  can_send: boolean;
};

type DirectMessageItem = {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_username: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
};

type Props = {
  userId?: number;
};

async function dmRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("comind_access_token");

  const response = await fetch(`${DM_API}/api/dm${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Ошибка ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export default function DirectMessages({ userId }: Props) {
  const [opened, setOpened] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [draft, setDraft] = useState("");
  const [friendIdInput, setFriendIdInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Record<number, number>>({});

  const loadConversations = useCallback(async () => {
    try {
      const result = await dmRequest<Conversation[]>("/conversations");
      setConversations(result);

      if (active) {
        const updated = result.find(item => item.id === active.id);
        if (updated) setActive(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить диалоги");
    }
  }, [active]);

  const loadMessages = useCallback(async (conversation: Conversation) => {
    try {
      const after = messagesRef.current[conversation.id] || 0;
      const result = await dmRequest<DirectMessageItem[]>(
        `/${conversation.id}/updates?after_id=${after}`
      );

      if (result.length) {
        setMessages(current => {
          const merged = [...current, ...result];
          const unique = Array.from(
            new Map(merged.map(item => [item.id, item])).values()
          );
          return unique.sort((a, b) => a.id - b.id);
        });

        messagesRef.current[conversation.id] = Math.max(
          after,
          ...result.map(item => item.id)
        );

        const last = Math.max(...result.map(item => item.id));

        void dmRequest(
          `/${conversation.id}/read?message_id=${last}`,
          { method: "POST" }
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки сообщений");
    }
  }, []);

  const openConversation = async (conversation: Conversation) => {
    setActive(conversation);
    setMessages([]);
    setEditingId(null);
    setDraft("");
    messagesRef.current[conversation.id] = 0;
    setError("");
    setLoading(true);

    try {
      const result = await dmRequest<DirectMessageItem[]>(
        `/${conversation.id}/messages`
      );

      setMessages(result);
      messagesRef.current[conversation.id] = result.length
        ? result[result.length - 1].id
        : 0;

      if (result.length) {
        void dmRequest(
          `/${conversation.id}/read?message_id=${result[result.length - 1].id}`,
          { method: "POST" }
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки переписки");
    } finally {
      setLoading(false);
    }
  };

  const startConversation = async (friendId: number) => {
    setError("");

    try {
      const result = await dmRequest<{ id: number; friend_id: number }>(
        "/conversations",
        {
          method: "POST",
          body: JSON.stringify({ friend_id: friendId }),
        }
      );

      const list = await dmRequest<Conversation[]>("/conversations");
      setConversations(list);

      const found = list.find(item => item.id === result.id);

      if (found) {
        await openConversation(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть диалог");
    }
  };

  const sendMessage = async () => {
    if (!active || !draft.trim() || !active.can_send) return;

    const content = draft.trim();
    setDraft("");
    setError("");

    try {
      const result = await dmRequest<DirectMessageItem>(
        `/${active.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        }
      );

      setMessages(current => [...current, result]);
      messagesRef.current[active.id] = result.id;
      await loadConversations();
    } catch (e) {
      setDraft(content);
      setError(e instanceof Error ? e.message : "Не удалось отправить сообщение");
    }
  };

  const saveEdit = async (messageId: number) => {
    if (!active || !editingText.trim()) return;

    try {
      const updated = await dmRequest<DirectMessageItem>(
        `/${active.id}/messages/${messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ content: editingText.trim() }),
        }
      );

      setMessages(current =>
        current.map(item => item.id === messageId ? updated : item)
      );
      setEditingId(null);
      setEditingText("");
      setError("");
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить сообщение");
    }
  };

  const deleteMessage = async (messageId: number) => {
    if (!active) return;
    if (!window.confirm("Удалить это сообщение для обоих участников?")) return;

    try {
      const updated = await dmRequest<DirectMessageItem>(
        `/${active.id}/messages/${messageId}`,
        { method: "DELETE" }
      );

      setMessages(current =>
        current.map(item => item.id === messageId ? updated : item)
      );
      setError("");
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить сообщение");
    }
  };

  const clearHistory = async () => {
    if (!active) return;

    if (!window.confirm(
      "Скрыть всю текущую историю только у тебя? У собеседника сообщения останутся."
    )) return;

    try {
      const result = await dmRequest<{
        cleared_before_message_id: number;
      }>(`/${active.id}/clear`, { method: "POST" });

      messagesRef.current[active.id] = result.cleared_before_message_id;
      setMessages([]);
      setEditingId(null);
      setError("");
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сбросить историю");
    }
  };

  const deleteConversation = async () => {
    if (!active) return;

    if (!window.confirm(
      "Удалить диалог из твоего списка? История собеседника сохранится."
    )) return;

    try {
      await dmRequest(`/conversations/${active.id}`, {
        method: "DELETE",
      });

      setActive(null);
      setMessages([]);
      setEditingId(null);
      await loadConversations();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить диалог");
    }
  };

  const toggleBlock = async () => {
    if (!active) return;

    const currentlyBlocked = active.is_blocked_by_me;

    const question = currentlyBlocked
      ? "Разблокировать этого пользователя?"
      : "Заблокировать пользователя? Он не сможет отправлять тебе сообщения.";

    if (!window.confirm(question)) return;

    try {
      await dmRequest(
        `/${active.id}/block`,
        { method: currentlyBlocked ? "DELETE" : "POST" }
      );

      setActive(current => current ? {
        ...current,
        is_blocked_by_me: !currentlyBlocked,
        can_send: currentlyBlocked
          ? !current.is_blocked_by_them
          : false,
      } : current);

      await loadConversations();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить блокировку");
    }
  };

  useEffect(() => {
    if (!opened) return;

    void loadConversations();

    const timer = window.setInterval(() => {
      void loadConversations();
      if (active) void loadMessages(active);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [opened, active, loadConversations, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = Boolean(active?.can_send);

  return (
    <>
      <button
        className="dm-launch"
        onClick={() => {
          setOpened(value => !value);
          setError("");
        }}
      >
        <span>✉</span> Сообщения
      </button>

      {opened && (
        <div className="dm-overlay">
          <section className="dm-window">
            <header className="dm-header">
              <div>
                <strong>Личные сообщения</strong>
                <small>Приватные диалоги</small>
              </div>
              <button onClick={() => setOpened(false)}>✕</button>
            </header>

            <div className="dm-layout">
              <aside className="dm-list">
                <div className="dm-list-title">Диалоги</div>

                <form
                  className="dm-new-chat"
                  onSubmit={event => {
                    event.preventDefault();
                    const id = Number(friendIdInput);
                    if (Number.isInteger(id) && id > 0) {
                      void startConversation(id);
                      setFriendIdInput("");
                    }
                  }}
                >
                  <input
                    type="number"
                    min="1"
                    value={friendIdInput}
                    onChange={event => setFriendIdInput(event.target.value)}
                    placeholder="ID друга"
                  />
                  <button type="submit" disabled={!friendIdInput.trim()}>
                    + Новый диалог
                  </button>
                </form>

                {conversations.length === 0 && (
                  <p className="dm-empty">
                    Пока нет переписок. Создай диалог с другом по его ID.
                  </p>
                )}

                {conversations.map(item => (
                  <button
                    key={item.id}
                    className={`dm-conversation ${
                      active?.id === item.id ? "active" : ""
                    }`}
                    onClick={() => void openConversation(item)}
                  >
                    <span className="dm-avatar">
                      {item.friend_username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="dm-conversation-info">
                      <strong>{item.friend_username}</strong>
                      <small>
                        {item.is_blocked_by_me
                          ? "Заблокирован тобой"
                          : item.is_blocked_by_them
                            ? "Пользователь заблокировал тебя"
                            : item.last_message || "Начните переписку"}
                      </small>
                    </span>
                  </button>
                ))}
              </aside>

              <section className="dm-chat">
                {active ? (
                  <>
                    <div className="dm-chat-heading">
                      <button
                        className="dm-back"
                        onClick={() => setActive(null)}
                      >
                        ←
                      </button>

                      <strong>{active.friend_username}</strong>

                      <div className="dm-dialog-actions">
                        <button
                          type="button"
                          title="Сбросить историю у себя"
                          onClick={() => void clearHistory()}
                        >
                          Сбросить
                        </button>

                        <button
                          type="button"
                          title="Удалить диалог из своего списка"
                          onClick={() => void deleteConversation()}
                        >
                          Удалить
                        </button>

                        <button
                          type="button"
                          className={active.is_blocked_by_me ? "dm-unblock" : "dm-block"}
                          onClick={() => void toggleBlock()}
                        >
                          {active.is_blocked_by_me
                            ? "Разблокировать"
                            : "Заблокировать"}
                        </button>
                      </div>
                    </div>

                    {active.is_blocked_by_them && (
                      <div className="dm-warning">
                        Этот пользователь заблокировал тебя. Отправка недоступна.
                      </div>
                    )}

                    {active.is_blocked_by_me && (
                      <div className="dm-warning">
                        Пользователь заблокирован тобой. Разблокируй его для отправки.
                      </div>
                    )}

                    {!canSend &&
                      !active.is_blocked_by_me &&
                      !active.is_blocked_by_them && (
                        <div className="dm-warning">
                          Отправка недоступна: вы больше не друзья.
                        </div>
                    )}

                    <div className="dm-messages">
                      {loading && <p className="dm-empty">Загрузка...</p>}

                      {messages.map(message => {
                        const mine = message.sender_id === userId;

                        return (
                          <article
                            key={message.id}
                            className={`dm-message ${mine ? "mine" : ""}`}
                          >
                            <div className="dm-message-author">
                              {message.sender_username}
                            </div>

                            {editingId === message.id ? (
                              <div className="dm-edit-area">
                                <textarea
                                  value={editingText}
                                  onChange={event =>
                                    setEditingText(event.target.value)
                                  }
                                  maxLength={10000}
                                  autoFocus
                                />
                                <div className="dm-message-actions">
                                  <button
                                    onClick={() => void saveEdit(message.id)}
                                  >
                                    Сохранить
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditingText("");
                                    }}
                                  >
                                    Отмена
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>{message.content}</div>
                            )}

                            {message.edited_at && !message.is_deleted && (
                              <span className="dm-edited">изменено</span>
                            )}

                            <time>
                              {new Date(message.created_at).toLocaleString()}
                            </time>

                            {mine && !message.is_deleted &&
                              editingId !== message.id && (
                                <div className="dm-message-actions">
                                  <button
                                    onClick={() => {
                                      setEditingId(message.id);
                                      setEditingText(message.content);
                                    }}
                                  >
                                    Изменить
                                  </button>
                                  <button
                                    className="dm-danger-text"
                                    onClick={() => void deleteMessage(message.id)}
                                  >
                                    Удалить
                                  </button>
                                </div>
                              )}
                          </article>
                        );
                      })}

                      <div ref={bottomRef} />
                    </div>

                    <form
                      className="dm-composer"
                      onSubmit={event => {
                        event.preventDefault();
                        void sendMessage();
                      }}
                    >
                      <input
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        placeholder={
                          canSend
                            ? "Напишите сообщение..."
                            : "Отправка сообщений недоступна"
                        }
                        maxLength={10000}
                        disabled={!canSend}
                      />
                      <button
                        type="submit"
                        disabled={!draft.trim() || !canSend}
                      >
                        Отправить
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="dm-welcome">
                    <span>✉</span>
                    <strong>Ваши личные сообщения</strong>
                    <p>
                      Выбери диалог слева или начни переписку с другом.
                    </p>
                  </div>
                )}
              </section>
            </div>

            {error && <div className="dm-error">{error}</div>}
          </section>
        </div>
      )}
    </>
  );
}