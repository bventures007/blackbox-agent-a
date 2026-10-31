import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Json, Loading, ErrorBox, When } from './common';
import type { JournalEntry } from '@blackbox/contracts';
interface Detail { entry: JournalEntry; links: { inputs: JournalEntry[]; derived: JournalEntry[]; supersedes: JournalEntry | null; superseded_by: JournalEntry[] } }
export function EntryDrawer({ entryId, onClose, onOpen }: { entryId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { t } = useI18n(); const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { setD(null); api.get<Detail>(`/api/journal/entries/${entryId}`).then(setD).catch(setErr); }, [entryId]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const e = d?.entry;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={t.journal.entry} onClick={(ev) => ev.stopPropagation()}>
    <button className="icon-btn modal-close" onClick={onClose} aria-label={t.app.close}><Icon name="close" /></button>
    {err ? <ErrorBox error={err} /> : !e ? <Loading /> : <>
      <div className="eyebrow"><Icon name="wave" />{t.journal.entry.toUpperCase()} · {t.tracks[`${e.record_type}_one` as 'source_one'].toUpperCase()}</div>
      <h2>{e.event_type}</h2><p className="muted">{e.record_id}</p>
      <dl className="detail-meta"><div><dt>{t.journal.sequence}</dt><dd className="mono">{e.journal_sequence}</dd></div><div><dt>ID</dt><dd className="mono" style={{ fontSize: 10 }}>{e.entry_id}</dd></div><div><dt>{t.journal.occurred}</dt><dd><When iso={e.occurred_at} exact /></dd></div><div><dt>{t.journal.recorded}</dt><dd><When iso={e.recorded_at} exact /></dd></div><div><dt>{t.journal.source}</dt><dd>{e.provider_namespace ?? '—'}</dd></div><div><dt>{t.journal.rule}</dt><dd>{e.rule_version ?? '—'}</dd></div><div><dt>{t.journal.dedup}</dt><dd className="mono" style={{ fontSize: 10 }}>{e.dedup_key}</dd></div></dl>
      <div className="evidence-box"><h3>{t.journal.payload}</h3><Json value={e.payload} /></div>
      <div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.entity_refs.toUpperCase()}</div><div className="chips">{e.entity_refs.map((r) => <span key={r.type + r.id} className="chip">{r.type}: {r.id}</span>)}</div>
      {e.evidence_refs.length > 0 && <><div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.evidence_refs.toUpperCase()}</div><div className="chips">{e.evidence_refs.map((r) => <span key={r} className="chip mono">{r}</span>)}</div></>}
      {d!.links.inputs.length > 0 && <><div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.inputs.toUpperCase()}</div>{d!.links.inputs.map((x) => <button key={x.entry_id} className="detail-link" onClick={() => onOpen(x.entry_id)}><span><span className="mono muted">#{x.journal_sequence} {x.record_type}</span><br />{x.event_type} · {x.record_id}</span><Icon name="arrow" /></button>)}</>}
      {d!.links.derived.length > 0 && <><div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.derived.toUpperCase()}</div>{d!.links.derived.map((x) => <button key={x.entry_id} className="detail-link" onClick={() => onOpen(x.entry_id)}><span><span className="mono muted">#{x.journal_sequence} {x.record_type}</span><br />{x.event_type} · {x.record_id}</span><Icon name="arrow" /></button>)}</>}
      {d!.links.supersedes && <><div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.supersedes.toUpperCase()}</div><button className="detail-link" onClick={() => onOpen(d!.links.supersedes!.entry_id)}><span>#{d!.links.supersedes.journal_sequence} {d!.links.supersedes.event_type}</span><Icon name="arrow" /></button></>}
      {d!.links.superseded_by.length > 0 && <><div className="eyebrow" style={{ fontSize: 9, margin: '18px 0 7px' }}>{t.journal.superseded_by.toUpperCase()}</div>{d!.links.superseded_by.map((x) => <button key={x.entry_id} className="detail-link" onClick={() => onOpen(x.entry_id)}><span>#{x.journal_sequence} {x.event_type}</span><Icon name="arrow" /></button>)}</>}
      {e.provider_namespace?.startsWith('replay') && <div className="demo-callout">{t.app.synthetic_badge}</div>}
    </>}
  </aside></div>;
}
