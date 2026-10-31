export interface EngineQuery { tenant_id: string; intent: string; parameters: Record<string, unknown>; required_cursor: number | null; deadline_ms: number; page_size: number; cursor?: string; now?: string; principal?: string }
export interface EngineStateRequest { tenant_id: string; entity_type: string; entity_id: string; required_cursor: number | null; deadline_ms: number; recorded_cutoff?: number; effective_at?: string }

export class EngineUnavailable extends Error { constructor(message: string) { super(message); this.name = 'EngineUnavailable'; } }

/** Thin authenticated HTTP client for the internal Rust engine (never exposed to browsers or agents). */
export class EngineClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private async call<T>(path: string, method: 'GET' | 'POST', body?: unknown, timeoutMs = 5000): Promise<T> {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, { method, headers: { 'x-engine-token': this.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) throw new EngineUnavailable(`engine ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof EngineUnavailable) throw err;
      throw new EngineUnavailable(`engine ${path} unreachable: ${(err as Error).message}`);
    } finally { clearTimeout(t); }
  }
  health() { return this.call<Record<string, unknown>>('/health', 'GET', undefined, 2500); }
  metrics() { return this.call<Record<string, unknown>>('/metrics', 'GET', undefined, 2500); }
  tenantStatus(tenantId: string) { return this.call<Record<string, unknown>>(`/tenants/${tenantId}/status`, 'GET', undefined, 2500); }
  query(q: EngineQuery) { return this.call<Record<string, unknown>>('/query', 'POST', q, q.deadline_ms + 5000); }
  state(s: EngineStateRequest) { return this.call<Record<string, unknown>>('/state', 'POST', s, s.deadline_ms + 5000); }
  evict(tenantId: string, entityType?: string, entityId?: string, all = false) { return this.call<Record<string, unknown>>('/admin/evict', 'POST', { tenant_id: tenantId, entity_type: entityType, entity_id: entityId, all }); }
  rebuild(tenantId: string) { return this.call<Record<string, unknown>>('/admin/rebuild', 'POST', { tenant_id: tenantId }); }
  snapshot(tenantId: string) { return this.call<Record<string, unknown>>('/admin/snapshot', 'POST', { tenant_id: tenantId }, 30000); }
  debug(minutes: number) { return this.call<Record<string, unknown>>('/admin/debug', 'POST', { minutes }); }
  refreshTenants() { return this.call<Record<string, unknown>>('/admin/refresh-tenants', 'POST', {}); }
}
