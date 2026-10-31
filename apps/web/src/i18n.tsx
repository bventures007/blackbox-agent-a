import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { resources, type Locale, type Resources } from '@blackbox/i18n';
interface Ctx { locale: Locale; t: Resources; setLocale: (l: Locale) => void }
const I18nContext = createContext<Ctx>({ locale: 'en', t: resources.en, setLocale: () => undefined });
export function I18nProvider({ children, initial }: { children: ReactNode; initial: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const value = useMemo<Ctx>(() => ({ locale, t: resources[locale], setLocale: (l) => { setLocaleState(l); try { localStorage.setItem('bbx_locale', l); } catch { /* ignore */ } document.documentElement.lang = l; } }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export const useI18n = () => useContext(I18nContext);
export function initialLocale(): Locale { try { const s = localStorage.getItem('bbx_locale'); if (s === 'de' || s === 'en') return s; } catch { /* ignore */ } return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'; }
