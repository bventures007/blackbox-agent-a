/**
 * JOURNAL-01 / JOURNAL-02 / TENANT-02 / TENANT-03: database-enforced append-only behaviour, tenant RLS with the real
 * runtime roles, correction/reversal semantics and same-identity conflicts. Runs against the Compose PostgreSQL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, evidence } from '../helpers/env';

const NIL = '00000000-0000-0000-0000-000000000000';
let migrator: ReturnType<typeof sql>, api: ReturnType<typeof sql>, worker: ReturnType<typeof sql>, engine: ReturnType<typeof sql>;
let tenantA: string, tenantB: string;
const results: Record<string, unknown> = {};

async function tenantTx(db: ReturnType<typeof sql>, tenant: string, fn: (tx: ReturnType<typeof sql>) => Promise<unknown>) {
  return db.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${tenant}, true), set_config('app.scope', 'tenant', true)`; return fn(tx as unknown as ReturnType<typeof sql>); });
}
function entry(dedup: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { record_type: 'source', record_id: 'order:#1001', event_type: 'order.accepted', schema_version: 1, provider_namespace: 'test', dedup_key: dedup, occurred_at: '2026-10-31T09:00:00Z', entity_refs: [{ type: 'order', id: '#1001' }], payload, evidence_refs: [], input_entry_ids: [], ...extra };
}

beforeAll(async () => {
  migrator = sql('migrator'); api = sql('api'); worker = sql('worker'); engine = sql('engine');
  tenantA = randomUUID(); tenantB = randomUUID();
  for (const [t, name] of [[tenantA, 'Test A'], [tenantB, 'Test B']] as const) { await migrator`INSERT INTO tenants (tenant_id, name, timezone, kind) VALUES (${t}, ${name}, 'UTC', 'synthetic')`; await migrator`INSERT INTO tenant_sequences (tenant_id) VALUES (${t})`; }
});
afterAll(async () => { evidence('journal-tests.json', results); await Promise.all([migrator.end(), api.end(), worker.end(), engine.end()]); });

describe('JOURNAL-01 append-only enforcement with runtime roles', () => {
  it('runtime roles are not superusers, table owners or BYPASSRLS', async () => {
    const roles = await migrator`SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname LIKE 'bbx_%' ORDER BY rolname`;
    results.roles = roles;
    for (const r of roles) { expect(r.rolsuper).toBe(false); expect(r.rolbypassrls).toBe(false); expect(r.rolcreaterole).toBe(false); }
    const owners = await migrator`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'journal_%'`;
    for (const o of owners) expect(o.tableowner).toBe('bbx_migrator');
    const privs = await migrator`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'journal_entries' AND grantee LIKE 'bbx_%' AND grantee <> 'bbx_migrator'`;
    results.journal_privileges = privs;
    expect(privs.every((p) => p.privilege_type === 'SELECT' || p.privilege_type === 'INSERT')).toBe(true);
  });
  it('appends through journal_append with tenant scope and allocates gap-free sequences', async () => {
    const payload = { order_id: '#1001', currency: 'EUR', gross_minor: 11900, lines: [{ line_id: 'L1', item_id: 'CUP', quantity: '10', unit: 'piece', line_gross_minor: 11900 }] };
    const rows = await tenantTx(api, tenantA, (tx) => tx`SELECT * FROM journal_append(${tenantA}::uuid, ${tx.json([entry('k1', payload), entry('k2', payload)] as never)}::jsonb)`) as Array<{ journal_sequence: number; inserted: boolean }>;
    expect(rows.map((r) => Number(r.journal_sequence))).toEqual([1, 2]); expect(rows.every((r) => r.inserted)).toBe(true);
    const again = await tenantTx(api, tenantA, (tx) => tx`SELECT * FROM journal_append(${tenantA}::uuid, ${tx.json([entry('k1', payload)] as never)}::jsonb)`) as Array<{ inserted: boolean; journal_sequence: number }>;
    expect(again[0]!.inserted).toBe(false); expect(Number(again[0]!.journal_sequence)).toBe(1);
  });
  it('rejects UPDATE, DELETE and TRUNCATE for api, worker and engine roles (privilege and trigger)', async () => {
    const outcomes: Record<string, string> = {};
    for (const [name, db] of [['api', api], ['worker', worker], ['engine', engine]] as const) {
      for (const [op, run] of [
        ['update', (tx: ReturnType<typeof sql>) => tx`UPDATE journal_entries SET payload = '{}'::jsonb WHERE tenant_id = ${tenantA}::uuid`],
        ['delete', (tx: ReturnType<typeof sql>) => tx`DELETE FROM journal_entries WHERE tenant_id = ${tenantA}::uuid`],
        ['truncate', (tx: ReturnType<typeof sql>) => tx`TRUNCATE journal_entries CASCADE`],
        ['delete_links', (tx: ReturnType<typeof sql>) => tx`DELETE FROM journal_entity_links WHERE tenant_id = ${tenantA}::uuid`],
      ] as const) {
        try { await tenantTx(db, tenantA, run as never); outcomes[`${name}.${op}`] = 'ALLOWED'; } catch (e) { outcomes[`${name}.${op}`] = (e as { code?: string }).code ?? 'error'; }
      }
    }
    results.mutation_outcomes = outcomes;
    for (const v of Object.values(outcomes)) expect(v).toMatch(/^(42501|BBX01)$/); // insufficient_privilege or the append-only trigger
  });
  it('even the table owner cannot mutate committed entries (defensive trigger)', async () => {
    await expect(migrator`UPDATE journal_entries SET recorded_at = now() WHERE tenant_id = ${tenantA}::uuid`).rejects.toMatchObject({ code: 'BBX01' });
    await expect(migrator`DELETE FROM journal_entries WHERE tenant_id = ${tenantA}::uuid`).rejects.toMatchObject({ code: 'BBX01' });
    await expect(migrator`TRUNCATE journal_entries CASCADE`).rejects.toMatchObject({ code: 'BBX01' });
  });
  it('cascade paths cannot delete journal rows (tenant delete is restricted)', async () => {
    await expect(migrator`DELETE FROM tenants WHERE tenant_id = ${tenantA}::uuid`).rejects.toMatchObject({ code: '23503' });
  });
  it('runtime roles cannot escalate or alter schema', async () => {
    await expect(api`ALTER TABLE journal_entries ADD COLUMN x int`).rejects.toMatchObject({ code: '42501' });
    await expect(api`CREATE TABLE evil (x int)`).rejects.toMatchObject({ code: '42501' });
    await expect(api`SET ROLE bbx_migrator`).rejects.toMatchObject({ code: '42501' });
  });
});

describe('TENANT-02 / TENANT-03 row-level security and pool reuse', () => {
  it('no tenant context fails closed; wrong tenant sees nothing; payload tenant cannot redirect', async () => {
    const none = await api.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', '', true)`; return tx`SELECT count(*)::int AS n FROM journal_entries`; });
    expect(Number(none[0]!.n)).toBe(0);
    const asB = await tenantTx(api, tenantB, (tx) => tx`SELECT count(*)::int AS n FROM journal_entries`) as Array<{ n: number }>;
    expect(Number(asB[0]!.n)).toBe(0);
    await expect(tenantTx(api, tenantB, (tx) => tx`SELECT * FROM journal_append(${tenantA}::uuid, ${tx.json([entry('kx', { order_id: 'x', currency: 'EUR', gross_minor: 1, lines: [] })] as never)}::jsonb)`)).rejects.toMatchObject({ code: 'BBX03' });
    await expect(tenantTx(api, tenantB, (tx) => tx`INSERT INTO journal_entries (entry_id, tenant_id, journal_sequence, record_type, record_id, event_type, schema_version, dedup_key, occurred_at, recorded_at, payload, payload_hash) VALUES (gen_random_uuid(), ${tenantA}::uuid, 999, 'source', 'r', 'x', 1, 'direct', now(), now(), '{}'::jsonb, 'h')`)).rejects.toMatchObject({ code: '42501' });
  });
  it('pooled connections do not leak tenant context after success, failure and cancellation', async () => {
    const pool = sql('api');
    try {
      await tenantTx(pool, tenantA, (tx) => tx`SELECT count(*) FROM journal_entries`);
      await tenantTx(pool, tenantA, async (tx) => { await tx`SELECT count(*) FROM journal_entries`; throw new Error('rollback'); }).catch(() => undefined);
      for (let i = 0; i < 6; i++) { const r = await pool.begin(async (tx) => tx`SELECT current_setting('app.tenant_id', true) AS t, count(*)::int AS n FROM journal_entries WHERE record_type = 'source'`); expect(r[0]!.t ?? '').toBe(''); expect(Number(r[0]!.n)).toBe(0); }
      const mixed = await Promise.all([tenantA, tenantB, tenantA, tenantB].map((t) => tenantTx(pool, t, (tx) => tx`SELECT count(*)::int AS n FROM journal_entries WHERE record_type = 'source'`) as Promise<Array<{ n: number }>>)); // derived tracks are appended by the engine; the source count is what this test controls
      expect(mixed.map((m) => Number(m[0]!.n))).toEqual([2, 0, 2, 0]);
    } finally { await pool.end(); }
  });
});

describe('JOURNAL-02 corrections, conflicts and replay reproducibility', () => {
  it('same identity with different content raises a conflict and keeps the original', async () => {
    const orig = await tenantTx(api, tenantA, (tx) => tx`SELECT payload_hash FROM journal_entries WHERE dedup_key = 'k1'`) as Array<{ payload_hash: string }>;
    await expect(tenantTx(api, tenantA, (tx) => tx`SELECT * FROM journal_append(${tenantA}::uuid, ${tx.json([entry('k1', { order_id: '#1001', currency: 'EUR', gross_minor: 99, lines: [] })] as never)}::jsonb)`)).rejects.toMatchObject({ code: 'BBX02' });
    const after = await tenantTx(api, tenantA, (tx) => tx`SELECT payload_hash, payload FROM journal_entries WHERE dedup_key = 'k1'`) as Array<{ payload_hash: string; payload: { gross_minor: number } }>;
    expect(after[0]!.payload_hash).toBe(orig[0]!.payload_hash); expect(after[0]!.payload.gross_minor).toBe(11900);
  });
  it('a correction appends with supersedes link; both versions remain readable in order', async () => {
    const [first] = await tenantTx(api, tenantA, (tx) => tx`SELECT entry_id FROM journal_entries WHERE dedup_key = 'k1'`) as Array<{ entry_id: string }>;
    const corr = entry('k1-corr', { order_id: '#1001', agreed_version: 2, currency: 'EUR', gross_minor: 9520, lines: [{ line_id: 'L1', item_id: 'CUP', quantity: '8', unit: 'piece', line_gross_minor: 9520 }] }, { event_type: 'order.revised', supersedes_entry_id: first!.entry_id, occurred_at: '2026-10-31T09:05:00Z' });
    await tenantTx(api, tenantA, (tx) => tx`SELECT * FROM journal_append(${tenantA}::uuid, ${tx.json([corr] as never)}::jsonb)`);
    const rows = await tenantTx(api, tenantA, (tx) => tx`SELECT journal_sequence, event_type, supersedes_entry_id, payload->>'gross_minor' AS gross FROM journal_entries WHERE record_id = 'order:#1001' AND record_type = 'source' ORDER BY journal_sequence`) as Array<Record<string, unknown>>;
    results.correction_chain = rows;
    expect(rows.map((r) => r.event_type)).toEqual(['order.accepted', 'order.accepted', 'order.revised']);
    expect(rows[2]!.supersedes_entry_id).toBe(first!.entry_id); expect(rows[0]!.gross).toBe('11900'); expect(rows[2]!.gross).toBe('9520');
  });
  it('late commit cannot create a gap: sequences are allocated under the tenant row lock', async () => {
    // two concurrent appends: both must get distinct consecutive sequences, and the high-water mark equals max sequence
    const p1 = tenantTx(api, tenantA, (tx) => tx`SELECT journal_sequence FROM journal_append(${tenantA}::uuid, ${tx.json([entry('c1', { order_id: '#c1', currency: 'EUR', gross_minor: 1, lines: [] })] as never)}::jsonb)`);
    const p2 = tenantTx(worker, tenantA, (tx) => tx`SELECT journal_sequence FROM journal_append(${tenantA}::uuid, ${tx.json([entry('c2', { order_id: '#c2', currency: 'EUR', gross_minor: 1, lines: [] })] as never)}::jsonb)`);
    const [a, b] = (await Promise.all([p1, p2])) as Array<Array<{ journal_sequence: number }>>;
    const seqs = [Number(a[0]!.journal_sequence), Number(b[0]!.journal_sequence)].sort();
    expect(seqs[1]! - seqs[0]!).toBe(1);
    // high-water mark and max/count must be read in ONE snapshot: the engine appends derived entries concurrently
    const [inv] = await tenantTx(api, tenantA, (tx) => tx`SELECT (SELECT next_sequence - 1 FROM tenant_sequences WHERE tenant_id = ${tenantA}::uuid) AS h, max(journal_sequence) AS m, count(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantA}::uuid`) as Array<{ h: number; m: number; n: number }>;
    const hwm = inv; const mx = inv;
    expect(Number(hwm!.h)).toBe(Number(mx!.m)); expect(Number(mx!.n)).toBe(Number(mx!.m));
  });
  it('installation-scoped settings use the nil tenant and runtime roles can read them', async () => {
    const rows = await api.begin(async (tx) => { await tx`SELECT set_config('app.scope', 'scheduler', true)`; return tx`SELECT key FROM settings WHERE tenant_id = ${NIL}::uuid`; });
    expect(Array.isArray(rows)).toBe(true);
  });
});
