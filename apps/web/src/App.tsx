import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useI18n } from './i18n';
import { Shell, type Route } from './components/Shell';
import { LoginPage } from './pages/Login';
import { RecorderPage } from './pages/Recorder';
import { SourcesPage } from './pages/Sources';
import { QuestionsPage } from './pages/Questions';
import { AgentsPage } from './pages/Agents';
import { JournalPage } from './pages/Journal';
import { ReviewPage } from './pages/Review';
import { DiagnosticsPage } from './pages/Diagnostics';
import { SettingsPage } from './pages/Settings';
import { EntryDrawer } from './components/EntryDrawer';

export interface Session { owner_id: string; tenant_id: string; remembered: boolean; workspace: { name: string; timezone: string; locale: 'en' | 'de' } }
const ROUTES: Route[] = ['recorder', 'sources', 'questions', 'agents', 'journal', 'review', 'diagnostics', 'settings'];
function routeFromPath(): { route: Route; params: URLSearchParams } { const seg = location.pathname.split('/')[1] as Route; const route = ROUTES.includes(seg) ? seg : 'recorder'; return { route, params: new URLSearchParams(location.search) }; }

export function App() {
  const { setLocale } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [nav, setNav] = useState(routeFromPath());
  const [drawerEntry, setDrawerEntry] = useState<string | null>(null);
  const load = useCallback(async () => { try { const s = await api.get<Session>('/api/auth/session'); setSession(s); if (!localStorage.getItem('bbx_locale')) setLocale(s.workspace.locale); } catch (err) { if (err instanceof ApiError && err.status === 401) setSession(null); else setSession(null); } }, [setLocale]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onPop = () => setNav(routeFromPath()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const go = (route: Route, params?: Record<string, string>) => { const qs = params ? '?' + new URLSearchParams(params).toString() : ''; history.pushState(null, '', `/${route}${qs}`); setNav(routeFromPath()); };
  const openEntry = (id: string) => setDrawerEntry(id);
  if (session === undefined) return <div className="login-wrap"><p className="muted">…</p></div>;
  if (session === null) return <LoginPage onSignedIn={() => void load()} />;
  const page = (() => { switch (nav.route) {
    case 'sources': return <SourcesPage session={session} go={go} params={nav.params} openEntry={openEntry} />;
    case 'questions': return <QuestionsPage params={nav.params} openEntry={openEntry} />;
    case 'agents': return <AgentsPage />;
    case 'journal': return <JournalPage params={nav.params} openEntry={openEntry} />;
    case 'review': return <ReviewPage openEntry={openEntry} />;
    case 'diagnostics': return <DiagnosticsPage params={nav.params} go={go} />;
    case 'settings': return <SettingsPage session={session} onChanged={() => void load()} />;
    default: return <RecorderPage go={go} openEntry={openEntry} />;
  } })();
  return <Shell session={session} route={nav.route} go={go} onSignedOut={() => setSession(null)}>{page}{drawerEntry && <EntryDrawer entryId={drawerEntry} onClose={() => setDrawerEntry(null)} onOpen={openEntry} />}</Shell>;
}
