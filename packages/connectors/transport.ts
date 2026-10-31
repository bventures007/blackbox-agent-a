export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = 0,
    public reauthorization = false,
    public terminal = false,
  ) {
    super(code);
    // Do not overflow the scheduler or silently retry earlier than a provider's unusable delay.
    if (
      !Number.isFinite(retryAfterMs) ||
      retryAfterMs > 7 * 86400000 ||
      retryAfterMs < 0
    ) {
      this.code = "provider_retry_delay_out_of_range";
      this.retryAfterMs = 0;
      this.terminal = true;
    }
  }
}
export async function boundedJson(
  response: Response,
  maximum = 2 * 1024 * 1024,
) {
  if (!response.body) throw new ProviderError("provider_empty_response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new ProviderError("provider_page_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderError("provider_invalid_json");
  }
}
export function retryAfter(header: string | null, now = Date.now()) {
  if (!header) return 60000;
  const seconds = Number(header),
    duration = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - now;
  if (!Number.isFinite(duration) || duration < 0) return 60000;
  return Math.max(1000, Math.ceil(duration));
}
export async function providerRequest(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderError("provider_network_unavailable", 30000);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new ProviderError(
      "provider_rate_limited",
      retryAfter(response.headers.get("retry-after")),
    );
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new ProviderError("provider_authorization_required", 0, true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("provider_unavailable", 30000);
  }
  return boundedJson(response);
}
