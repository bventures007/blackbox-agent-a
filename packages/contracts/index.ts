import { z } from "zod";
export const uuid = z.uuid();
export const money = z.number().int().safe().nonnegative();
export const observation = z
  .object({
    id: uuid,
    entity_id: uuid,
    kind: z.enum([
      "order.accepted",
      "order.revised",
      "payment.authorized",
      "payment.captured",
      "payment.failed",
      "payment.voided",
      "refund.completed",
      "refund.pending",
    ]),
    occurred_at: z.iso.datetime(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount_minor: money,
    economic_id: uuid,
    quantity: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,6})?$/)
      .optional(),
    supersedes_entry_id: uuid.optional(),
    test: z.boolean(),
  })
  .strict();
export type Observation = z.infer<typeof observation>;
export const businessQuery = z
  .object({
    entity_id: uuid,
    recorded_cutoff: z.number().int().nonnegative().safe().optional(),
    effective_at: z.iso.datetime().optional(),
    at_least_cursor: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
