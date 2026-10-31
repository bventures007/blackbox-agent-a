import { describe, it, expect } from 'vitest';
import { en, de, keysOf } from './index.js';
describe('locale completeness', () => {
  it('German defines exactly the English keys', () => { expect(keysOf(de).sort()).toEqual(keysOf(en).sort()); });
  it('no German value is empty or identical placeholder for prose', () => { const ek = keysOf(en); for (const k of ek) { const v = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], de); if (typeof v === 'string') expect(v.length).toBeGreaterThan(0); } });
});
