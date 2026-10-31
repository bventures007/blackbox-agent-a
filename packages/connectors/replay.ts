import { identityKey } from "../auth/key-material.js";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  lifecycleObservation,
  type Observation,
  type IngestObservation,
} from "../contracts/index.js";
import { signature } from "../auth/producer.js";
const event = z
  .object({
    id: z.string().max(160),
    provider_event_id: z.string().max(160),
    connection: z.string().max(80),
    occurred_at: z.iso.datetime(),
    entity: z.object({
      order: z.string().max(160),
      customer: z.string().max(160),
      item: z.string().max(160),
    }),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
    evidence_refs: z.array(z.string()).max(250),
  })
  .strict();
export async function replayObservation(
  input: unknown,
  connection: string,
  currency: string,
): Promise<Observation> {
  const e = event.parse(input),
    p = e.payload,
    secret = await identityKey();
  const id = (value: string) => {
    const b = createHmac("sha256", secret)
      .update(`${connection}:${value}`)
      .digest()
      .subarray(0, 16);
    b[6] = (b[6] & 15) | 80;
    b[8] = (b[8] & 63) | 128;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const text = (key: string) => z.string().min(1).max(160).parse(p[key]);
  const number = (key: string) =>
    z.number().int().safe().nonnegative().parse(p[key]);
  const moneyFields: Record<string, string> = {
    "order.accepted": "gross_minor",
    "order.revised": "gross_minor",
    "invoice.issued": "gross_minor",
    "payment.authorized": "authorized_minor",
    "payment.captured": "captured_minor",
    "payment.fee_booked": "fee_minor",
    "invoice.payment_marked": "paid_minor",
    "invoice.credit_issued": "credit_minor",
    "refund.pending": "amount_minor",
    "refund.completed": "amount_minor",
    "payout.announced": "amount_minor",
    "payout.sent": "amount_minor",
    "bank.credit_booked": "amount_minor",
  };
  const keys: Record<string, string> = {
    "inventory.snapshot": "sku",
    "inventory.reserved": "reservation",
    "inventory.reservation_released": "reservation",
    "invoice.issued": "invoice",
    "invoice.payment_marked": "invoice",
    "invoice.credit_issued": "credit",
    "payment.authorized": "transaction",
    "payment.captured": "transaction",
    "payment.fee_booked": "transaction",
    "shipment.dispatched": "shipment",
    "shipment.delivered": "shipment",
    "return.approved": "return",
    "return.received": "return",
    "return.restocked": "return",
    "refund.pending": "refund",
    "refund.completed": "refund",
    "payout.announced": "payout",
    "payout.sent": "payout",
    "bank.credit_booked": "bank_entry",
  };
  const namespace = (key: string, value: string) => id(`${key}:${value}`);
  const details: NonNullable<Observation["details"]> = {};
  if (
    [
      "inventory.snapshot",
      "inventory.reserved",
      "inventory.reservation_released",
      "shipment.dispatched",
      "return.received",
      "return.restocked",
    ].includes(e.kind)
  ) {
    Object.assign(details, {
      item_id: namespace("item", e.entity.item),
      location_id: namespace("location", "default"),
      unit: "piece",
    });
  }
  if (e.kind === "inventory.snapshot")
    Object.assign(details, {
      physical: String(number("physical")),
      quarantined: String(number("quarantined")),
      reserved: String(number("reserved")),
      basis: "disjoint_physical",
    });
  if (
    e.kind === "shipment.dispatched" &&
    p.reservation_released !== undefined
  ) {
    details.released_quantity = String(number("reservation_released"));
    details.related_id = namespace("reservation", text("reservation"));
  }
  if (e.kind === "shipment.delivered")
    details.related_id = namespace("shipment", text("shipment"));
  if (["return.received", "return.restocked"].includes(e.kind))
    details.related_id = namespace("return", text("return"));
  if (["invoice.credit_issued", "invoice.payment_marked"].includes(e.kind))
    details.related_id = namespace("invoice", text("invoice"));
  if (e.kind === "bank.credit_booked") {
    details.related_id = namespace("payout", text("payout"));
    details.booking_status = z.enum(["booked", "pending"]).parse(p.status);
  }
  const economic = keys[e.kind];
  return lifecycleObservation.parse({
    id: id(`${e.connection}:${e.provider_event_id}`),
    entity_id: namespace("order", e.entity.order),
    kind: e.kind,
    occurred_at: e.occurred_at,
    currency: moneyFields[e.kind]
      ? z
          .string()
          .regex(/^[A-Z]{3}$/)
          .parse(p.currency)
      : currency,
    amount_minor: moneyFields[e.kind] ? number(moneyFields[e.kind]) : 0,
    economic_id: economic
      ? namespace(economic, text(economic))
      : namespace("order", e.entity.order),
    test: true,
    ...(p.quantity !== undefined
      ? { quantity: String(number("quantity")) }
      : {}),
    details,
  });
}
export async function sendObservations(
  api: string,
  connection: string,
  key: string,
  observations: IngestObservation[],
) {
  const url = new URL(api);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw Error("loopback_required");
  const path = `/v1/ingest/${connection}`,
    timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = randomUUID(),
    body = { observations };
  const response = await fetch(api + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "x-blackbox-time": timestamp,
      "x-blackbox-nonce": nonce,
      "x-blackbox-signature": signature(key, path, timestamp, nonce, body),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (response.status !== 202) throw Error(`ingest_failed_${response.status}`);
  return result as {
    committed_cursor: number;
    added: number;
    duplicates: number;
    conflicts: number;
  };
}
