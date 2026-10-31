import { randomUUID } from 'node:crypto';
import type { Db } from '@blackbox/database';
import { generateKey } from './keys.js';

export interface SetupResult { created: boolean; tenantId: string; ownerId: string; ownerKey?: string }

/**
 * One-shot atomic owner/workspace bootstrap executed by the wrapper with the migrator connection (never over HTTP).
 * Concurrent or repeated invocations return the existing workspace without touching credentials.
 */
export async function setupWorkspace(db: Db, opts: { workspaceName: string; timezone: string; appVersion: string; schemaVersion: number; reducerVersion: string }): Promise<SetupResult> {
  return db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(730012)`;
    const [existing] = await tx`SELECT t.tenant_id, o.owner_id FROM tenants t JOIN owners o ON o.tenant_id = t.tenant_id WHERE t.kind = 'workspace' ORDER BY t.created_at LIMIT 1`;
    await tx`INSERT INTO release_info (info_id, app_version, schema_version, reducer_version) VALUES (1, ${opts.appVersion}, ${opts.schemaVersion}, ${opts.reducerVersion}) ON CONFLICT (info_id) DO UPDATE SET app_version = EXCLUDED.app_version, schema_version = EXCLUDED.schema_version, reducer_version = EXCLUDED.reducer_version, updated_at = now()`;
    if (existing) return { created: false, tenantId: existing.tenant_id as string, ownerId: existing.owner_id as string };
    const tenantId = randomUUID(); const ownerId = randomUUID(); const principalId = randomUUID(); const key = generateKey('owner');
    await tx`INSERT INTO tenants (tenant_id, name, timezone, kind) VALUES (${tenantId}, ${opts.workspaceName.slice(0, 80)}, ${opts.timezone}, 'workspace')`;
    await tx`INSERT INTO tenant_sequences (tenant_id) VALUES (${tenantId})`;
    await tx`INSERT INTO owners (owner_id, tenant_id, display_name) VALUES (${ownerId}, ${tenantId}, 'Owner')`;
    await tx`INSERT INTO principals (principal_id, tenant_id, kind, name, created_by) VALUES (${principalId}, ${tenantId}, 'owner', 'Workspace owner', ${ownerId})`;
    await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${principalId}, ${tenantId}, 'owner_login', ${key.keyId}, ${key.verifier})`;
    await tx`INSERT INTO settings (tenant_id, scope, key, value) VALUES (${tenantId}, 'workspace', 'locale', ${tx.json({ default: 'en' })}), (${tenantId}, 'workspace', 'retention', ${tx.json({ raw_evidence_days: 90 })}), (${tenantId}, 'workspace', 'backup', ${tx.json({ configured: false })})`;
    await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'host', 'wrapper', 'workspace.created', ${tx.json({ key_id: key.keyId })})`;
    return { created: true, tenantId, ownerId, ownerKey: key.secret };
  }) as Promise<SetupResult>;
}

/** Create a synthetic second tenant for isolation tests (never shown as a workspace in the UI). */
export async function createSyntheticTenant(db: Db, name: string): Promise<{ tenantId: string; ownerId: string; ownerKey: string }> {
  return db.begin(async (tx) => {
    const tenantId = randomUUID(); const ownerId = randomUUID(); const principalId = randomUUID(); const key = generateKey('owner');
    await tx`INSERT INTO tenants (tenant_id, name, timezone, kind) VALUES (${tenantId}, ${name}, 'UTC', 'synthetic')`;
    await tx`INSERT INTO tenant_sequences (tenant_id) VALUES (${tenantId})`;
    await tx`INSERT INTO owners (owner_id, tenant_id, display_name) VALUES (${ownerId}, ${tenantId}, 'Synthetic owner')`;
    await tx`INSERT INTO principals (principal_id, tenant_id, kind, name, created_by) VALUES (${principalId}, ${tenantId}, 'owner', 'Synthetic owner', ${ownerId})`;
    await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${principalId}, ${tenantId}, 'owner_login', ${key.keyId}, ${key.verifier})`;
    return { tenantId, ownerId, ownerKey: key.secret };
  }) as Promise<{ tenantId: string; ownerId: string; ownerKey: string }>;
}
