import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { app, services } = await buildApp(config);
try {
  await app.listen({ port: config.port, host: config.host });
  services.ctx.log.info('api.started', 'api listening', { action_code: 'ready' });
} catch (err) { services.ctx.log.error('api.start_failed', (err as Error).message, { error_code: 'listen_failed' }); process.exit(1); }
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { services.ctx.log.info('api.stopping', `received ${sig}`); await app.close(); process.exit(0); });
