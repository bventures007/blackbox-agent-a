import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/prototype.css';
import './styles/app.css';
import { App } from './App';
import { I18nProvider, initialLocale } from './i18n';
document.documentElement.lang = initialLocale();
createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider initial={initialLocale()}><App /></I18nProvider></StrictMode>);
