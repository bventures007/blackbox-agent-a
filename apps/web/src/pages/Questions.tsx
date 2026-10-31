import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { ErrorBox, Json, Loading, PageHeading, StatusPill } from '../components/common';
import { Icon } from '../components/Icon';
import catalog from '../catalog.json';
type Q = (typeof catalog)[number]['questions'][number];
interface Envelope { intent: string; status: string; result: unknown; calculation: string[]; evidence_entry_ids: string[]; missing_inputs: string[]; conflicts: Array<{ code: string; detail: string }>; coverage: Array<{ capability: string; status: string; note?: string }>; required_cursor: number | null; applied_cursor: number | null; readiness: Array<{ capability: string; readiness: string; sources: Array<{ display_name: string; health: string }>; missing_source: boolean }>; pagination: { next_cursor: string | null; truncated: boolean }; timing_ms?: number }
export function QuestionsPage({ params, openEntry }: { params: URLSearchParams; openEntry: (id: string) => void }) {
  const { t, locale } = useI18n();
  const all = useMemo(() => catalog.flatMap((g) => g.questions.map((q) => ({ ...q, group: g }))), []);
  const [search, setSearch] = useState(''); const [sel, setSel] = useState<string>(params.get('intent') ?? all[0]!.intent);
  const q = all.find((x) => x.intent === sel)!;
  const [values, setValues] = useState<Record<string, string>>({}); const [answer, setAnswer] = useState<Envelope | null>(null); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [raw, setRaw] = useState(false);
  useEffect(() => { setAnswer(null); setValues({}); setErr(null); }, [sel]);
  const ask = async (cursor?: string) => { setBusy(true); setErr(null); const parameters: Record<string, unknown> = {}; for (const p of q.params as Array<{ name: string; type: string }>) if (values[p.name]) parameters[p.name] = values[p.name]; try { const a = await api.post<Envelope>('/api/query', { intent: q.intent, parameters, consistency: { mode: 'latest_committed' }, pagination: { page_size: 100, cursor } }); setAnswer(a); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const filtered = all.filter((x) => !search || x.q[locale].toLowerCase().includes(search.toLowerCase()) || x.intent.includes(search.toLowerCase()) || x.group.title[locale].toLowerCase().includes(search.toLowerCase()));
  const statusLabel = (s: string) => ({ complete: t.questions.status_complete, partial: t.questions.status_partial, insufficient_data: t.questions.status_insufficient, conflict: t.questions.status_conflict, unsupported: t.questions.status_unsupported, projection_behind: t.questions.status_behind, denied: t.questions.status_denied } as Record<string, string>)[s] ?? s;
  return <>
    <PageHeading title={t.questions.title} desc={t.questions.subtitle} />
    <div className="questions-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 20 }}>
      <aside>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.recorder.ask_placeholder} aria-label={t.questions.free_text_label} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, marginBottom: 6 }} />
        <p className="hint" style={{ marginBottom: 10 }}>{t.questions.template_search_note}</p>
        <div className="qlist" role="listbox" aria-label={t.questions.pick}>{catalog.map((g) => { const qs = filtered.filter((x) => x.group.id === g.id); if (!qs.length) return null; return <div key={g.id}><div className="eyebrow" style={{ margin: '12px 0 6px' }}>{g.number} · {g.title[locale]}</div>{qs.map((x) => <button key={x.intent} role="option" aria-selected={sel === x.intent} className={sel === x.intent ? 'active' : ''} onClick={() => setSel(x.intent)}>{x.q[locale]}</button>)}</div>; })}</div>
      </aside>
      <section className="card">
        <div className="eyebrow"><Icon name="spark" />{q.group.title[locale].toUpperCase()} · {q.ref}</div>
        <h2 style={{ fontSize: 22, letterSpacing: '-.8px', margin: '8px 0' }}>{q.q[locale]}</h2>
        <p className="muted" style={{ fontSize: 12 }}>{q.method[locale]}</p>
        <p className="hint"><strong>{locale === 'de' ? 'Benötigt' : 'Needs'}:</strong> {q.need[locale]}</p>
        <form className="form" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          {(q.params as Array<{ name: string; type: string; required?: boolean }>).length > 0 && <div className="row">{(q.params as Array<{ name: string; type: string; required?: boolean }>).map((p) => <label key={p.name}>{p.name}{p.required ? ' *' : ''}<input type={p.type === 'date' ? 'date' : 'text'} required={p.required} value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} placeholder={p.type === 'quantity' ? '100' : p.name === 'order_id' ? '#1001' : ''} /></label>)}</div>}
          <p className="hint">{t.questions.entity_hint}</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="btn primary" type="submit" disabled={busy}><Icon name="arrow" /> {t.questions.ask}</button><span className="hint">{t.questions.no_model}</span></div>
        </form>
        {busy && <Loading />}
        {err ? <ErrorBox error={err} /> : null}
        {err instanceof ApiError && err.status === 503 && <p className="hint">{t.questions.status_behind}</p>}
        {answer && <div style={{ marginTop: 18 }}>
          <div className="ans-status"><StatusPill state={answer.status} label={statusLabel(answer.status)} /><span className="hint">{t.questions.cutoff}: {t.questions.required_cursor} {answer.required_cursor ?? '—'} · {t.questions.applied_cursor} {answer.applied_cursor ?? '—'}{answer.timing_ms !== undefined ? ` · ${Math.round(answer.timing_ms)} ms` : ''}</span></div>
          {answer.missing_inputs.length > 0 && <div className="alert warn"><strong>{t.questions.missing}:</strong> {answer.missing_inputs.join(', ')}</div>}
          {answer.conflicts.length > 0 && <div className="alert bad"><strong>{t.questions.conflicts}:</strong> {answer.conflicts.map((c) => `${c.code}: ${c.detail}`).join('; ')}</div>}
          <ResultView intent={answer.intent} result={answer.result} />
          <h3 style={{ marginTop: 16 }}>{t.questions.calculation}</h3><ul style={{ fontSize: 12, lineHeight: 1.6 }}>{answer.calculation.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <h3>{t.questions.coverage}</h3><div className="chips">{answer.readiness?.map((r) => <span key={r.capability} className="chip"><StatusPill state={r.readiness} label={`${r.capability}: ${r.readiness}`} />{r.missing_source && <span className="muted">· {locale === 'de' ? 'keine Quelle' : 'no source'}</span>}</span>)}</div>
          <h3 style={{ marginTop: 16 }}>{t.questions.evidence} ({answer.evidence_entry_ids.length})</h3><div className="mini-citations" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{answer.evidence_entry_ids.slice(0, 40).map((id) => <button key={id} className="citation-btn" onClick={() => openEntry(id)}>[{id.slice(0, 8)}] <Icon name="chevron" /></button>)}{answer.evidence_entry_ids.length > 40 && <span className="muted">+{answer.evidence_entry_ids.length - 40}</span>}</div>
          {answer.pagination.next_cursor && <button className="btn secondary small" style={{ marginTop: 10 }} onClick={() => void ask(answer.pagination.next_cursor!)}>{t.questions.page_more}</button>}
          <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => setRaw(!raw)}>{raw ? t.questions.hide_json : t.questions.show_json}</button>
          {raw && <Json value={answer} />}
        </div>}
      </section>
    </div>
  </>;
}
/** Result rendering: typed tables for list results, key/value for objects; money fields render with currency, never re-computed here. */
function ResultView({ result }: { intent: string; result: unknown }) {
  const { t } = useI18n();
  if (result === null || result === undefined) return <p className="muted">{t.app.none}</p>;
  if (typeof result !== 'object') return <p>{String(result)}</p>;
  const obj = result as Record<string, unknown>;
  const lists = Object.entries(obj).filter(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
  const scalars = Object.entries(obj).filter(([, v]) => !Array.isArray(v) && (typeof v !== 'object' || v === null));
  return <div>
    {scalars.length > 0 && <dl className="kv" style={{ margin: '10px 0' }}>{scalars.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{fmt(k, v, obj)}</dd></div>)}</dl>}
    {lists.map(([k, v]) => { const rows = v as Array<Record<string, unknown>>; const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => rows.some((r) => typeof r[c] !== 'object' || r[c] === null)).slice(0, 12); return <div key={k} className="table-wrap" style={{ marginTop: 12 }}><div className="eyebrow">{k.toUpperCase()} · {rows.length}</div><table className="table"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmt(c, r[c], r)}</td>)}</tr>)}</tbody></table></div>; })}
  </div>;
}
function fmt(k: string, v: unknown, ctx: Record<string, unknown>): React.ReactNode { if (v === null || v === undefined) return <span className="muted">null</span>; if (typeof v === 'boolean') return v ? '✓' : '—'; if (typeof v === 'number' && k.endsWith('_minor')) { const cur = typeof ctx.currency === 'string' ? ctx.currency : 'EUR'; return `${new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v / 100)}`; } if (typeof v === 'object') return <span className="mono" style={{ fontSize: 10 }}>{JSON.stringify(v).slice(0, 80)}</span>; return String(v); }
