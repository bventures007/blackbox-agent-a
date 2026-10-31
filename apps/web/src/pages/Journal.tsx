import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { ErrorBox, Loading, PageHeading, When } from '../components/common';
import type { JournalEntry } from '@blackbox/contracts';
interface Page { entries: JournalEntry[]; snapshot_cursor: number; next_after_sequence: number | null; newer_committed: boolean }
export function JournalPage({ params, openEntry }: { params: URLSearchParams; openEntry: (id: string) => void }) {
  const { t } = useI18n();
  const [track, setTrack] = useState(params.get('track') ?? ''); const [text, setText] = useState(params.get('text') ?? ''); const [entity] = useState<{ type: string; id: string } | null>(params.get('entity_type') && params.get('entity_id') ? { type: params.get('entity_type')!, id: params.get('entity_id')! } : null);
  const [page, setPage] = useState<Page | null>(null); const [rows, setRows] = useState<JournalEntry[]>([]); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const load = async (after?: number, snapshot?: number) => { setBusy(true); try { const p = await api.post<Page>('/api/journal/entries', { record_types: track ? [track] : undefined, text: text || undefined, entity: entity ?? undefined, after_sequence: after, snapshot_cursor: snapshot, page_size: 100 }); setPage(p); setRows((prev) => (after ? [...prev, ...p.entries] : p.entries)); setErr(null); } catch (e) { setErr(e); } finally { setBusy(false); } };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [track, entity?.type, entity?.id]);
  return <>
    <PageHeading title={entity ? `${t.journal.history}: ${entity.type} ${entity.id}` : t.journal.title} desc={t.journal.subtitle} />
    <div className="history-toolbar"><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} placeholder={t.journal.search} aria-label={t.journal.search} /><select value={track} onChange={(e) => setTrack(e.target.value)} aria-label={t.journal.track}><option value="">{t.journal.all_tracks}</option>{(['source', 'fact', 'commitment', 'movement', 'reservation'] as const).map((tr) => <option key={tr} value={tr}>{t.tracks[tr]}</option>)}</select><button className="btn small secondary" onClick={() => void load()}>{t.journal.search.split(' ')[0]}</button></div>
    {page && <p className="hint">{t.journal.snapshot}: {page.snapshot_cursor}{page.newer_committed ? ` · ${t.journal.newer}` : ''}</p>}
    {err ? <ErrorBox error={err} onRetry={() => void load()} /> : null}
    <div className="ledger-table-wrap table-wrap"><table className="ledger-table table"><thead><tr><th>{t.journal.sequence}</th><th>{t.journal.recorded}</th><th>{t.journal.occurred}</th><th>{t.journal.type}</th><th>{t.journal.record}</th><th>{t.journal.source}</th></tr></thead>
      <tbody>{rows.length === 0 && !busy ? <tr><td colSpan={6} className="empty-state">{t.journal.empty}</td></tr> : rows.map((e) => <tr key={e.entry_id} onClick={() => openEntry(e.entry_id)} style={{ cursor: 'pointer' }}><td className="mono">{e.journal_sequence}</td><td><When iso={e.recorded_at} exact /></td><td><When iso={e.occurred_at} exact /></td><td><span className={`type-tag ${e.record_type}`}>{t.tracks[`${e.record_type}_one` as 'source_one']}</span><br /><span className="mono" style={{ fontSize: 10 }}>{e.event_type}</span></td><td>{e.record_id}</td><td>{e.provider_namespace ?? '—'}</td></tr>)}</tbody></table></div>
    {busy && <Loading />}
    {page?.next_after_sequence && <button className="btn secondary" onClick={() => void load(page.next_after_sequence!, page.snapshot_cursor)}>{t.journal.load_more}</button>}
  </>;
}
