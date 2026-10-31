import { readFileSync } from 'node:fs';

function readSecret(fileEnv: string, inlineEnv: string, fallback?: string): string {
  const file = process.env[fileEnv]; if (file) { try { return readFileSync(file, 'utf8').trim(); } catch { /* fall through */ } }
  const inline = process.env[inlineEnv]; if (inline) return inline;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing secret: set ${fileEnv} or ${inlineEnv}`);
}

export interface ApiConfig { port: number; host: string; origin: string; databaseUrl: string; migratorUrl: string | null; engineUrl: string; engineToken: string; dataKeyPath: string; dataDir: string; logDir: string; webDist: string | null; landingDist: string | null; version: string; publicBindAllowed: false; mcpHttpEnabled: boolean }

export function loadConfig(): ApiConfig {
  const host = process.env.API_BIND_HOST ?? '127.0.0.1';
  const port = Number(process.env.API_PORT ?? 8080);
  const origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${process.env.PUBLIC_PORT ?? '19080'}`;
  // Inside the container we listen on 0.0.0.0 because Compose publishes it on loopback only; outside containers we refuse non-loopback binds.
  const inContainer = process.env.BLACKBOX_IN_CONTAINER === '1';
  if (!inContainer && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new Error(`refusing to bind to ${host}: only loopback is supported in the local pilot (LAN/public binding is unsupported)`);
  return {
    port, host: inContainer ? '0.0.0.0' : host, origin,
    databaseUrl: readSecret('API_DATABASE_URL_FILE', 'API_DATABASE_URL'), migratorUrl: process.env.MIGRATOR_DATABASE_URL_FILE || process.env.MIGRATOR_DATABASE_URL ? readSecret('MIGRATOR_DATABASE_URL_FILE', 'MIGRATOR_DATABASE_URL') : null,
    engineUrl: process.env.ENGINE_URL ?? 'http://engine:7000', engineToken: readSecret('ENGINE_TOKEN_FILE', 'ENGINE_TOKEN'),
    dataKeyPath: process.env.DATA_KEY_FILE ?? '/run/secrets/data_key', dataDir: process.env.DATA_DIR ?? '/var/blackbox/data', logDir: process.env.LOG_DIR ?? '/var/blackbox/logs',
    webDist: process.env.WEB_DIST ?? null, landingDist: process.env.LANDING_DIST ?? null, version: process.env.SERVICE_VERSION ?? '0.1.0-dev', publicBindAllowed: false, mcpHttpEnabled: process.env.MCP_HTTP_ENABLED === '1',
  };
}
