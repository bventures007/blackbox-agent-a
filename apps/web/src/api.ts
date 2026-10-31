/** Loopback API client: cookies for the owner session, CSRF header on every request, never stores secrets. */
export class ApiError extends Error { constructor(public readonly status: number, public readonly code: string, message: string, public readonly body: unknown) { super(message); } }
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-blackbox-request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) { const b = (json ?? {}) as { error?: string; message?: string }; throw new ApiError(res.status, b.error ?? `http_${res.status}`, b.message ?? res.statusText, json); }
  return json as T;
}
export const api = { get: <T>(p: string) => call<T>('GET', p), post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}), put: <T>(p: string, b: unknown) => call<T>('PUT', p, b) };
