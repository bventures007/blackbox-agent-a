// Writes JSON fixtures consumed by the Rust conformance test so both languages agree on the wire contract.
import { writeFileSync, mkdirSync } from 'node:fs';
import { SourceEventType, LOG_ALLOWED_FIELDS, IntentId, ResultStatus } from './index.js';
mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('../fixtures/contract-enums.json', import.meta.url), JSON.stringify({
  source_event_types: SourceEventType.options, intents: IntentId.options, result_statuses: ResultStatus.options, log_fields: LOG_ALLOWED_FIELDS,
}, null, 2) + '\n');
console.log('fixtures written');
