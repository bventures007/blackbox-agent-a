import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { Session } from '../App';
import { Icon } from './Icon';

export type Route = 'recorder' | 'sources' | 'questions' | 'agents' | 'journal' | 'review' | 'diagnostics' | 'settings';
interface Health { cards: Array<{ area: string; state: string }>; observed_at: string }

export function Shell({ session, route, go, children, onSignedOut }: { session: Session; route: Route; go: (r: Route) => void; children: ReactNode; onSignedOut: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const [menu, setMenu] = useState(false);
  const [health, setHealth] = useState<Health | null>(null); const [healthErr, setHealthErr] = useState(false);
  useEffect(() => { let alive = true; const tick = async () => { try { const h = await api.get<Health>('/api/diagnostics/health'); if (alive) { setHealth(h); setHealthErr(false); } } catch { if (alive) setHealthErr(true); } }; void tick(); const id = setInterval(tick, 15000); return () => { alive = false; clearInterval(id); }; }, []);
  const items: Array<[Route, string, string]> = [['recorder', 'wave', t.nav.recorder], ['sources', 'plug', t.nav.sources], ['questions', 'spark', t.nav.questions], ['agents', 'code', t.nav.agents], ['journal', 'list', t.nav.journal], ['review', 'alert', t.nav.review], ['diagnostics', 'pulse', t.nav.diagnostics], ['settings', 'gear', t.nav.settings]];
  const degraded = healthErr || (health?.cards.some((c) => c.state === 'degraded' || c.state === 'unavailable') ?? false);
  const stale = health ? Date.now() - new Date(health.observed_at).getTime() > 30_000 : false;
  const statusLabel = healthErr ? t.app.system_unknown : stale ? t.app.stale : degraded ? t.app.system_degraded : health ? t.app.system_ready : t.app.loading;
  const logout = async () => { try { await api.post('/api/auth/logout'); } finally { onSignedOut(); } };
  return (
    <div className="app-layout">
      <a className="skip-link" href="#app-content">Skip to content</a>
      <div className={`mobile-sidebar-overlay ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} />
      <aside className={`sidebar ${menu ? 'mobile-open' : ''}`}>
        <a href="/landing/" className="brand"><span className="brand-mark"><Icon name="wave" /></span>blackbox<span className="brand-dot">.</span></a>
        <div className="workspace-switch"><span className="workspace-avatar">{session.workspace.name.slice(0, 1).toUpperCase()}</span><div>{session.workspace.name}<small>{t.app.workspace_kind}</small></div></div>
        <div className="sidebar-label">{t.app.memory_label.toUpperCase()}</div>
        <nav className="side-nav" aria-label="Application">{items.map(([id, ic, label]) => <button key={id} className={`nav-item ${route === id ? 'active' : ''}`} aria-current={route === id ? 'page' : undefined} onClick={() => { go(id); setMenu(false); }}><Icon name={ic} />{label}</button>)}</nav>
        <div className="side-divider" />
        <div className="sidebar-note"><div className="eyebrow"><i className={`dot ${degraded ? '' : 'pulse'}`} />{t.app.tagline.toUpperCase()}</div><p>{locale === 'de' ? <>Jedes Ereignis bleibt.<br />Jede Antwort hat eine Quelle.</> : <>Every event stays.<br />Every answer has a source.</>}</p></div>
        <div className="sidebar-bottom"><a href="/landing/"><Icon name="exit" /> {t.app.to_landing}</a><button onClick={() => void logout()} aria-label={t.app.sign_out}><Icon name="exit" /> {t.app.sign_out}</button></div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="breadcrumb"><button className="icon-btn mobile-menu-btn" onClick={() => setMenu(true)} aria-label={t.app.open_menu}><Icon name="menu" /></button>{session.workspace.name}<span>/</span><strong>{items.find((i) => i[0] === route)?.[2]}</strong></div>
          <div className="topbar-right">
            <span className="demo-badge">{t.app.pilot_badge}</span>
            <span className={`status-pill ${healthErr || stale ? 'unknown' : degraded ? 'warn' : 'ok'}`} role="status"><i />{statusLabel}</span>
            <div className="topbar-lang" role="group" aria-label={t.app.language}><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>EN</button><button className={locale === 'de' ? 'active' : ''} onClick={() => setLocale('de')} aria-pressed={locale === 'de'}>DE</button></div>
          </div>
        </header>
        <main className="app-content" id="app-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
