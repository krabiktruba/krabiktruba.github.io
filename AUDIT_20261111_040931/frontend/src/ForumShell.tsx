import { useMemo, useState } from "react";
import "./ForumShell.css";

type Page = "home" | "forum" | "news" | "articles" | "users" | "profile";

type Topic = {
  id: number;
  category: string;
  title: string;
  author: string;
  replies: number;
  views: number;
  time: string;
  tag: string;
};

type Props = {
  page: Page;
  username: string;
};

const initialTopics: Topic[] = [
  { id: 1, category: "Игры", title: "Во что сейчас стоит играть в одиночку?", author: "NightWalker", replies: 28, views: 1240, time: "12 минут назад", tag: "Обсуждение" },
  { id: 2, category: "Технологии", title: "Какие видеокарты будут актуальны в ближайшие годы?", author: "PixelCore", replies: 16, views: 870, time: "35 минут назад", tag: "Hardware" },
  { id: 3, category: "Разработка", title: "Делимся опытом создания собственных игровых проектов", author: "DevRaven", replies: 42, views: 2310, time: "1 час назад", tag: "Разработка" },
  { id: 4, category: "Игры", title: "Ваши самые ожидаемые RPG-проекты", author: "Artemis", replies: 63, views: 4120, time: "2 часа назад", tag: "RPG" },
  { id: 5, category: "Сообщество", title: "Знакомимся: расскажите о себе и своих интересах", author: "COMIND", replies: 91, views: 5600, time: "Сегодня", tag: "Знакомство" },
];

const categories = [
  { name: "Игры", description: "Обсуждения, обзоры и игровые впечатления", icon: "◈", topics: 128 },
  { name: "Новости игровой индустрии", description: "События, анонсы и обновления", icon: "◉", topics: 86 },
  { name: "Технологии", description: "Железо, программное обеспечение и устройства", icon: "⌘", topics: 54 },
  { name: "Разработка", description: "Создание игр, движки и программирование", icon: "⌁", topics: 39 },
  { name: "Гайды и помощь", description: "Советы, инструкции и решение проблем", icon: "◇", topics: 72 },
  { name: "Сообщество", description: "Общение, вопросы и свободные темы", icon: "◎", topics: 103 },
];

export default function ForumShell({ page, username }: Props) {
  const [topics, setTopics] = useState(initialTopics);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Все");
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("Игры");
  const [newText, setNewText] = useState("");

  const filteredTopics = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return topics.filter((topic) => {
      const matchesQuery = !normalized ||
        `${topic.title} ${topic.category} ${topic.author}`.toLowerCase().includes(normalized);
      const matchesCategory = selectedCategory === "Все" || topic.category === selectedCategory;
      return matchesQuery && matchesCategory;
    });
  }, [topics, query, selectedCategory]);

  function createTopic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim() || !newText.trim()) return;

    const topic: Topic = {
      id: Date.now(),
      category: newCategory,
      title: newTitle.trim(),
      author: username,
      replies: 0,
      views: 1,
      time: "Только что",
      tag: "Новая тема",
    };

    setTopics((current) => [topic, ...current]);
    setSelectedTopic(topic);
    setNewTitle("");
    setNewText("");
    setCreating(false);
  }

  const heading: Record<Page, string> = {
    home: "Главная",
    forum: "Форум",
    news: "Новости",
    articles: "Статьи",
    users: "Пользователи",
    profile: "Мой профиль",
  };

  return (
    <main className="forum-shell">
      <div className="forum-content">
        <div className="forum-breadcrumb">
          <span>COMIND SOON</span><span>/</span><span>{heading[page]}</span>
          {selectedTopic && <><span>/</span><span>{selectedTopic.title}</span></>}
        </div>

        {selectedTopic ? (
          <section className="topic-detail">
            <button className="forum-back" onClick={() => setSelectedTopic(null)}>← Назад к темам</button>
            <div className="forum-kicker">{selectedTopic.category} · {selectedTopic.tag}</div>
            <h1>{selectedTopic.title}</h1>
            <div className="topic-author">
              <div className="forum-avatar">{selectedTopic.author.slice(0, 1).toUpperCase()}</div>
              <div><strong>{selectedTopic.author}</strong><small>{selectedTopic.time}</small></div>
            </div>
            <article className="topic-post">
              <p>Это демонстрационная страница темы форума COMIND SOON.</p>
              <p>Здесь будет находиться основное содержание публикации, обсуждение, ответы пользователей, реакции и вложения.</p>
              <p className="demo-note">Пока отображается пример интерфейса. Подключение хранения публикаций будет следующим этапом.</p>
            </article>
            <div className="topic-actions">
              <span>◌ {selectedTopic.views} просмотров</span>
              <span>▤ {selectedTopic.replies} ответов</span>
              <button onClick={() => alert("Форма ответа будет подключена на следующем этапе.")}>Ответить</button>
            </div>
            <div className="forum-section-title"><h2>Обсуждение</h2><span>Комментарии появятся после подключения API</span></div>
          </section>
        ) : creating ? (
          <section className="create-topic">
            <button className="forum-back" onClick={() => setCreating(false)}>← Назад</button>
            <div className="forum-kicker">СООБЩЕСТВО COMIND</div>
            <h1>Создать тему</h1>
            <p className="forum-subtitle">Поделитесь идеей, задайте вопрос или начните обсуждение.</p>
            <form onSubmit={createTopic}>
              <label>Заголовок темы
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Введите заголовок..." maxLength={140} required />
              </label>
              <label>Категория
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                  {categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                </select>
              </label>
              <label>Текст публикации
                <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="О чём хотите рассказать?" rows={8} required />
              </label>
              <div className="create-actions">
                <span>Сейчас публикация сохраняется только в памяти страницы.</span>
                <button type="submit" className="forum-primary">Опубликовать тему</button>
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
                <div className="orbit orbit-one" /><div className="orbit orbit-two" />
                <div className="hero-core">C<span>.</span></div>
                <div className="hero-floating hero-floating-one">GAMES</div>
                <div className="hero-floating hero-floating-two">COMMUNITY</div>
              </div>
            </section>

            <section className="forum-stats">
              <div><strong>1.2K</strong><span>Участников</span></div>
              <div><strong>482</strong><span>Обсуждения</span></div>
              <div><strong>36</strong><span>Сейчас онлайн</span></div>
              <div><strong>24/7</strong><span>Активность</span></div>
            </section>

            {(page === "home" || page === "forum") && (
              <section className="forum-section" id="forum-topics">
                <div className="forum-section-title">
                  <div><div className="forum-kicker">COMMUNITY DISCUSSIONS</div><h2>Популярные обсуждения</h2></div>
                  <button className="forum-link" onClick={() => setSelectedCategory("Все")}>Все темы →</button>
                </div>
                <div className="forum-toolbar">
                  <div className="forum-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по темам..." /></div>
                  <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                    <option>Все</option>{categories.map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                  <button className="forum-primary" onClick={() => setCreating(true)}>＋ Новая тема</button>
                </div>
                <div className="topic-list">
                  {filteredTopics.map((topic) => (
                    <button className="topic-row" key={topic.id} onClick={() => setSelectedTopic(topic)}>
                      <div className="topic-icon">◈</div>
                      <div className="topic-main">
                        <strong>{topic.title}</strong>
                        <span>{topic.category} <i>·</i> {topic.author} <i>·</i> {topic.time}</span>
                      </div>
                      <div className="topic-metric"><strong>{topic.replies}</strong><span>ответов</span></div>
                      <div className="topic-metric"><strong>{topic.views.toLocaleString("ru-RU")}</strong><span>просмотров</span></div>
                      <span className="topic-arrow">›</span>
                    </button>
                  ))}
                  {!filteredTopics.length && <div className="forum-empty">По вашему запросу тем не найдено.</div>}
                </div>
              </section>
            )}

            {(page === "home" || page === "forum") && (
              <section className="forum-section">
                <div className="forum-section-title"><div><div className="forum-kicker">EXPLORE</div><h2>Категории форума</h2></div></div>
                <div className="category-grid">
                  {categories.map((item) => (
                    <button className="category-card" key={item.name} onClick={() => { setSelectedCategory(item.name); document.getElementById("forum-topics")?.scrollIntoView({ behavior: "smooth" }); }}>
                      <span className="category-icon">{item.icon}</span>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                      <small>{item.topics} тем <span>→</span></small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {page === "news" && <section className="forum-section"><div className="forum-section-title"><div><div className="forum-kicker">LATEST UPDATES</div><h2>Новости игровой индустрии</h2></div></div><div className="editorial-grid"><article><div className="editorial-art art-one">GAME<br />NEWS</div><h3>Новости, анонсы и события игровой индустрии</h3><p>Здесь будет лента новостей с датами, источниками и категориями.</p></article><article><div className="editorial-art art-two">UPDATE</div><h3>Обновления и патчи любимых игр</h3><p>Отдельная подборка обновлений и изменений игровых проектов.</p></article></div></section>}

            {page === "articles" && <section className="forum-section"><div className="forum-section-title"><div><div className="forum-kicker">EDITORIAL</div><h2>Статьи и материалы</h2></div></div><div className="editorial-grid"><article><div className="editorial-art art-three">INSIGHT</div><h3>Большие материалы и аналитика</h3><p>Обзоры, мнения, исследования и авторские публикации.</p></article><article><div className="editorial-art art-four">GUIDES</div><h3>Руководства и полезные инструкции</h3><p>Практические материалы от участников сообщества.</p></article></div></section>}

            {page === "users" && <section className="forum-section"><div className="forum-section-title"><div><div className="forum-kicker">COMMUNITY</div><h2>Участники COMIND</h2></div></div><div className="profile-placeholder"><div className="forum-avatar">{username.slice(0, 1).toUpperCase()}</div><div><strong>{username}</strong><p>Пользователь сообщества</p></div><span>Профили участников будут подключены к API.</span></div></section>}

            {page === "profile" && <section className="forum-section"><div className="forum-section-title"><div><div className="forum-kicker">YOUR ACCOUNT</div><h2>Профиль пользователя</h2></div></div><div className="profile-placeholder"><div className="forum-avatar">{username.slice(0, 1).toUpperCase()}</div><div><strong>{username}</strong><p>Ваш профиль COMIND SOON</p></div><span>Настройки профиля и публикации будут подключены на следующем этапе.</span></div></section>}
          </>
        )}
        <footer className="forum-footer"><span>COMIND SOON</span><span>Игровое сообщество нового поколения</span><span>© 2026</span></footer>
      </div>
    </main>
  );
}
