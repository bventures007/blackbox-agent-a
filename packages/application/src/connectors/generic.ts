import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Iso, SourceEventType } from '@blackbox/contracts';

/** Signed typed business-event envelope (generic producer). Bearer producer key authenticates; HMAC over the raw body binds content. */
export const GenericEnvelope = z.object({
  schema_version: z.literal(1),
  producer: z.string().min(1).max(80),
  idempotency_key: z.string().min(1).max(200),
  events: z.array(z.object({ event_id: z.string().min(1).max(200), event_type: SourceEventType, occurred_at: Iso, payload: z.record(z.unknown()), evidence_refs: z.array(z.string()).default([]), correlation_id: z.string().max(200).optional() })).max(500),
  declared_coverage: z.object({ capability: z.string(), entity_scope: z.string().default('workspace'), history_start: Iso.nullable().default(null), complete_through: Iso.nullable().default(null), backfill_complete: z.boolean().default(false), missing_fields: z.array(z.string()).default([]) }).optional(),
}).refine((e) => e.events.length > 0 || e.declared_coverage, { message: 'an envelope carries events, a coverage declaration, or both', path: ['events'] });
export type GenericEnvelope = z.infer<typeof GenericEnvelope>;

export function signBody(rawBody: string, producerSecret: string): string { return 'sha256=' + createHmac('sha256', producerSecret).update(rawBody, 'utf8').digest('hex'); }
export function verifySignature(rawBody: string, producerSecret: string, header: string | undefined): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(signBody(rawBody, producerSecret).slice(7), 'hex'); const given = Buffer.from(header.slice(7), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
