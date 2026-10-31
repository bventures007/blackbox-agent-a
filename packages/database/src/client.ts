import postgres, { type Sql, type TransactionSql } from 'postgres';

export type Db = Sql;
export type Tx = TransactionSql;
export type Scope = 'tenant' | 'identity' | 'engine' | 'scheduler';

export interface DbOptions { url: string; max?: number; applicationName: string }

export function createDb(opts: DbOptions): Db {
  return postgres(opts.url, {
    max: opts.max ?? 8,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    connection: { application_name: opts.applicationName },
    transform: { undefined: null },
    onnotice: () => undefined,
  });
}

/**
 * Run `fn` in a transaction whose row-level-security scope is set with SET LOCAL semantics.
 * The scope dies with the transaction, so a pooled connection can never leak tenant context (TENANT-03).
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('invalid tenant id');
  return db.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.scope', 'tenant', true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Installation-scoped transaction for identity lookups or the scheduler; never used for business reads. */
export async function withScope<T>(db: Db, scope: Exclude<Scope, 'tenant'>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', '', true), set_config('app.scope', ${scope}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}
