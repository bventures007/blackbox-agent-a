import http from "node:http";

/** Local API transport; Node fetch can discard a caller-supplied Host header.
 * Keep authority validation at the API and send its exact public loopback Host.
 * No redirect following, remote endpoints, unbounded response or infinite wait.
 */
export function localApiRequest(
  base: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const url = new URL(base);
  const fixture =
    process.env.ALLOW_SYNTHETIC_FIXTURE === "1" && url.hostname === "api";
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (!["127.0.0.1", "localhost"].includes(url.hostname) && !fixture) ||
    !/^\/v1\/[a-zA-Z0-9_/-]+$/.test(path)
  )
    throw Error("loopback_api_required");
  const port =
    process.env.PUBLIC_PORT ?? (fixture ? "18741" : url.port || "80");
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw Error("invalid_public_port");
  if (Buffer.byteLength(options.body ?? "") > 2 * 1024 * 1024)
    throw Error("request_too_large");
  url.pathname = path;
  const signal = AbortSignal.any([
    AbortSignal.timeout(5000),
    ...(options.signal ? [options.signal] : []),
  ]);
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: options.method ?? "GET",
        headers: { ...options.headers, host: `127.0.0.1:${port}` },
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("error", reject);
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            response.destroy(Error("response_too_large"));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = response.statusCode ?? 502;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}
