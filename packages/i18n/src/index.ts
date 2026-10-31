import { en, type Resources } from './en.js';
import { de } from './de.js';
export type Locale = 'en' | 'de';
export const resources: Record<Locale, Resources> = { en, de };
export type { Resources };
export { en, de };
/** Deep key list used to verify that every locale defines exactly the same keys. */
export function keysOf(obj: unknown, prefix = ''): string[] { if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [prefix]; return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)); }
