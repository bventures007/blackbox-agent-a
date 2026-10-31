import { useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { Session } from '../App';
import { ErrorBox, PageHeading, CopyButton } from '../components/common';
export function SettingsPage({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const { t, locale, setLocale } = useI18n(); const [name, setName] = useState(session.workspace.name); const [cur, setCur] = useState(''); const [newKey, setNewKey] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  const save = async () => { try { await api.put('/api/settings/workspace', { name }); await api.put('/api/settings/locale', { locale }); setSaved(true); onChanged(); } catch (e) { setErr(e); } };
  const rotate = async () => { try { const r = await api.post<{ new_access_key: string }>('/api/auth/rotate-key', { current_key: cur }); setNewKey(r.new_access_key); setCur(''); } catch (e) { setErr(e); } };
  return <>
    <PageHeading title={t.settings.title} desc="" />
    {err ? <ErrorBox error={err} /> : null}
    <div className="grid-2">
      <section className="card"><h3>{t.settings.workspace}</h3><div className="form"><label>{t.settings.workspace}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label><label>{t.settings.locale}<select value={locale} onChange={(e) => setLocale(e.target.value as 'en')}><option value="en">English</option><option value="de">Deutsch</option></select></label><button className="btn primary" onClick={() => void save()}>{t.app.save}</button>{saved && <span className="hint">✓</span>}</div></section>
      <section className="card"><h3>{t.settings.security}</h3><p className="hint">{t.settings.rotate_text}</p><div className="form" style={{ marginTop: 10 }}><label>{t.settings.current_key}<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="off" /></label><button className="btn secondary" disabled={cur.length < 20} onClick={() => void rotate()}>{t.settings.rotate}</button></div>
        {newKey && <div style={{ marginTop: 12 }}><div className="alert warn">{t.settings.new_key}</div><div className="key-box" style={{ marginTop: 8 }}>{newKey}</div><CopyButton text={newKey} /><p className="hint">{t.login.security}</p></div>}
        <p className="hint" style={{ marginTop: 12 }}>{t.settings.reset_hint}</p></section>
      <section className="card"><h3>{t.settings.lifecycle}</h3><p className="hint">{t.settings.lifecycle_text}</p></section>
    </div>
  </>;
}
