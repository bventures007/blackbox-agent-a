import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { Route } from '../components/Shell';
import { Icon } from '../components/Icon';
import { StatusPill, When, ErrorBox } from '../components/common';
import type { JournalEntry } from '@blackbox/contracts';
import catalog from '../catalog.json';

const TRACKS = ['source', 'fact', 'commitment', 'movement', 'reservation'] as const;
const TRACK_STYLE: Record<string, string> = { source: '--track-color:#60745c;--track-bg:#f1f4ea;--track-border:#d5deca', fact: '--track-color:#5b7b8a;--track-bg:#eef3f5;--track-border:#cfdde3', commitment: '--track-color:#8f7a3f;--track-bg:#f8f3e6;--track-border:#e4d7b8', movement: '--track-color:#a26a3a;--track-bg:#f8efe6;--track-border:#e8d2bb', reservation: '--track-color:#6f6a98;--track-bg:#f1eff8;--track-border:#d9d4ea' };

export function RecorderPage({ go, openEntry }: { go: (r: Route, p?: Record<string, string>) => void; openEntry: (id: string) => void }) {
  const { t, locale } = useI18n();
  const [counts, setCounts] = useState<{ counts: Record<string, number>; committed_cursor: number } | null>(null);
  const [recent, setRecent] = useState<JournalEntry[]>([]); const [sources, setSources] = useState<Array<{ health: string; provider: string; display_name: string }>>([]);
  const [health, setHealth] = useState<{ cards: Array<{ area: string; state: string; detail: Record<string, unknown>; observed_at: string }>; observed_at: string } | null>(null);
  const [err, setErr] = useState<unknown>(null); const [search, setSearch] = useState('');
  const load = async () => { try { const [c, r, s, h] = await Promise.all([api.get<typeof counts>('/api/journal/counts'), api.get<{ entries: JournalEntry[] }>('/api/journal/recent?limit=40'), api.get<{ connections: typeof sources }>('/api/sources'), api.get<typeof health>('/api/diagnostics/health')]); setCounts(c); setRecent(r.entries); setSources(s.connections); setHealth(h); setErr(null); } catch (e) { setErr(e); } };
  useEffect(() => { void load(); const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, []);
  const engine = health?.cards.find((c) => c.area === 'engine'); const lagEntries = Number(engine?.detail.lag_entries ?? 0); const phase = String(engine?.detail.phase ?? 'unknown');
  const total = counts ? Object.values(counts.counts).reduce((a, b) => a + b, 0) : 0;
  const suggestions = catalog.flatMap((g) => g.questions).filter((q) => !search || q.q[locale].toLowerCase().includes(search.toLowerCase()) || q.intent.includes(search.toLowerCase())).slice(0, 6);
  const now = new Date();
  return (<>
    <div className="page-heading"><div><h1>{t.recorder.title}</h1><p>{t.recorder.subtitle}</p></div><div className="heading-actions"><button className="btn primary" onClick={() => go('sources')}><Icon name="plus" /> {t.sources.connect}</button></div></div>
    {err ? <ErrorBox error={err} onRetry={() => void load()} /> : null}
    <div className="stats-grid">
      <div className="stat"><div className="stat-label">{t.recorder.sources_connected}<Icon name="plug" /></div><div className="stat-value">{sources.length}<small>{sources.filter((s) => s.health === 'current' || s.health === 'importing').length} {t.sources.current.toLowerCase()}</small></div><div className="stat-foot">{sources.length ? sources.map((s) => s.display_name).join(' · ') : t.recorder.no_sources}</div></div>
      <div className="stat"><div className="stat-label">{t.recorder.entries_recorded}<Icon name="wave" /></div><div className="stat-value">{total}<small>{t.recorder.committed_cursor} {counts?.committed_cursor ?? 0}</small></div><div className="stat-foot">{TRACKS.map((tr) => `${t.tracks[tr]} ${counts?.counts[tr] ?? 0}`).join(' · ')}</div></div>
      <div className="stat"><div className="stat-label">{t.recorder.engine_phase}<Icon name="pulse" /></div><div className="stat-value">{engine ? <StatusPill state={engine.state} label={phase} /> : '—'}</div><div className="stat-foot">{t.recorder.applied} {String(engine?.detail.applied_cursor ?? '—')} · {t.recorder.committed} {String(engine?.detail.committed_cursor ?? '—')} · {t.recorder.lag} {lagEntries}</div></div>
      <div className="stat"><div className="stat-label">{t.app.updated}<Icon name="check" /></div><div className="stat-value" style={{ fontSize: 18 }}><When iso={health?.observed_at ?? null} exact /></div><div className="stat-foot">{health && now.getTime() - new Date(health.observed_at).getTime() > 30_000 ? t.app.stale : t.app.system_ready}</div></div>
    </div>
    <section className="recorder">
      <div className="recorder-header"><div className="recorder-title"><Icon name="wave" />{t.recorder.tracks}<span className="live-label"><i className={`dot ${lagEntries === 0 ? 'pulse' : ''}`} />{lagEntries === 0 ? t.recorder.live : t.recorder.behind}</span></div><div className="recorder-tools"><span className="recording-status">{t.recorder.five_tracks.toUpperCase()}</span></div></div>
      <div id="track-rows">{TRACKS.map((tr) => { const ee = recent.filter((e) => e.record_type === tr).slice(0, 3); return <div className="track-row" key={tr} style={cssVars(TRACK_STYLE[tr]!)}><div className="track-name"><i />{t.tracks[tr]}<small>{counts?.counts[tr] ?? 0}</small></div><div className="track-lane">{ee.length === 0 ? <span className="muted" style={{ fontSize: 11 }}>{t.recorder.empty_tracks}</span> : ee.map((e) => <button key={e.entry_id} className="event-chip" onClick={() => openEntry(e.entry_id)}><span>{e.event_type} · {e.record_id}</span><time>{new Date(e.recorded_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time></button>)}</div></div>; })}</div>
      <div className="recorder-bottom"><span><Icon name="shield" />{t.recorder.original_prov.toUpperCase()}</span><button onClick={() => go('journal')}>{t.recorder.all_entries} ↗</button></div>
    </section>
    <div className="dashboard-lower">
      <section className="ask-panel"><div className="panel-head"><h2><Icon name="spark" />{t.recorder.ask_title}</h2><span className="mono muted">{t.questions.free_text_label.toUpperCase()}</span></div><p className="muted">{t.recorder.ask_intro}</p>
        <div className="question-form"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.recorder.ask_placeholder} aria-label={t.questions.free_text_label} /></div>
        <div className="question-suggestions">{suggestions.map((q) => <button key={q.ref} className="example-button" onClick={() => go('questions', { intent: q.intent })}>{q.q[locale]}</button>)}</div>
        <div className="ask-foot"><Icon name="shield" />{t.recorder.ask_note}</div></section>
      <section className="activity-panel"><div className="panel-head"><h2>{t.recorder.whats_counting}</h2><span className="mono muted">{now.toLocaleDateString(locale, { dateStyle: 'medium' })}</span></div>
        {recent.slice(0, 6).map((e) => <button key={e.entry_id} className="activity-item" onClick={() => openEntry(e.entry_id)}><span className="activity-symbol"><Icon name={e.record_type === 'movement' ? 'arrow' : e.record_type === 'commitment' ? 'check' : e.record_type === 'reservation' ? 'shield' : 'list'} /></span><div><strong>{e.event_type}</strong><br /><span className="muted">{e.record_id}{e.provider_namespace ? ` · ${e.provider_namespace}` : ''}</span></div><time>{new Date(e.recorded_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time></button>)}
        {recent.length === 0 && <p className="muted">{t.recorder.empty_tracks}</p>}</section>
    </div>
  </>);
}
function cssVars(s: string): React.CSSProperties { const o: Record<string, string> = {}; for (const part of s.split(';')) { const [k, v] = part.split(':'); if (k && v) o[k.trim()] = v.trim(); } return o as React.CSSProperties; }
