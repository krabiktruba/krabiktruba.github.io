import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import AppWorkspace from "./AppWorkspace";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

type User = {
  id: number;
  username: string;
  email: string;
  created_at: string;
  is_admin?: boolean | number;
};

type Mode = "login" | "register";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map((item: { msg?: string }) => item.msg || "").join(", ")
      : typeof detail === "string"
        ? detail
        : `Ошибка сервера: ${response.status}`;

    throw new Error(message || "Не удалось выполнить запрос");
  }

  return data as T;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backgroundEditorOpen, setBackgroundEditorOpen] = useState(false);
  const [bgBase, setBgBase] = useState(() => localStorage.getItem("comind_bg_base") || "#080b18");
  const [bgAccent, setBgAccent] = useState(() => localStorage.getItem("comind_bg_accent") || "#7855e8");
  const [bgGlow, setBgGlow] = useState(() => localStorage.getItem("comind_bg_glow") || "#258bcb");
  const [bgIntensity, setBgIntensity] = useState(() => Number(localStorage.getItem("comind_bg_intensity") || 55));

  useEffect(() => {
    localStorage.setItem("comind_bg_base", bgBase);
    localStorage.setItem("comind_bg_accent", bgAccent);
    localStorage.setItem("comind_bg_glow", bgGlow);
    localStorage.setItem("comind_bg_intensity", String(bgIntensity));
  }, [bgBase, bgAccent, bgGlow, bgIntensity]);


  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = localStorage.getItem("comind_access_token");

      if (!token) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      try {
        const profile = await apiRequest<User>("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!cancelled) setUser(profile);
      } catch {
        localStorage.removeItem("comind_access_token");
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const normalizedEmail = email.trim().toLowerCase();

    if (mode === "register") {
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        setError("Имя пользователя: 3–32 символа, только латинские буквы, цифры и _.");
        return;
      }

      if (password.length < 8 || password.length > 128) {
        setError("Пароль должен содержать от 8 до 128 символов.");
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "register") {
        await apiRequest<User>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: username.trim(),
            email: normalizedEmail,
            password,
          }),
        });
      }

      const tokenResponse = await apiRequest<{
        access_token: string;
        token_type: string;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });

      localStorage.setItem("comind_access_token", tokenResponse.access_token);

      const profile = await apiRequest<User>("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
        },
      });

      setUser(profile);
      setPassword("");
      setNotice("");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Не удаётся подключиться к серверу. Проверь, запущен ли backend."
          : err instanceof Error
            ? err.message
            : "Произошла ошибка.",
      );
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("comind_access_token");
    setUser(null);
    setPassword("");
    setError("");
    setNotice("Вы вышли из аккаунта.");
    setMode("login");
  }

  if (checkingSession) {
    return (
      <main className="app-shell">
        <div className="loading-card">
          <div className="brand-mark">C</div>
          <p>Подключение к COMIND…</p>
        </div>
      </main>
    );
  }

  if (user) {
    return <AppWorkspace username={user.username} userId={user.id} userIsAdmin={Boolean(user.is_admin)} onLogout={logout} />;
  }

  return (
    <main className="app-shell" style={{ background: `radial-gradient(ellipse at 78% 15%, ${bgGlow}${Math.round(bgIntensity * 2.55).toString(16).padStart(2, "0")}, transparent 60%), radial-gradient(ellipse at 18% 85%, ${bgAccent}${Math.round(bgIntensity * 2.55).toString(16).padStart(2, "0")}, transparent 65%), ${bgBase}` }}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark">C</div>
          <span>COMIND</span>
        </div>
        <div className="background-editor">
          <button
            type="button"
            className="background-editor-toggle"
            onClick={() => setBackgroundEditorOpen(value => !value)}
          >
            {backgroundEditorOpen ? "Закрыть настройки фона" : "Настроить фон"}
          </button>

          {backgroundEditorOpen && (
            <div className="background-editor-panel">
              <div className="background-editor-title">BACKGROUND STUDIO</div>

              <label className="background-color-field">
                <span>Основной оттенок</span>
                <input type="color" value={bgBase} onChange={event => setBgBase(event.target.value)} />
              </label>

              <label className="background-color-field">
                <span>Дополнительный оттенок</span>
                <input type="color" value={bgAccent} onChange={event => setBgAccent(event.target.value)} />
              </label>

              <label className="background-color-field">
                <span>Цвет свечения</span>
                <input type="color" value={bgGlow} onChange={event => setBgGlow(event.target.value)} />
              </label>

              <label className="background-intensity">
                <span>Интенсивность: {bgIntensity}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={bgIntensity}
                  onChange={event => setBgIntensity(Number(event.target.value))}
                />
              </label>

              <div className="background-presets">
                <button type="button" onClick={() => {
                  setBgBase("#080b18");
                  setBgAccent("#7855e8");
                  setBgGlow("#258bcb");
                  setBgIntensity(55);
                }}>NEXUS</button>

                <button type="button" onClick={() => {
                  setBgBase("#100817");
                  setBgAccent("#a13fba");
                  setBgGlow("#ed639e");
                  setBgIntensity(65);
                }}>NEBULA</button>

                <button type="button" onClick={() => {
                  setBgBase("#07131b");
                  setBgAccent("#087f91");
                  setBgGlow("#3988df");
                  setBgIntensity(60);
                }}>ABYSS</button>
              </div>
            </div>
          )}
        </div>

        <div className="auth-heading">
          <p className="eyebrow">ТВОЁ ИГРОВОЕ СООБЩЕСТВО</p>
          <h1>{mode === "login" ? "С возвращением" : "Создай аккаунт"}</h1>
          <p className="subtitle">
            {mode === "login" ? "Войди, чтобы продолжить." : "Присоединяйся к своему сообществу."}
          </p>
        </div>
        <div className="mode-switch">
          <button type="button" className={mode === "login" ? "mode-active" : ""} onClick={() => changeMode("login")}>
            Вход
          </button>
          <button type="button" className={mode === "register" ? "mode-active" : ""} onClick={() => changeMode("register")}>
            Регистрация
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label className="field">
              <span>Имя пользователя</span>
              <input type="text" placeholder="Например, player_01" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={32} required />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Пароль</span>
            <div className="password-wrapper">
              <input type={showPassword ? "text" : "password"} placeholder={mode === "register" ? "Минимум 8 символов" : "Введи свой пароль"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : 1} maxLength={128} required />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
          </label>
          {mode === "login" && <div className="form-extra"><span>Защищённое подключение</span></div>}
          {error && <div className="message message-error" role="alert">{error}</div>}
          {notice && <div className="message message-success">{notice}</div>}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Подожди…" : mode === "login" ? "Войти в COMIND" : "Создать аккаунт"}
          </button>
        </form>
        <p className="auth-footer">
          {mode === "login" ? "Впервые здесь? " : "Уже есть аккаунт? "}
          <button type="button" className="text-button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Создать аккаунт" : "Войти"}
          </button>
        </p>
      </section>
      <p className="app-caption">COMIND · ТВОЁ ИГРОВОЕ СООБЩЕСТВО</p>
    </main>
  );
}




