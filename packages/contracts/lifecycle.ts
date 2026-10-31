import { z } from "zod";
const id = z.uuid();
export const quantity = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
export const lifecycleDetails = z
  .object({
    item_id: id.optional(),
    location_id: id.optional(),
    related_id: id.optional(),
    unit: z.enum(["piece", "kg", "litre", "metre"]).optional(),
    physical: quantity.optional(),
    quarantined: quantity.optional(),
    reserved: quantity.optional(),
    provider_available: quantity.optional(),
    basis: z.enum(["disjoint_physical", "provider_available"]).optional(),
    released_quantity: quantity.optional(),
    destination: z.enum(["cash", "store_credit"]).optional(),
    booking_status: z.enum(["booked", "pending"]).optional(),
  })
  .strict();
export const lifecycleKinds = [
  "inventory.snapshot",
  "inventory.reserved",
  "inventory.reservation_released",
  "invoice.issued",
  "invoice.credit_issued",
  "invoice.payment_marked",
  "payment.fee_booked",
  "shipment.dispatched",
  "shipment.delivered",
  "return.approved",
  "return.received",
  "return.restocked",
  "payout.announced",
  "payout.sent",
  "payout.failed",
  "payout.reversed",
  "bank.credit_booked",
] as const;
