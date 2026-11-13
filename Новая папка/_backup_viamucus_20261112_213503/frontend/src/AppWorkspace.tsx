import { useState } from "react";
import MainWindow from "./MainWindow";
import ForumShell from "./ForumShell";
import "./AppWorkspace.css";

type Props = {
  username: string;
  userId: number;
  userIsAdmin: boolean;
  onLogout: () => void;
};

type Section = "home" | "forum" | "news" | "articles" | "communities" | "users" | "profile";

const navigation: { id: Section; label: string }[] = [
  { id: "home", label: "Главная" },
  { id: "forum", label: "Форум" },
  { id: "news", label: "Новости" },
  { id: "articles", label: "Статьи" },
  { id: "communities", label: "Сообщества" },
  { id: "users", label: "Пользователи" },
];

export default function AppWorkspace(props: Props) {
  const [section, setSection] = useState<Section>("home");

  return (
    <main className="app-workspace">
      <header className="app-topbar">
        <button className="workspace-brand" onClick={() => setSection("home")} aria-label="На главную">
          <span className="workspace-brand-mark">C<span>.</span></span>
          <span>COMIND <i>SOON</i></span>
        </button>
        <nav className="workspace-navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "workspace-nav-item active" : "workspace-nav-item"}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="workspace-account">
          <button className={section === "profile" ? "workspace-user active" : "workspace-user"} onClick={() => setSection("profile")}>
            <span className="workspace-user-avatar">{props.username.slice(0, 1).toUpperCase()}</span>
            <span>{props.username}</span>
          </button>
          <button className="workspace-logout" onClick={props.onLogout} title="Выйти из аккаунта">↗</button>
        </div>
      </header>

      <div className="app-workspace-body">
        {section === "communities" ? (
          <div className="legacy-community-view">
            <MainWindow
              username={props.username}
              userId={props.userId}
              userIsAdmin={props.userIsAdmin}
              onLogout={props.onLogout}
            />
          </div>
        ) : (
          <ForumShell
            page={section}
            username={props.username}
            userId={props.userId}
            userIsAdmin={props.userIsAdmin}
          />
        )}
      </div>
    </main>
  );
}

