import { z } from 'zod';
export const OWNER_KEY_PREFIX = 'bbx_owner_';
export const AGENT_KEY_PREFIX = 'bbx_agent_';
export const PRODUCER_KEY_PREFIX = 'bbx_producer_';
export const RECOVERY_KEY_PREFIX = 'bbx_recovery_';
export const Principal = z.object({
  principal_id: z.string().uuid(), tenant_id: z.string().uuid(), kind: z.enum(['owner', 'agent', 'producer', 'system']),
  name: z.string(), status: z.enum(['active', 'revoked', 'expired']), created_at: z.string(), expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(), last_used_at: z.string().nullable(),
});
export type Principal = z.infer<typeof Principal>;
export const SESSION_ABSOLUTE_HOURS = 8;
export const REMEMBERED_ABSOLUTE_DAYS = 30;
export const REMEMBERED_IDLE_DAYS = 7;
