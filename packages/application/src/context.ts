import type { Db } from '@blackbox/database';
import type { Logger } from '@blackbox/logging';
import type { EngineClient } from './query/engine-client.js';
import type { DataKeyring } from './auth/crypto.js';

export interface AppContext {
  db: Db;
  log: Logger;
  engine: EngineClient;
  keyring: DataKeyring;
  version: string;
  origin: string; // exact loopback origin, e.g. http://127.0.0.1:19080
  logDir: string;
  dataDir: string;
  now: () => Date;
}
