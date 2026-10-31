import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/dm-sans";
import "./style.css";
import { LocaleContext, en, de, type Locale } from "./locale.js";
import { api, setCsrf } from "./api.js";
import { Brand, Icon } from "./icons.js";
import {
  useRemote,
  useAction,
  ErrorNotice,
  DateText,
  Dialog,
  Secret,
} from "./common.js";
import { Recorder, Journal, Sources, Agents, Settings } from "./pages.js";
import { Questions } from "./questions.js";
import { System } from "./system.js";
function App() {
  const [locale, setLocale] = useState<Locale>(
      localStorage.getItem("bb_locale") === "de" ? "de" : "en",
    ),
    t = locale === "de" ? de : en;
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState("recorder"),
    [menu, setMenu] = useState(false),
    [key, setKey] = useState(""),
    [remember, setRemember] = useState(false),
    [entity, setEntity] = useState(""),
    [intent, setIntent] = useState(0),
    [connection, setConnection] = useState(""),
    [newKey, setNewKey] = useState("");
  const action = useAction();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    void api("/v1/session")
      .then((s) => {
        setCsrf(s.csrf);
        setAuthenticated(true);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  const language = () => {
    const next = locale === "en" ? "de" : "en";
    setLocale(next);
    localStorage.setItem("bb_locale", next);
  };
  const navigate = (next: string, index = 0) => {
    setPage(next);
    setIntent(index);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const titles: Record<string, [string, string]> = {
    recorder: [t.heading, t.intro],
    sources: [t.sourcesTitle, t.sourcesIntro],
    answers: [t.answerTitle, t.answerIntro],
    agents: [t.agentsTitle, t.agentsIntro],
    journal: [t.journalTitle, t.journalIntro],
    system: [t.systemTitle, t.systemIntro],
    settings: [t.settingsTitle, t.settingsIntro],
  };
  const onEntity = (id: string) => {
    setEntity(id);
    navigate("journal");
  };
  return (
    <LocaleContext value={{ locale, t }}>
      {!authenticated ? (
        <div className="login-layout">
          <header>
            <Brand />
            <button id="language" className="btn small" onClick={language}>
              {locale === "en" ? "Deutsch" : "English"}
            </button>
          </header>
          <main className="login-card">
            <span className="eyebrow">{t.pilot}</span>
            <h1>{t.loginTitle}</h1>
            <p>{t.loginIntro}</p>
            {checking ? (
              <p>{t.loading}</p>
            ) : (
              <form
                id="login"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    const s = await api("/v1/login", { key, remember });
                    setKey("");
                    setCsrf(s.csrf);
                    setAuthenticated(true);
                  });
                }}
              >
                <label htmlFor="key">{t.key}</label>
                <input
                  id="key"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  {t.remember}
                </label>
                <button
                  id="signin"
                  className="btn primary"
                  disabled={action.busy}
                >
                  {action.busy ? t.busy : t.signIn}
                  <Icon name="arrow" />
                </button>
              </form>
            )}
            <ErrorNotice code={action.error} />
            <p className="notice">{t.lostKey}</p>
          </main>
          <footer>
            {t.local} · {t.modelFree}
          </footer>
        </div>
      ) : (
        <div className="app-layout" id="workspace">
          <aside className={"sidebar " + (menu ? "open" : "")}>
            <Brand />
            <div className="workspace-switch">
              <span className="workspace-avatar">B</span>
              <span>
                {t.local}
                <small>{t.pilot}</small>
              </span>
            </div>
            <div className="sidebar-label">{t.memory}</div>
            <nav aria-label={t.memory}>
              {[
                "recorder",
                "sources",
                "answers",
                "agents",
                "journal",
                "system",
                "settings",
              ].map((x) => (
                <button
                  className={"nav-item " + (page === x ? "active" : "")}
                  aria-current={page === x ? "page" : undefined}
                  key={x}
                  onClick={() => navigate(x)}
                >
                  <Icon name={x} />
                  {t[x as keyof typeof t]}
                </button>
              ))}
            </nav>
            <div className="sidebar-note">
              <span className="dot" />
              {t.preserved}
              <p>{t.provenance}</p>
            </div>
            <button
              id="logout"
              className="nav-item"
              onClick={() =>
                void action.run(async () => {
                  await api("/v1/logout", {});
                  setCsrf("");
                  setAuthenticated(false);
                  setEntity("");
                  setPage("recorder");
                })
              }
            >
              <Icon name="logout" />
              {t.signOut}
            </button>
          </aside>
          {menu && (
            <button
              className="mobile-shade"
              aria-label={t.close}
              onClick={() => setMenu(false)}
            />
          )}
          <main className="app-main">
            <header className="app-topbar">
              <button
                className="icon-button mobile-menu"
                aria-label={t.memory}
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Icon name="menu" />
              </button>
              <div className="breadcrumb">
                {t.local}
                <span>/</span>
                <strong>{t[page as keyof typeof t]}</strong>
              </div>
              <div className="topbar-right">
                <span className="badge">{t.pilot}</span>
                <button className="language" id="language" onClick={language}>
                  {locale === "en" ? "Deutsch" : "English"}
                </button>
                <span className="user-avatar">B</span>
              </div>
            </header>
            <div className="app-content">
              <div className="page-heading">
                <div>
                  <h1>{titles[page][0]}</h1>
                  <p>{titles[page][1]}</p>
                </div>
                {page === "recorder" && (
                  <button
                    className="btn primary"
                    onClick={() => navigate("sources")}
                  >
                    <Icon name="plus" />
                    {t.connect}
                  </button>
                )}
              </div>
              <ErrorNotice code={action.error} />
              <Workspace
                page={page}
                entity={entity}
                intent={intent}
                connection={connection}
                onNavigate={navigate}
                onEntity={onEntity}
                onLogs={(id) => {
                  setConnection(id);
                  navigate("system");
                }}
                onRotated={(key) => {
                  setNewKey(key);
                  setCsrf("");
                  setAuthenticated(false);
                }}
                onExpired={() => {
                  setCsrf("");
                  setAuthenticated(false);
                }}
              />
              <footer className="app-footer">
                <span>
                  {t.local} · {t.observed_only}
                </span>
                <span>{t.provenance}</span>
              </footer>
            </div>
          </main>
        </div>
      )}
      {newKey && (
        <Dialog title={t.saveKey} onClose={() => setNewKey("")}>
          <Secret value={newKey} />
        </Dialog>
      )}
    </LocaleContext>
  );
}
function Workspace(props: {
  page: string;
  entity: string;
  intent: number;
  connection: string;
  onNavigate: (page: string, intent?: number) => void;
  onEntity: (id: string) => void;
  onLogs: (id: string) => void;
  onRotated: (key: string) => void;
  onExpired: () => void;
}) {
  const r = useRemote("/v1/overview", undefined, 5000);
  useEffect(() => {
    if (r.error === "unauthorized") props.onExpired();
  }, [r.error]);
  return (
    <>
      <ErrorNotice code={r.error} />
      {props.page === "recorder" && (
        <Recorder
          overview={r.data}
          onNavigate={props.onNavigate}
          onEntity={props.onEntity}
        />
      )}{" "}
      {props.page === "journal" && (
        <Journal
          key={props.entity}
          entity={props.entity}
          onEntity={props.onEntity}
        />
      )}{" "}
      {props.page === "answers" && (
        <Questions
          key={props.intent}
          initialEntity={props.entity}
          initialIntent={props.intent}
        />
      )}{" "}
      {props.page === "sources" && <Sources onLogs={props.onLogs} />}{" "}
      {props.page === "agents" && <Agents />}{" "}
      {props.page === "system" && (
        <System
          key={props.connection}
          connection={props.connection}
          onSource={() => props.onNavigate("sources")}
        />
      )}{" "}
      {props.page === "settings" && <Settings onRotated={props.onRotated} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
