import { z } from "zod";
import { quantity } from "./lifecycle.js";
import { coverageFieldCode, coverageLimitationCode } from "./coverage-codes.js";
const id = z.uuid(),
  money = z.number().int().safe().nonnegative(),
  signed = z.number().int().safe();
const time = z.iso.datetime({ offset: true }),
  date = z.iso.date(),
  currency = z.string().regex(/^[A-Z]{3}$/);
const unit = z.enum(["piece", "kg", "litre", "metre"]),
  timezone = z
    .string()
    .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "invalid_timezone");
export const datasets = [
  "orders",
  "stock",
  "allocations",
  "supply",
  "promises",
  "fulfillments",
  "tracking",
  "communications",
  "invoices",
  "invoice_dispatch",
  "payments",
  "payment_allocations",
  "policy",
  "cases",
  "provider_ledger",
  "positions",
  "payouts",
  "bank",
  "holds",
  "returns",
  "receipts",
  "entitlements",
  "refunds",
  "disputes",
  "coverage",
  "identity",
] as const;
const line = z
  .object({
    line_id: id,
    item_id: id,
    location_id: id.optional(),
    quantity,
    cancelled_quantity: quantity,
    unit,
    line_gross_minor: money,
  })
  .strict();
const shippedLine = z.object({ line_id: id, quantity, unit }).strict();
const record = <D extends (typeof datasets)[number], T extends z.ZodRawShape>(
  dataset: D,
  fields: T,
) => z.object({ dataset: z.literal(dataset), ...fields }).strict();
export const datasetRecord = z.discriminatedUnion("dataset", [
  record("orders", {
    customer_id: id.optional(),
    status: z.enum(["open", "closed", "cancelled"]),
    currency,
    gross_minor: money,
    created_at: time,
    lines: z.array(line).max(500),
  }),
  record("stock", {
    item_id: id,
    location_id: id,
    unit,
    basis: z.enum(["provider_available", "disjoint_physical"]).optional(),
    physical: quantity.optional(),
    available: quantity.optional(),
    committed: quantity.optional(),
    reserved: quantity.optional(),
    damaged: quantity.optional(),
    safety_stock: quantity.optional(),
    quality_control: quantity.optional(),
    incoming: quantity.optional(),
    snapshot_id: id.optional(),
  }),
  record("allocations", {
    order_id: id,
    line_id: id,
    item_id: id,
    location_id: id,
    quantity,
    unit,
    status: z.enum(["active", "released"]),
    supply_id: id.optional(),
    basis: z.enum(["observed_reservation", "derived_plan"]),
    snapshot_scope: id.optional(),
    policy_id: id.optional(),
  }),
  record("supply", {
    item_id: id,
    location_id: id,
    quantity,
    unit,
    promised_at: time,
    previous_promised_at: time.optional(),
    timezone,
  }),
  record("promises", {
    order_id: id,
    line_id: id.optional(),
    promised_at: time,
    timezone,
    promise_kind: z.enum([
      "customer_delivery",
      "fulfill_by",
      "carrier_estimate",
    ]),
  }),
  record("fulfillments", {
    order_id: id,
    state: z.enum([
      "label",
      "prepared",
      "failed",
      "handed_over",
      "delivered",
      "cancelled",
    ]),
    administrative_status: z
      .enum(["success", "cancelled", "error", "failure"])
      .optional(),
    lines: z.array(shippedLine).max(500),
    location_id: id.optional(),
    handover_at: time.optional(),
    delivered_at: time.optional(),
  }),
  record("tracking", {
    shipment_id: id,
    status: z.enum([
      "label",
      "in_transit",
      "exception",
      "delivered",
      "unknown",
    ]),
    scan_at: time,
    forecast_at: time.nullable(),
    carrier_service_id: id,
  }),
  record("communications", {
    order_id: id,
    customer_id: id.optional(),
    sent_at: time,
    actor: z.enum(["owner", "customer", "service"]),
    reviewed_commitment_ids: z.array(id).max(100),
  }),
  record("invoices", {
    order_id: id.optional(),
    invoice_id: id.optional(),
    kind: z.enum(["invoice", "credit"]),
    state: z.enum(["draft", "final", "cancelled"]),
    currency,
    gross_minor: money,
    reported_paid_minor: money.optional(),
    due_date: date.optional(),
    lines: z
      .array(
        z
          .object({ line_id: id, quantity, unit, covered_gross_minor: money })
          .strict(),
      )
      .max(500)
      .optional(),
  }),
  record("invoice_dispatch", {
    invoice_id: id,
    channel: z.enum(["email", "post", "other"]),
    status: z.enum(["sent", "failed", "pending"]),
    processed_at: time,
    source_scope: z.enum(["provider", "reviewed_external"]),
  }),
  record("payments", {
    order_id: id,
    account_id: id,
    original_transaction_id: id.optional(),
    status: z.enum(["authorized", "captured", "failed", "voided"]),
    amount_minor: money,
    currency,
    economic_effect_id: id,
  }),
  record("payment_allocations", {
    invoice_id: id,
    transaction_id: id,
    amount_minor: money,
    currency,
    confidence: z.enum(["verified", "ambiguous", "rejected"]),
  }),
  record("policy", {
    rule_kind: z.enum(["priority", "invoicing", "attention", "reminder"]),
    version: z.number().int().positive(),
    effective_from: time,
    timezone,
    priority_method: z.enum(["created_at_fifo", "explicit_order"]).optional(),
    priority_order: z.array(id).max(500).optional(),
    invoicing_trigger: z
      .enum(["after_confirmed_dispatch", "order_accepted"])
      .optional(),
    exceptions_require_attention: z.boolean().optional(),
    stale_after_seconds: z.number().int().positive().optional(),
    reminder_policy: z.enum(["review_overdue"]).optional(),
    tolerance_minor: money.optional(),
    currency: currency.optional(),
  }),
  record("cases", {
    invoice_id: id,
    order_id: id.optional(),
    status: z.enum(["open", "disputed", "closed"]),
    agreed_extension_until: date.optional(),
  }),
  record("provider_ledger", {
    account_id: id,
    transaction_id: id.optional(),
    payout_id: id.optional(),
    posting_type: z.enum(["capture", "fee", "refund", "adjustment", "opening"]),
    gross_minor: signed,
    fee_minor: money,
    net_minor: signed,
    currency,
  }),
  record("positions", {
    account_id: id,
    currency,
    total_minor: signed,
    processing_minor: signed.optional(),
    available_minor: signed.optional(),
    held_minor: signed.optional(),
  }),
  record("payouts", {
    account_id: id,
    bank_account_id: id.optional(),
    status: z.enum(["announced", "sent", "failed", "reversed"]),
    direction: z.enum(["deposit", "withdrawal"]),
    amount_minor: money,
    currency,
    issued_at: time,
    trace_reference: id.optional(),
  }),
  record("bank", {
    account_id: id,
    statement_id: id,
    booking_status: z.enum(["booked", "pending"]),
    booked_at: time,
    value_at: time,
    amount_minor: signed,
    currency,
    reference: id,
    payout_id: id.optional(),
    match_confidence: z.enum([
      "verified",
      "ambiguous",
      "unmatched",
      "rejected",
    ]),
  }),
  record("holds", {
    account_id: id,
    transaction_id: id.optional(),
    currency,
    amount_minor: money,
    released_minor: money,
    state: z.enum(["active", "released"]),
    release_promised_at: time.nullable(),
    released_at: time.nullable(),
    reason: z.enum(["reserve", "dispute", "refund", "other", "unknown"]),
  }),
  record("returns", {
    order_id: id,
    line_id: id,
    quantity,
    unit,
    state: z.enum(["requested", "approved", "cancelled"]),
  }),
  record("receipts", {
    return_id: id,
    line_id: id,
    location_id: id,
    quantity,
    unit,
    disposition: z.enum(["quarantined", "restocked", "missing"]),
  }),
  record("entitlements", {
    order_id: id,
    invoice_id: id.optional(),
    credit_id: id,
    original_transaction_id: id,
    amount_minor: money,
    currency,
    destination: z.enum(["cash", "store_credit"]),
    state: z.enum(["approved", "cancelled"]),
    approved_at: time,
  }),
  record("refunds", {
    order_id: id,
    original_transaction_id: id,
    return_id: id.optional(),
    amount_minor: money,
    currency,
    status: z.enum(["pending", "completed", "failed", "reversed"]),
    destination: z.enum(["cash", "store_credit"]),
    economic_effect_id: id,
  }),
  record("disputes", {
    order_id: id,
    original_transaction_id: id.optional(),
    amount_minor: money,
    currency,
    state: z.enum(["open", "resolved"]),
    debit_minor: money,
    reversal_minor: money,
    fee_minor: money,
  }),
  record("coverage", {
    capability: z.enum(datasets),
    entity_scope: id.nullable(),
    history_start: time,
    complete_through: time,
    backfill_complete: z.boolean(),
    missing_fields: z.array(coverageFieldCode).max(100),
    failure_state: z.enum(["none", "incomplete", "revoked", "error"]),
    basis: z.literal("declared"),
    history_kind: z
      .enum(["event_history", "snapshot_only", "mixed"])
      .optional(),
    stock_snapshot_id: id.optional(),
    allocation_ids: z.array(id).max(248).optional(),
    limitations: z.array(coverageLimitationCode).max(20).optional(),
  }),
  record("identity", {
    entity_id: id,
    target_id: id,
    relationship_type: z.enum([
      "order_customer",
      "line_item",
      "payment_alias",
      "invoice_order",
      "shipment_order",
      "refund_payment",
    ]),
    confidence: z.enum(["verified", "ambiguous", "rejected"]),
  }),
]);
export const datasetKinds: Record<(typeof datasets)[number], string> = {
  orders: "order.revised",
  stock: "inventory.snapshot",
  allocations: "allocation.revised",
  supply: "supply.commitment_recorded",
  promises: "customer.commitment_recorded",
  fulfillments: "shipment.observed",
  tracking: "carrier.scan_observed",
  communications: "communication.observed",
  invoices: "invoice.revised",
  invoice_dispatch: "invoice.dispatch_observed",
  payments: "payment.captured",
  payment_allocations: "payment.allocation_recorded",
  policy: "business.rule_recorded",
  cases: "business.case_recorded",
  provider_ledger: "provider.ledger_posted",
  positions: "provider.balance_observed",
  payouts: "payout.announced",
  bank: "bank.credit_booked",
  holds: "provider.hold_recorded",
  returns: "return.revised",
  receipts: "return.disposition_observed",
  entitlements: "refund.entitlement_recorded",
  refunds: "refund.pending",
  disputes: "dispute.opened",
  coverage: "coverage.observed",
  identity: "entity.link_recorded",
};
export function recordKind(record: z.infer<typeof datasetRecord>): string {
  const r = record as unknown as Record<string, unknown>;
  if (record.dataset === "payments") return `payment.${r.status}`;
  if (record.dataset === "payouts") return `payout.${r.status}`;
  if (record.dataset === "refunds") return `refund.${r.status}`;
  if (record.dataset === "orders" && r.status === "cancelled")
    return "order.cancelled";
  if (record.dataset === "invoices" && r.kind === "credit")
    return "invoice.credit_issued";
  if (record.dataset === "holds" && r.state === "released")
    return "provider.hold_released";
  return datasetKinds[record.dataset];
}
export const recordObservation = z
  .object({
    id,
    entity_id: id,
    kind: z.string(),
    occurred_at: time,
    economic_id: id,
    record: datasetRecord,
    supersedes_entry_id: id.optional(),
    test: z.boolean(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (recordKind(e.record) !== e.kind)
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "dataset_event_mismatch",
      });
  });
export type RecordObservation = z.infer<typeof recordObservation>;
