import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Icon } from '../components/Icon';
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const [key, setKey] = useState(''); const [remember, setRemember] = useState(false); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api.post('/api/auth/login', { access_key: key.trim(), remember }); setKey(''); onSignedIn(); } catch (err) { setError(err instanceof ApiError && err.status === 429 ? t.login.throttled : t.login.invalid); } finally { setBusy(false); } };
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}><span className="brand"><span className="brand-mark"><Icon name="wave" /></span>blackbox<span className="brand-dot">.</span></span><div className="topbar-lang" role="group" aria-label={t.app.language}><button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button><button className={locale === 'de' ? 'active' : ''} onClick={() => setLocale('de')}>DE</button></div></div>
        <h1 style={{ fontSize: 26, letterSpacing: '-1px', marginBottom: 10 }}>{t.login.title}</h1>
        <p className="muted" style={{ fontSize: 13 }}>{t.login.intro}</p>
        <form className="form" style={{ marginTop: 18 }} onSubmit={(e) => void submit(e)}>
          <label>{t.login.key_label}<input type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t.login.key_placeholder} required minLength={20} spellCheck={false} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 450 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{t.login.remember}</label>
          {error && <div className="alert bad" role="alert">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>{t.login.submit}</button>
        </form>
        <p className="hint" style={{ marginTop: 16 }}>{t.login.security}</p>
        <p className="hint">{t.login.lost}</p>
        <p className="hint">{t.login.setup_hint}</p>
      </div>
    </div>
  );
}
