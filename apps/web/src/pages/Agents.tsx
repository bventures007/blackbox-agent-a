import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { ErrorBox, PageHeading, StatusPill, When, CopyButton } from '../components/common';
interface P { principal_id: string; kind: string; name: string; status: string; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; key_id: string }
export function AgentsPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<{ principals: P[]; grant: string; bridge: { command: string; env: string[]; http_transport: string | null } } | null>(null); const [err, setErr] = useState<unknown>(null);
  const [name, setName] = useState(''); const [kind, setKind] = useState<'agent' | 'producer'>('agent'); const [expires, setExpires] = useState(''); const [secret, setSecret] = useState<string | null>(null);
  const load = () => api.get<typeof data>('/api/agents').then(setData).catch(setErr);
  useEffect(() => { void load(); }, []);
  const create = async () => { try { const r = await api.post<{ secret: string }>('/api/agents', { name, kind, expires_in_days: expires ? Number(expires) : undefined }); setSecret(r.secret); setName(''); await load(); } catch (e) { setErr(e); } };
  const revoke = async (id: string) => { try { await api.post(`/api/agents/${id}/revoke`); await load(); } catch (e) { setErr(e); } };
  const cfg = JSON.stringify({ mcpServers: { blackbox: { command: 'blackbox-mcp', env: { BLACKBOX_API_URL: location.origin, BLACKBOX_AGENT_KEY: '<paste the agent key here, never in args>' } } } }, null, 2);
  return <>
    <PageHeading title={t.agents.title} desc={t.agents.subtitle} />
    {err ? <ErrorBox error={err} /> : null}
    <div className="grid-2">
      <section className="card"><h3>{t.agents.create}</h3><p className="hint">{t.agents.grant}: {data?.grant}</p>
        <div className="form" style={{ marginTop: 10 }}><div className="row"><label>{t.agents.name}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Desktop" /></label><label>{locale === 'de' ? 'Art' : 'Kind'}<select value={kind} onChange={(e) => setKind(e.target.value as 'agent')}><option value="agent">{t.agents.kinds_agent}</option><option value="producer">{t.agents.kinds_producer}</option></select></label><label>{t.agents.expires} ({locale === 'de' ? 'Tage' : 'days'})<input type="number" min={1} max={365} value={expires} onChange={(e) => setExpires(e.target.value)} placeholder={t.agents.never} /></label></div>
          <button className="btn primary" disabled={!name} onClick={() => void create()}>{kind === 'agent' ? t.agents.create : t.agents.create_producer}</button></div>
        {secret && <div style={{ marginTop: 14 }}><div className="alert warn">{t.agents.key_shown_once}</div><div className="key-box" style={{ marginTop: 8 }}>{secret}</div><div style={{ marginTop: 8 }}><CopyButton text={secret} /> <button className="btn small ghost" onClick={() => setSecret(null)}>{t.app.close}</button></div></div>}
      </section>
      <section className="card"><h3>{t.agents.bridge_title}</h3><p className="hint">{t.agents.bridge_text}</p><ol style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 18 }}>{t.agents.bridge_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <pre className="pre">{cfg}</pre><p className="hint">{t.agents.no_owner_key} {data?.bridge.http_transport ? `HTTP: ${data.bridge.http_transport}` : ''}</p>
        <h3 style={{ marginTop: 12 }}>{t.agents.tools}</h3><div className="chips">{['describe_business_schema', 'query_business', 'get_business_state', 'list_journal_entries', 'get_journal_entry', 'get_entity_history', 'search_events', 'get_evidence', 'list_sources'].map((x) => <span key={x} className="chip mono">{x}</span>)}</div>
        <p className="hint" style={{ marginTop: 10 }}><strong>{t.agents.compat}:</strong> {t.agents.compat_note}</p>
      </section>
    </div>
    <section className="card" style={{ marginTop: 16 }}><h3>{t.agents.title}</h3><div className="table-wrap"><table className="table"><thead><tr><th>{t.agents.name}</th><th>{locale === 'de' ? 'Art' : 'Kind'}</th><th>{t.agents.status}</th><th>{t.agents.created}</th><th>{t.agents.last_used}</th><th>{t.agents.expires}</th><th></th></tr></thead>
      <tbody>{(data?.principals ?? []).map((p) => <tr key={p.principal_id}><td>{p.name}<br /><span className="mono muted" style={{ fontSize: 10 }}>{p.key_id}…</span></td><td>{p.kind}</td><td><StatusPill state={p.status === 'active' ? 'healthy' : 'unavailable'} label={p.status === 'active' ? t.agents.active : t.agents.revoked} /></td><td><When iso={p.created_at} exact /></td><td><When iso={p.last_used_at} /></td><td>{p.expires_at ? <When iso={p.expires_at} exact /> : t.agents.never}</td><td>{p.status === 'active' && <button className="btn small secondary" onClick={() => void revoke(p.principal_id)}>{t.agents.revoke}</button>}</td></tr>)}
      {data && data.principals.length === 0 && <tr><td colSpan={7} className="empty-state">{t.app.none}</td></tr>}</tbody></table></div></section>
  </>;
}
