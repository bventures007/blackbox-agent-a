import { recordObservation } from "./records.js";
import { z } from "zod";
import { lifecycleDetails, lifecycleKinds, quantity } from "./lifecycle.js";
export const uuid = z.uuid();
export const money = z.number().int().safe().nonnegative();
export const lifecycleObservation = z
  .object({
    id: uuid,
    entity_id: uuid,
    kind: z.enum([
      ...lifecycleKinds,
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
    quantity: quantity.optional(),
    details: lifecycleDetails.optional(),
    supersedes_entry_id: uuid.optional(),
    test: z.boolean(),
  })
  .strict()
  .superRefine((event, ctx) => {
    const required: Record<string, string[]> = {
      "inventory.snapshot": ["item_id", "location_id", "unit", "basis"],
      "inventory.reserved": ["item_id", "location_id", "unit"],
      "inventory.reservation_released": [
        "item_id",
        "location_id",
        "unit",
        "related_id",
      ],
      "shipment.dispatched": ["item_id", "location_id", "unit"],
      "shipment.delivered": ["related_id"],
      "return.received": ["item_id", "location_id", "unit", "related_id"],
      "return.restocked": ["item_id", "location_id", "unit", "related_id"],
      "invoice.credit_issued": ["related_id"],
      "invoice.payment_marked": ["related_id"],
      "bank.credit_booked": ["related_id", "booking_status"],
    };
    for (const field of required[event.kind] ?? [])
      if (!(event.details as Record<string, unknown> | undefined)?.[field])
        ctx.addIssue({
          code: "custom",
          message: "required_domain_field",
          path: ["details", field],
        });
    if (
      [
        "inventory.reserved",
        "inventory.reservation_released",
        "shipment.dispatched",
        "return.approved",
        "return.received",
        "return.restocked",
      ].includes(event.kind) &&
      !event.quantity
    )
      ctx.addIssue({
        code: "custom",
        message: "quantity_required",
        path: ["quantity"],
      });
    if (event.kind === "inventory.snapshot") {
      const fields =
        event.details?.basis === "provider_available"
          ? ["provider_available"]
          : ["physical", "quarantined", "reserved"];
      for (const field of fields)
        if (
          (event.details as Record<string, unknown> | undefined)?.[field] ===
          undefined
        )
          ctx.addIssue({
            code: "custom",
            message: "stock_basis_incomplete",
            path: ["details", field],
          });
    }
  });
export type Observation = z.infer<typeof lifecycleObservation>;
export { recordObservation } from "./records.js";
export const businessQuery = z
  .object({
    entity_id: uuid,
    recorded_cutoff: z.number().int().nonnegative().safe().optional(),
    effective_at: z.iso.datetime().optional(),
    at_least_cursor: z.number().int().nonnegative().safe().optional(),
    interpretation_version: z.enum(["lifecycle-v2", "lifecycle-v3"]).optional(),
  })
  .strict();

export const observation = z.union([lifecycleObservation, recordObservation]);
export type IngestObservation = z.infer<typeof observation>;
