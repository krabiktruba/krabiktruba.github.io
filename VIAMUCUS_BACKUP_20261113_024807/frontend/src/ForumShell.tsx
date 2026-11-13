import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type ForumCategory, type ForumTopic, type ForumPost, type Profile, type SearchResults } from "./api";
import "./ForumShell.css";

function AttachmentList({
  attachments,
  onDownload,
}: {
  attachments?: import("./api").ForumAttachment[];
  onDownload: (id: number, name: string) => void;
}) {
  if (!attachments?.length) return null;

  return (
    <div className="forum-attachments">
      <strong>Вложения ({attachments.length})</strong>
      {attachments.map((file) => (
        <button
          type="button"
          className="forum-attachment"
          key={file.id}
          onClick={() => onDownload(file.id, file.original_name)}
          title="Скачать файл"
        >
          <span className="forum-attachment-icon">↧</span>
          <span className="forum-attachment-name">{file.original_name}</span>
          <small>{(file.file_size / 1024 / 1024).toFixed(2)} МБ</small>
        </button>
      ))}
    </div>
  );
}

type Page = "home" | "forum" | "news" | "articles" | "users" | "profile";

type Props = {
  page: Page;
  username: string;
  userId: number;
  userIsAdmin: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ForumShell({
  page,
  userId,
  userIsAdmin,
}: Props) {
  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [totalTopics, setTotalTopics] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<ForumTopic | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<number | "">("");
  const [newText, setNewText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editPostContent, setEditPostContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const [userQuery, setUserQuery] = useState("");
  const [foundUsers, setFoundUsers] = useState<SearchResults["users"]>([]);
  const [usersSearched, setUsersSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  async function loadCategories() {
    try {
      const result = await api.getForumCategories();
      setCategories(result);
      setNewCategory((current) => current === "" ? (result[0]?.id ?? "") : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить категории");
    }
  }

  async function loadTopics() {
    setLoading(true);
    setError("");
    try {
      const pageCategorySlug =
        page === "news" ? "gaming-news" :
        page === "articles" ? "guides" :
        null;

      const pageCategory = pageCategorySlug
        ? categories.find((item) => item.slug === pageCategorySlug)
        : null;

      if (pageCategorySlug && !pageCategory) {
        setTopics([]);
        setTotalTopics(0);
        return;
      }

      const result = await api.getForumTopics({
        category_id: pageCategorySlug ? pageCategory!.id : selectedCategory ?? undefined,
        q: query.trim() || undefined,
        limit: 100,
        offset: 0,
      });
      setTopics(result.items);
      setTotalTopics(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить темы");
    } finally {
      setLoading(false);
    }
  }

  async function openTopic(topicId: number) {
    setLoading(true);
    setError("");
    setCreating(false);
    setEditingTopic(false);
    try {
      const [topic, result] = await Promise.all([
        api.getForumTopic(topicId),
        api.getForumPosts(topicId),
      ]);
      setSelectedTopic(topic);
      setPosts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть тему");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    if (!selectedTopic && !creating) void loadTopics();
  }, [selectedCategory, query, selectedTopic, creating, page, categories]);

  useEffect(() => {
    if (page !== "profile") return;

    let active = true;
    setProfileLoading(true);
    setError("");

    api.getProfile()
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить профиль");
        }
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page]);

  const selectedCategoryName = useMemo(
    () => categories.find((item) => item.id === selectedCategory)?.name ?? "Все категории",
    [categories, selectedCategory],
  );

  const heading: Record<Page, string> = {
    home: "Главная",
    forum: "Форум",
    news: "Новости",
    articles: "Статьи",
    users: "Пользователи",
    profile: "Мой профиль",
  };

  const canManageTopic = Boolean(
    selectedTopic && (selectedTopic.author_id === userId || userIsAdmin),
  );

  function startEditTopic() {
    if (!selectedTopic) return;
    setEditTitle(selectedTopic.title);
    setEditContent(selectedTopic.content);
    setEditingTopic(true);
  }

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const requiredSlug =
      page === "news" ? "gaming-news" :
      page === "articles" ? "guides" :
      null;

    const requiredCategory = requiredSlug
      ? categories.find((item) => item.slug === requiredSlug)
      : null;

    if (requiredSlug && !requiredCategory) {
      setError("Не найдена категория для этого раздела. Обновите список категорий.");
      return;
    }

    const categoryId = requiredCategory?.id ?? newCategory;

    if (!newTitle.trim() || !newText.trim() || categoryId === "") return;

    setSaving(true);
    setError("");
    try {
      const topic = await api.createForumTopic({
        category_id: Number(categoryId),
        title: newTitle.trim(),
        content: newText.trim(),
      });
      for (const file of newFiles) {
        await api.uploadForumAttachment("topic", topic.id, file);
      }
      setNewFiles([]);
      setNewTitle("");
      setNewText("");
      setCreating(false);
      setSelectedCategory(null);
      await openTopic(topic.id);
      await loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать тему");
    } finally {
      setSaving(false);
    }
  }

  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTopic) return;

    setSaving(true);
    setError("");
    try {
      const updated = await api.updateForumTopic(selectedTopic.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setSelectedTopic(updated);
      setEditingTopic(false);
      await loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить тему");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTopic() {
    if (!selectedTopic || !window.confirm("Удалить эту тему и все её ответы?")) return;

    setSaving(true);
    setError("");
    try {
      await api.deleteForumTopic(selectedTopic.id);
      setSelectedTopic(null);
      setPosts([]);
      await loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить тему");
    } finally {
      setSaving(false);
    }
  }

  async function createPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTopic || !replyText.trim()) return;

    setSaving(true);
    setError("");
    try {
      const createdPost = await api.createForumPost(selectedTopic.id, replyText.trim());
      for (const file of replyFiles) {
        await api.uploadForumAttachment("post", createdPost.id, file);
      }
      setReplyFiles([]);
      setReplyText("");
      const result = await api.getForumPosts(selectedTopic.id);
      setPosts(result.items);
      const updatedTopic = await api.getForumTopic(selectedTopic.id);
      setSelectedTopic(updatedTopic);
      await loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить ответ");
    } finally {
      setSaving(false);
    }
  }

  async function savePost(postId: number) {
    if (!editPostContent.trim()) return;

    setSaving(true);
    setError("");
    try {
      await api.updateForumPost(postId, editPostContent.trim());
      setEditingPostId(null);
      const result = await api.getForumPosts(selectedTopic!.id);
      setPosts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить ответ");
    } finally {
      setSaving(false);
    }
  }

  async function deletePost(postId: number) {
    if (!window.confirm("Удалить этот ответ?")) return;

    setSaving(true);
    setError("");
    try {
      await api.deleteForumPost(postId);
      const result = await api.getForumPosts(selectedTopic!.id);
      setPosts(result.items);
      const updatedTopic = await api.getForumTopic(selectedTopic!.id);
      setSelectedTopic(updatedTopic);
      await loadTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить ответ");
    } finally {
      setSaving(false);
    }
  }

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = userQuery.trim();

    if (!normalizedQuery) {
      setFoundUsers([]);
      setUsersSearched(false);
      setError("");
      return;
    }

    if (normalizedQuery.length < 2) {
      setFoundUsers([]);
      setUsersSearched(false);
      setError("Введите минимум 2 символа для поиска.");
      return;
    }

    setSearchLoading(true);
    setError("");

    try {
      const result = await api.search(normalizedQuery);
      setFoundUsers(result.users ?? []);
      setUsersSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить поиск");
    } finally {
      setSearchLoading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    setProfileSaving(true);
    setError("");

    try {
      const updated = await api.updateProfile({
        display_name: profile.display_name,
        bio: profile.bio,
        avatar_url: profile.avatar_url,
        status: profile.status,
      });

      setProfile(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить профиль");
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <main className="forum-shell">
      <div className="forum-content">
        <div className="forum-breadcrumb">
          <span>VIAMUCUS</span>
          <span>/</span>
          <span>{heading[page]}</span>
          {selectedTopic && <><span>/</span><span>{selectedTopic.title}</span></>}
        </div>

        {error && (
          <div className="forum-error">
            <span>{error}</span>
            <button onClick={() => setError("")}>Закрыть</button>
          </div>
        )}

        {selectedTopic ? (
          <section className="topic-detail">
            <button className="forum-back" onClick={() => {
              setSelectedTopic(null);
              setEditingTopic(false);
              setEditingPostId(null);
            }}>← Назад к темам</button>

            <div className="forum-kicker">
              {selectedTopic.category} · {selectedTopic.is_locked ? "Тема закрыта" : "Обсуждение"}
            </div>

            {editingTopic ? (
              <form className="forum-edit-form" onSubmit={saveTopic}>
                <label>Заголовок
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} minLength={5} maxLength={140} required />
                </label>
                <label>Текст публикации
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} minLength={10} maxLength={20000} rows={8} required />
                </label>
                <div className="create-actions">
                  <button type="button" className="forum-secondary" onClick={() => setEditingTopic(false)}>Отмена</button>
                  <button type="submit" className="forum-primary" disabled={saving}>Сохранить</button>
                </div>
              </form>
            ) : (
              <>
                <h1>{selectedTopic.title}</h1>
                <div className="topic-author">
                  <div className="forum-avatar">{selectedTopic.author.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{selectedTopic.author}</strong>
                    <small>{formatDate(selectedTopic.created_at)}</small>
                  </div>
                </div>
                <article className="topic-post">
                  {selectedTopic.content.split("\n").map((line, index) => (
                    <p key={index}>{line || "\u00a0"}</p>
                  ))}
                </article>
                <AttachmentList
                  attachments={selectedTopic.attachments}
                  onDownload={(id, name) => void api.downloadForumAttachment(id, name).catch((err) => setError(err.message))}
                />
                {canManageTopic && (
                  <div className="forum-manage-actions">
                    <button className="forum-secondary" onClick={startEditTopic}>Редактировать тему</button>
                    <button className="forum-danger" onClick={deleteTopic} disabled={saving}>Удалить тему</button>
                  </div>
                )}
              </>
            )}

            <div className="topic-actions">
              <span>◌ {selectedTopic.views} просмотров</span>
              <span>▤ {selectedTopic.replies} ответов</span>
            </div>

            <div className="forum-section-title">
              <h2>Обсуждение</h2>
              <span>{posts.length} ответов</span>
            </div>

            <div className="forum-post-list">
              {posts.map((post) => {
                const canManagePost = post.author_id === userId || userIsAdmin;
                return (
                  <article className="forum-post-card" key={post.id}>
                    <div className="forum-post-heading">
                      <div className="forum-avatar">{post.author.slice(0, 1).toUpperCase()}</div>
                      <div>
                        <strong>{post.display_name || post.author}</strong>
                        <small>{formatDate(post.created_at)}{post.edited_at ? " · изменено" : ""}</small>
                      </div>
                    </div>

                    {editingPostId === post.id ? (
                      <div className="forum-edit-form">
                        <textarea value={editPostContent} onChange={(e) => setEditPostContent(e.target.value)} rows={5} maxLength={10000} />
                        <div className="create-actions">
                          <button className="forum-secondary" onClick={() => setEditingPostId(null)}>Отмена</button>
                          <button className="forum-primary" onClick={() => void savePost(post.id)} disabled={saving}>Сохранить</button>
                        </div>
                      </div>
                    ) : (
                      <div className="forum-post-content">
                        {post.content.split("\n").map((line, index) => <p key={index}>{line || "\u00a0"}</p>)}
                      </div>
                    )}

                    <AttachmentList
                      attachments={post.attachments}
                      onDownload={(id, name) => void api.downloadForumAttachment(id, name).catch((err) => setError(err.message))}
                    />

                    {canManagePost && editingPostId !== post.id && (
                      <div className="forum-manage-actions">
                        <button className="forum-secondary" onClick={() => {
                          setEditingPostId(post.id);
                          setEditPostContent(post.content);
                        }}>Изменить</button>
                        <button className="forum-danger" onClick={() => void deletePost(post.id)} disabled={saving}>Удалить</button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!posts.length && <div className="forum-empty">Пока нет ответов. Начните обсуждение.</div>}
            </div>

            {!selectedTopic.is_locked ? (
              <form className="forum-reply-form" onSubmit={createPost}>
                <h3>Ваш ответ</h3>
                <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Напишите сообщение..." rows={5} maxLength={10000} required />
                <label className="forum-file-picker">
                  Прикрепить файлы (до 5, максимум 15 МБ каждый)
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.wav,.ogg,.mp4,.webm,.mov"
                    onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                  />
                  {replyFiles.length > 0 && <small>Выбрано файлов: {replyFiles.length}</small>}
                </label>
                <button className="forum-primary" type="submit" disabled={saving || !replyText.trim()}>
                  {saving ? "Отправка..." : "Отправить ответ"}
                </button>
              </form>
            ) : (
              <div className="forum-empty">Эта тема закрыта для новых ответов.</div>
            )}
          </section>
        ) : creating ? (
          <section className="create-topic">
            <button className="forum-back" onClick={() => setCreating(false)}>← Назад к темам</button>
            <div className="forum-kicker">СООБЩЕСТВО VIAMUCUS</div>
            <h1>Создать тему</h1>
            <p className="forum-subtitle">Поделитесь идеей, задайте вопрос или начните обсуждение.</p>
            <form onSubmit={createTopic}>
              <label>Заголовок темы
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Введите заголовок..." minLength={5} maxLength={140} required />
              </label>
              <label>Категория
                <select
                  value={
                    page === "news"
                      ? (categories.find((item) => item.slug === "gaming-news")?.id ?? newCategory)
                      : page === "articles"
                        ? (categories.find((item) => item.slug === "guides")?.id ?? newCategory)
                        : newCategory
                  }
                  onChange={(e) => setNewCategory(Number(e.target.value))}
                  disabled={page === "news" || page === "articles"}
                  required
                >
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>Текст публикации
                <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="О чём хотите рассказать?" rows={8} minLength={10} maxLength={20000} required />
              </label>
              <label className="forum-file-picker">
                Прикрепить файлы (до 5, максимум 15 МБ каждый)
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp3,.wav,.ogg,.mp4,.webm,.mov"
                  onChange={(e) => setNewFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                />
                {newFiles.length > 0 && <small>Выбрано файлов: {newFiles.length}</small>}
              </label>
              <div className="create-actions">
                <span>Публикация будет сохранена в базе VIAMUCUS.</span>
                <button type="submit" className="forum-primary" disabled={saving || !categories.length}>
                  {saving ? "Публикация..." : "Опубликовать тему"}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <>
            <section className="forum-hero">
              <div className="forum-hero-copy">
                <div className="forum-kicker">GAMING COMMUNITY PLATFORM</div>
                <h1>{page === "home" ? <>Место, где <span>игры</span><br />объединяют людей.</> : heading[page]}</h1>
                <p>
                  {page === "home"
                    ? "Обсуждайте игры, делитесь опытом, находите единомышленников и создавайте собственные темы."
                    : "Общайтесь, публикуйте материалы и находите интересные обсуждения сообщества."}
                </p>
                <div className="forum-hero-actions">
                  <button className="forum-primary" onClick={() => setCreating(true)}>＋ Создать тему</button>
                  <button className="forum-secondary" onClick={() => document.getElementById("forum-topics")?.scrollIntoView({ behavior: "smooth" })}>Смотреть обсуждения</button>
                </div>
              </div>
              <div className="forum-hero-art">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="hero-core">C<span>.</span></div>
                <div className="hero-floating hero-floating-one">GAMES</div>
                <div className="hero-floating hero-floating-two">COMMUNITY</div>
              </div>
            </section>

            <section className="forum-stats">
              <div><strong>{totalTopics.toLocaleString("ru-RU")}</strong><span>Обсуждений</span></div>
              <div><strong>{categories.length}</strong><span>Категорий</span></div>
              <div><strong>{topics.reduce((sum, topic) => sum + topic.replies, 0).toLocaleString("ru-RU")}</strong><span>Ответов в списке</span></div>
              <div><strong>24/7</strong><span>Активность</span></div>
            </section>

            {(page === "home" || page === "forum") && (
              <>
                <section className="forum-section" id="forum-topics">
                  <div className="forum-section-title">
                    <div>
                      <div className="forum-kicker">COMMUNITY DISCUSSIONS</div>
                      <h2>Обсуждения сообщества</h2>
                    </div>
                    <button className="forum-link" onClick={() => {
                      setSelectedCategory(null);
                      setQuery("");
                    }}>Все темы →</button>
                  </div>

                  <div className="forum-toolbar">
                    <div className="forum-search">
                      <span>⌕</span>
                      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по темам..." />
                    </div>
                    <select value={selectedCategory ?? ""} onChange={(e) => setSelectedCategory(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Все категории</option>
                      {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <button className="forum-primary" onClick={() => setCreating(true)}>＋ Новая тема</button>
                  </div>

                  <div className="forum-list-caption">
                    {selectedCategoryName} · Найдено тем: {totalTopics}
                  </div>

                  <div className="topic-list">
                    {loading && <div className="forum-empty">Загрузка...</div>}
                    {!loading && topics.map((topic) => (
                      <button className="topic-row" key={topic.id} onClick={() => void openTopic(topic.id)}>
                        <div className="topic-icon">◈</div>
                        <div className="topic-main">
                          <strong>{topic.title}</strong>
                          <span>{topic.category} <i>·</i> {topic.author} <i>·</i> {formatDate(topic.created_at)}</span>
                        </div>
                        <div className="topic-metric"><strong>{topic.replies}</strong><span>ответов</span></div>
                        <div className="topic-metric"><strong>{topic.views.toLocaleString("ru-RU")}</strong><span>просмотров</span></div>
                        {topic.is_pinned ? <span className="forum-pin">Закреплено</span> : null}
                        <span className="topic-arrow">›</span>
                      </button>
                    ))}
                    {!loading && !topics.length && <div className="forum-empty">Тем пока нет. Создайте первую публикацию.</div>}
                  </div>
                </section>

                <section className="forum-section">
                  <div className="forum-section-title">
                    <div><div className="forum-kicker">EXPLORE</div><h2>Категории форума</h2></div>
                  </div>
                  <div className="category-grid">
                    {categories.map((item) => (
                      <button className="category-card" key={item.id} onClick={() => {
                        setSelectedCategory(item.id);
                        document.getElementById("forum-topics")?.scrollIntoView({ behavior: "smooth" });
                      }}>
                        <span className="category-icon">◈</span>
                        <strong>{item.name}</strong>
                        <p>{item.description}</p>
                        <small>{item.topic_count} тем <span>→</span></small>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {(page === "news" || page === "articles") && (
              <section className="forum-section">
                <div className="forum-section-title">
                  <div>
                    <div className="forum-kicker">{page === "news" ? "LATEST UPDATES" : "EDITORIAL"}</div>
                    <h2>{page === "news" ? "Новости игровой индустрии" : "Статьи и руководства"}</h2>
                  </div>
                  <span>{totalTopics} публикаций</span>
                </div>

                <div className="topic-list">
                  {loading && <div className="forum-empty">Загрузка публикаций...</div>}

                  {!loading && topics.map((topic) => (
                    <button className="topic-row" key={topic.id} onClick={() => void openTopic(topic.id)}>
                      <div className="topic-icon">◈</div>
                      <div className="topic-main">
                        <strong>{topic.title}</strong>
                        <span>{topic.category} <i>·</i> {topic.author} <i>·</i> {formatDate(topic.created_at)}</span>
                      </div>
                      <div className="topic-metric">
                        <strong>{topic.replies}</strong>
                        <span>ответов</span>
                      </div>
                      <div className="topic-metric">
                        <strong>{topic.views.toLocaleString("ru-RU")}</strong>
                        <span>просмотров</span>
                      </div>
                      {topic.is_pinned ? <span className="forum-pin">Закреплено</span> : null}
                      <span className="topic-arrow">›</span>
                    </button>
                  ))}

                  {!loading && !topics.length && (
                    <div className="forum-empty">
                      В этой категории пока нет публикаций.
                    </div>
                  )}
                </div>
              </section>
            )}

            {page === "users" && (
              <section className="forum-section">
                <div className="forum-section-title">
                  <div>
                    <div className="forum-kicker">COMMUNITY</div>
                    <h2>Участники VIAMUCUS</h2>
                  </div>
                </div>

                <form className="directory-search" onSubmit={searchUsers}>
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Введите имя пользователя..."
                    maxLength={100}
                  />
                  <button className="forum-primary" type="submit" disabled={searchLoading}>
                    {searchLoading ? "Поиск..." : "Найти"}
                  </button>
                </form>

                {usersSearched && (
                  <div className="directory-results">
                    {foundUsers.map((user) => (
                      <article className="directory-user" key={user.id}>
                        {user.avatar_url ? (
                          <img className="forum-avatar directory-avatar" src={user.avatar_url} alt="" />
                        ) : (
                          <div className="forum-avatar">
                            {(user.display_name || user.username).slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <strong>{user.display_name || user.username}</strong>
                          <p>@{user.username}</p>
                        </div>
                      </article>
                    ))}

                    {!foundUsers.length && (
                      <div className="forum-empty">Пользователи не найдены.</div>
                    )}
                  </div>
                )}

                {!usersSearched && (
                  <div className="forum-empty">Введите имя пользователя для поиска участников.</div>
                )}
              </section>
            )}

            {page === "profile" && (
              <section className="forum-section">
                <div className="forum-section-title">
                  <div>
                    <div className="forum-kicker">YOUR ACCOUNT</div>
                    <h2>Профиль пользователя</h2>
                  </div>
                </div>

                {profileLoading && <div className="forum-empty">Загрузка профиля...</div>}

                {!profileLoading && profile && (
                  <form className="profile-editor" onSubmit={saveProfile}>
                    <div className="profile-editor-heading">
                      {profile.avatar_url ? (
                        <img className="forum-avatar profile-avatar-image" src={profile.avatar_url} alt="Аватар" />
                      ) : (
                        <div className="forum-avatar">
                          {(profile.display_name || profile.username).slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <strong>{profile.display_name || profile.username}</strong>
                        <p>@{profile.username}</p>
                        <small>{userIsAdmin ? "Администратор" : "Участник"} · ID {profile.id}</small>
                      </div>
                    </div>

                    <label>
                      Отображаемое имя
                      <input
                        value={profile.display_name}
                        maxLength={60}
                        onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                      />
                    </label>

                    <label>
                      О себе
                      <textarea
                        value={profile.bio}
                        maxLength={500}
                        rows={5}
                        onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                        placeholder="Расскажите о себе..."
                      />
                    </label>

                    <label>
                      Ссылка на аватар или изображение
                      <input
                        value={profile.avatar_url}
                        maxLength={500000}
                        onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })}
                        placeholder="https://..."
                      />
                    </label>

                    <label>
                      Статус
                      <select
                        value={profile.status}
                        onChange={(e) => setProfile({
                          ...profile,
                          status: e.target.value as Profile["status"],
                        })}
                      >
                        <option value="online">В сети</option>
                        <option value="away">Отошёл</option>
                        <option value="busy">Не беспокоить</option>
                        <option value="offline">Не в сети</option>
                      </select>
                    </label>

                    <div className="profile-editor-footer">
                      <span>{profile.email}</span>
                      <button className="forum-primary" type="submit" disabled={profileSaving}>
                        {profileSaving ? "Сохранение..." : "Сохранить профиль"}
                      </button>
                    </div>
                  </form>
                )}

                {!profileLoading && !profile && (
                  <div className="forum-empty">Не удалось загрузить профиль. Проверьте авторизацию.</div>
                )}
              </section>
            )}
          </>
        )}

        <footer className="forum-footer">
          <span>VIAMUCUS</span>
          <span>Игровое сообщество нового поколения</span>
          <span>© 2026</span>
        </footer>
      </div>
    </main>
  );
}
