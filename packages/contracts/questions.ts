import { z } from "zod";
import { quantity } from "./lifecycle.js";
export const intents = [
  "inventory.available_to_sell",
  "orders.fulfillable",
  "orders.reservation_variance",
  "orders.inbound_delay_impact",
  "shipments.attention",
  "shipments.promise_risk",
  "orders.partial_delivery_gaps",
  "customer.delivery_reply",
  "invoices.outstanding",
  "orders.missing_invoice",
  "invoices.order_amount_variance",
  "invoices.dispatch_evidence",
  "orders.payment_state",
  "payments.recovered_attempts",
  "invoices.payment_variance",
  "receivables.review_queue",
  "providers.money_positions",
  "payouts.gross_to_net",
  "payouts.missing_bank_confirmation",
  "providers.holds_and_releases",
  "returns.lifecycle",
  "credits.refund_gaps",
  "cancellations.outstanding_steps",
  "refunds.chargeback_overlap",
] as const;
export const questionQuery = z
  .object({
    intent: z.enum(intents),
    entity_id: z.uuid().optional(),
    item_id: z.uuid().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    unit: z.enum(["piece", "kg", "litre", "metre"]).optional(),
    requested_quantity: quantity.optional(),
    as_of: z.iso.datetime({ offset: true }).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    effective_at: z.iso.datetime({ offset: true }).optional(),
    recorded_cutoff: z.number().int().safe().nonnegative().optional(),
    at_least_cursor: z.number().int().safe().nonnegative().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().max(4000).optional(),
  })
  .strict();
