import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { ErrorBox, Json, PageHeading, StatusPill, When } from '../components/common';
interface Case { case_id: string; kind: string; state: string; revision: number; reason_code: string; stage: string; input_ref: Record<string, unknown>; affected: Record<string, unknown>; history: Array<Record<string, unknown>>; created_at: string; updated_at: string; resolution_entry_id: string | null }
export function ReviewPage({ openEntry }: { openEntry: (id: string) => void }) {
  const { t } = useI18n(); const [cases, setCases] = useState<Case[]>([]); const [err, setErr] = useState<unknown>(null); const [sel, setSel] = useState<Case | null>(null); const [reason, setReason] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get<{ cases: Case[] }>('/api/review').then((r) => { setCases(r.cases); if (sel) setSel(r.cases.find((c) => c.case_id === sel.case_id) ?? null); }).catch(setErr);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const decide = async (decision: string) => { if (!sel) return; setMsg(null); try { const r = await api.post<{ ok: boolean; required_cursor?: number; entry_ids?: string[] }>(`/api/review/${sel.case_id}/decide`, { expected_revision: sel.revision, decision, reason: reason || decision }); setMsg(`${t.review.saved_recalc} (required cursor ${r.required_cursor ?? '—'})`); setReason(''); await load(); } catch (e) { if (e instanceof ApiError && e.status === 409) { setMsg(t.review.stale); await load(); } else setErr(e); } };
  return <>
    <PageHeading title={t.review.title} desc={t.review.subtitle} />
    {err ? <ErrorBox error={err} /> : null}
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(300px, 1.2fr)' }}>
      <section className="card"><div className="table-wrap"><table className="table"><thead><tr><th>{t.review.kind}</th><th>{t.review.reason}</th><th>{t.review.stage}</th><th>{t.journal.recorded}</th><th>{t.questions.status}</th></tr></thead><tbody>{cases.length === 0 ? <tr><td colSpan={5} className="empty-state">{t.review.empty}</td></tr> : cases.map((c) => <tr key={c.case_id} onClick={() => setSel(c)} style={{ cursor: 'pointer', background: sel?.case_id === c.case_id ? '#f3f6ee' : undefined }}><td>{c.kind}</td><td className="mono" style={{ fontSize: 10 }}>{c.reason_code}</td><td>{c.stage}</td><td><When iso={c.updated_at} /></td><td><StatusPill state={c.state === 'resolved' ? 'complete' : c.state === 'in_progress' ? 'working' : 'degraded'} label={c.state === 'open' ? t.review.open : c.state === 'in_progress' ? t.review.in_progress : t.review.resolved} /></td></tr>)}</tbody></table></div></section>
      <section className="card">{!sel ? <p className="muted">{t.review.decide}</p> : <>
        <div className="eyebrow">{sel.kind.toUpperCase()} · rev {sel.revision}</div><h3>{sel.reason_code}</h3>
        <dl className="kv"><dt>{t.review.stage}</dt><dd>{sel.stage}</dd><dt>{t.review.affected}</dt><dd><Json value={sel.affected} /></dd><dt>Input</dt><dd><Json value={sel.input_ref} /></dd></dl>
        {typeof sel.input_ref.existing_entry_id === 'string' && <button className="btn small secondary" onClick={() => openEntry(sel.input_ref.existing_entry_id as string)}>{t.questions.evidence_open}</button>}
        {sel.state !== 'resolved' && <div className="form" style={{ marginTop: 14 }}><label>{t.review.reason_label}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="chips">{[['retry', t.review.retry], ['confirm_link', t.review.confirm], ['reject_link', t.review.reject], ['leave_unresolved', t.review.leave]].map(([d, l]) => <button key={d} className="btn small secondary" onClick={() => void decide(d!)}>{l}</button>)}</div></div>}
        {msg && <div className="alert info" style={{ marginTop: 10 }}>{msg}</div>}
        <h3 style={{ marginTop: 14 }}>{t.review.history}</h3><Json value={sel.history} />
        {sel.resolution_entry_id && <button className="btn small secondary" onClick={() => openEntry(sel.resolution_entry_id!)}>{t.questions.evidence_open}</button>}
      </>}</section>
    </div>
  </>;
}
