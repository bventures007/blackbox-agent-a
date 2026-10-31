import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  recordKind,
  recordObservation,
  datasets,
  type RecordObservation,
} from "../../packages/contracts/records.js";
export function fixture(index: number, missing = false) {
  const ids = new Map<string, string>();
  const id = (name: string) => {
    if (!ids.has(name)) ids.set(name, randomUUID());
    return ids.get(name)!;
  };
  const records: RecordObservation[] = [];
  const now = "2026-10-31T10:00:00Z";
  const add = (name: string, record: any) => {
    const e = recordObservation.parse({
      id: randomUUID(),
      economic_id: id(name),
      entity_id: id("order"),
      kind: recordKind(record),
      occurred_at: "2026-10-31T09:00:00Z",
      record,
      test: true,
    });
    records.push(e);
    return e;
  };
  const order = (
    name = "order",
    quantity = "10",
    gross = 11900,
    cancelled = "0",
  ) =>
    add(name, {
      dataset: "orders",
      status: "open",
      currency: "EUR",
      gross_minor: gross,
      created_at: "2026-10-01T10:00:00Z",
      lines: [
        {
          line_id: id(name + "-line"),
          item_id: id("item"),
          quantity,
          cancelled_quantity: cancelled,
          unit: "piece",
          line_gross_minor: gross,
        },
      ],
    });
  const stock = (available = "86") =>
    add("stock", {
      dataset: "stock",
      item_id: id("item"),
      location_id: id("location"),
      unit: "piece",
      basis: "provider_available",
      physical: "120",
      available,
      committed: "34",
      reserved: "0",
      damaged: "0",
      quality_control: "0",
      safety_stock: "0",
      incoming: "80",
    });
  const allocation = (quantity = "4", extra: any = {}) =>
    add("allocation", {
      dataset: "allocations",
      order_id: id("order"),
      line_id: id("order-line"),
      item_id: id("item"),
      location_id: id("location"),
      quantity,
      unit: "piece",
      status: "active",
      basis: "observed_reservation",
      ...extra,
    });
  const shipment = (name = "shipment", state = "handed_over", quantity = "3") =>
    add(name, {
      dataset: "fulfillments",
      order_id: id("order"),
      state,
      lines: [{ line_id: id("order-line"), quantity, unit: "piece" }],
      ...(state === "delivered" ? { delivered_at: now } : { handover_at: now }),
    });
  const tracking = (state = "in_transit") =>
    add("tracking", {
      dataset: "tracking",
      shipment_id: id("shipment"),
      status: state,
      scan_at: "2026-10-31T09:00:00Z",
      forecast_at: null,
      carrier_service_id: id("carrier"),
    });
  const policy = (kind: string, fields: any) =>
    add("policy", {
      dataset: "policy",
      rule_kind: kind,
      version: 1,
      effective_from: "2020-01-01T00:00:00Z",
      timezone: "Europe/Berlin",
      ...fields,
    });
  const promise = (time = "2026-10-30T17:00:00+01:00") =>
    add("promise", {
      dataset: "promises",
      order_id: id("order"),
      promised_at: time,
      timezone: "Europe/Berlin",
      promise_kind: "customer_delivery",
    });
  const invoice = (gross = 11900, paid = 5000) =>
    add("invoice", {
      dataset: "invoices",
      order_id: id("order"),
      kind: "invoice",
      state: "final",
      currency: "EUR",
      gross_minor: gross,
      reported_paid_minor: paid,
      due_date: "2026-10-30",
      lines: [
        {
          line_id: id("order-line"),
          quantity: "10",
          unit: "piece",
          covered_gross_minor: gross,
        },
      ],
    });
  const credit = (gross = 2380) =>
    add("credit", {
      dataset: "invoices",
      order_id: id("order"),
      invoice_id: id("invoice"),
      kind: "credit",
      state: "final",
      currency: "EUR",
      gross_minor: gross,
    });
  const payment = (name = "payment", state = "captured", amount = 5000) =>
    add(name, {
      dataset: "payments",
      order_id: id("order"),
      account_id: id("account"),
      status: state,
      amount_minor: amount,
      currency: "EUR",
      economic_effect_id: id(name),
    });
  const payAllocation = () =>
    add("pay-allocation", {
      dataset: "payment_allocations",
      invoice_id: id("invoice"),
      transaction_id: id("payment"),
      amount_minor: 5000,
      currency: "EUR",
      confidence: "verified",
    });
  const payout = () =>
    add("payout", {
      dataset: "payouts",
      account_id: id("account"),
      bank_account_id: id("bank-account"),
      status: "sent",
      direction: "deposit",
      amount_minor: 9170,
      currency: "EUR",
      issued_at: now,
      trace_reference: id("trace"),
    });
  const ledger = () => {
    add("ledger-capture", {
      dataset: "provider_ledger",
      account_id: id("account"),
      transaction_id: id("payment"),
      payout_id: id("payout"),
      posting_type: "capture",
      gross_minor: 11900,
      fee_minor: 350,
      net_minor: 11550,
      currency: "EUR",
    });
    add("ledger-refund", {
      dataset: "provider_ledger",
      account_id: id("account"),
      payout_id: id("payout"),
      posting_type: "refund",
      gross_minor: -2380,
      fee_minor: 0,
      net_minor: -2380,
      currency: "EUR",
    });
  };
  const position = (held = 0) =>
    add("position", {
      dataset: "positions",
      account_id: id("account"),
      currency: "EUR",
      total_minor: held,
      processing_minor: 0,
      available_minor: 0,
      held_minor: held,
    });
  const refund = (amount = 2380, state = "pending") =>
    add("refund", {
      dataset: "refunds",
      order_id: id("order"),
      original_transaction_id: id("payment"),
      return_id: id("return"),
      amount_minor: amount,
      currency: "EUR",
      status: state,
      destination: "cash",
      economic_effect_id: id("refund"),
    });
  const entitlement = (amount = 2380) =>
    add("entitlement", {
      dataset: "entitlements",
      order_id: id("order"),
      invoice_id: id("invoice"),
      credit_id: id("credit"),
      original_transaction_id: id("payment"),
      amount_minor: amount,
      currency: "EUR",
      destination: "cash",
      state: "approved",
      approved_at: now,
    });
  let parameters: any = { as_of: now };
  let verify: (rows: any[]) => void = () => {};
  switch (index) {
    case 0:
      stock();
      parameters = {
        ...parameters,
        item_id: id("item"),
        requested_quantity: "100",
        unit: "piece",
      };
      verify = (r) => {
        assert.equal(r[0].available, "86");
        assert.equal(r[0].shortfall, "14");
        assert.equal(r[0].incoming_counted_as_stock, false);
      };
      break;
    case 1:
      stock("10");
      order("order", "6");
      order("second-order", "6");
      policy("priority", {
        priority_method: "explicit_order",
        priority_order: [id("order"), id("second-order")],
      });
      verify = (r) => {
        assert.equal(
          r.find((x) => x.id === id("order")).state,
          "fully_fulfillable",
        );
        assert.equal(
          r.find((x) => x.id === id("second-order")).lines[0].allocated,
          "4",
        );
        assert.equal(
          r.reduce((n, x) => n + Number(x.lines[0].from_free_stock), 0),
          10,
        );
      };
      break;
    case 2:
      order("order", "10", 11900, "2");
      shipment();
      allocation();
      verify = (r) => {
        assert.equal(r[0].remaining_obligation, "5");
        assert.equal(r[0].under_reserved, "1");
      };
      break;
    case 3:
      order();
      allocation("4", { supply_id: id("supply") });
      promise("2026-11-04T17:00:00+01:00");
      add("supply", {
        dataset: "supply",
        item_id: id("item"),
        location_id: id("location"),
        quantity: "10",
        unit: "piece",
        previous_promised_at: "2026-11-03T09:00:00Z",
        promised_at: "2026-11-05T09:00:00Z",
        timezone: "Europe/Berlin",
      });
      verify = (r) => {
        assert.equal(r[0].id, id("order"));
        assert.equal(r[0].risk, "incoming_after_customer_deadline");
      };
      break;
    case 4:
      shipment();
      tracking("exception");
      policy("attention", {
        exceptions_require_attention: true,
        stale_after_seconds: 86400,
      });
      verify = (r) => {
        assert.equal(r[0].attention, true);
        assert.equal(r[0].latest_scan_age_seconds, 3600);
      };
      break;
    case 5:
      order();
      shipment();
      tracking();
      promise();
      policy("attention", { exceptions_require_attention: true });
      verify = (r) => {
        assert.equal(r[0].overdue, true);
        assert.equal(r[0].arrival_date, "unknown");
      };
      break;
    case 6:
      order("order", "10", 11900, "2");
      shipment("shipment", "handed_over", "2");
      shipment("delivered", "delivered", "3");
      tracking();
      verify = (r) => {
        assert.equal(r[0].remaining_to_dispatch, "3");
        assert.equal(r[0].remaining_to_deliver, "5");
      };
      break;
    case 7:
      order();
      shipment();
      tracking();
      add("communication", {
        dataset: "communications",
        order_id: id("order"),
        sent_at: now,
        actor: "owner",
        reviewed_commitment_ids: [],
      });
      verify = (r) => {
        assert.deepEqual(r[0].facts, ["arrival_unknown", "in_transit"]);
        assert.equal(r[0].send_action, false);
        assert.equal(r[0].prior_promises_checked, true);
      };
      break;
    case 8:
      invoice();
      credit();
      verify = (r) => {
        assert.equal(r[0].reported_open_minor, 4520);
        assert.equal(r[0].new_cash_from_marker, 0);
      };
      break;
    case 9:
      order();
      shipment();
      policy("invoicing", { invoicing_trigger: "after_confirmed_dispatch" });
      verify = (r) => {
        assert.equal(r[0].id, id("order"));
        assert.equal(r[0].missing_invoice, true);
      };
      break;
    case 10:
      order();
      invoice(12000, 0);
      verify = (r) => assert.equal(r[0].difference_minor, 100);
      break;
    case 11:
      invoice();
      add("invoice-two", {
        dataset: "invoices",
        kind: "invoice",
        state: "final",
        currency: "EUR",
        gross_minor: 11900,
        reported_paid_minor: 0,
      });
      add("dispatch", {
        dataset: "invoice_dispatch",
        invoice_id: id("invoice"),
        channel: "email",
        status: "sent",
        processed_at: now,
        source_scope: "provider",
      });
      verify = (r) => {
        assert.equal(
          r.find((x) => x.id === id("invoice")).send_evidence,
          "provider_reported_sent",
        );
        assert.equal(
          r.find((x) => x.id === id("invoice-two")).without_send_evidence,
          true,
        );
        assert.ok(r.every((x) => x.recipient_delivery_proven === false));
      };
      break;
    case 12:
      order();
      payment("auth", "authorized", 11900);
      payment();
      verify = (r) => {
        assert.equal(r[0].collected_minor, 5000);
        assert.equal(r[0].remaining_minor, 6900);
        assert.equal(r[0].state, "partially_collected");
      };
      break;
    case 13:
      order();
      payment("failed", "failed", 11900);
      payment("payment", "captured", 11900);
      verify = (r) => {
        assert.equal(r[0].recovered, true);
        assert.deepEqual(r[0].failed_history_retained, [id("failed")]);
      };
      break;
    case 14:
      invoice();
      credit();
      payment();
      payAllocation();
      verify = (r) => {
        assert.equal(r[0].remaining_minor, 4520);
        assert.equal(r[0].fee_added_to_customer_debt, 0);
      };
      break;
    case 15:
      invoice();
      credit();
      payment();
      payAllocation();
      policy("reminder", { reminder_policy: "review_overdue" });
      verify = (r) => {
        assert.equal(r[0].id, id("invoice"));
        assert.equal(r[0].open_minor, 4520);
        assert.equal(r[0].send_reminder, false);
      };
      break;
    case 16:
      ledger();
      position();
      payout();
      verify = (r) => {
        assert.equal(r[0].net_assets_minor, 9170);
        assert.equal(r[0].in_transit_minor, 9170);
        assert.equal(r[0].bank_confirmed_minor, 0);
      };
      break;
    case 17:
      ledger();
      payout();
      verify = (r) => {
        assert.equal(r[0].computed_net_minor, 9170);
        assert.equal(r[0].unexplained_minor, 0);
      };
      break;
    case 18:
      payout();
      verify = (r) => {
        assert.equal(r[0].missing_confirmation, true);
        assert.equal(r[0].conclusion, "no_evidence_in_imported_interval");
      };
      break;
    case 19:
      position(9700);
      add("hold", {
        dataset: "holds",
        account_id: id("account"),
        currency: "EUR",
        amount_minor: 9700,
        released_minor: 0,
        state: "active",
        release_promised_at: "2026-11-05T10:00:00Z",
        released_at: null,
        reason: "reserve",
      });
      verify = (r) => {
        assert.equal(r[0].held_minor, 9700);
        assert.equal(r[0].released_minor, 0);
        assert.equal(r[0].release_is_only_promised, true);
      };
      break;
    case 20:
      add("return", {
        dataset: "returns",
        order_id: id("order"),
        line_id: id("order-line"),
        quantity: "2",
        unit: "piece",
        state: "approved",
      });
      add("receipt", {
        dataset: "receipts",
        return_id: id("return"),
        line_id: id("order-line"),
        location_id: id("location"),
        quantity: "2",
        unit: "piece",
        disposition: "quarantined",
      });
      refund();
      verify = (r) => {
        assert.equal(r[0].physical_return_received, true);
        assert.equal(r[0].sellable_added, "0");
        assert.equal(r[0].cash_refund_confirmed, false);
      };
      break;
    case 21:
      invoice(11900, 11900);
      credit();
      payment("payment", "captured", 11900);
      entitlement();
      verify = (r) => assert.equal(r[0].cash_refund_due_minor, 2380);
      break;
    case 22: {
      const o = order("order", "2", 2380);
      (o.record as any).status = "cancelled";
      o.kind = recordKind(o.record);
      allocation("2");
      invoice(2380, 2380);
      payment("payment", "captured", 2380);
      entitlement();
      verify = (r) => {
        assert.deepEqual(r[0].remaining_steps, [
          "release_reservation",
          "correct_invoice",
          "refund_payment",
        ]);
        assert.equal(r[0].stock_receipt_required, false);
      };
      break;
    }
    case 23:
      payment("payment", "captured", 10000);
      refund(10000, "completed");
      add("dispute", {
        dataset: "disputes",
        order_id: id("order"),
        original_transaction_id: id("payment"),
        amount_minor: 10000,
        currency: "EUR",
        state: "open",
        debit_minor: 10000,
        reversal_minor: 0,
        fee_minor: 1500,
      });
      verify = (r) => {
        assert.equal(r[0].net_customer_repayments_minor, 20000);
        assert.equal(r[0].excess_minor, 10000);
        assert.equal(r[0].review_required, true);
      };
      break;
    default:
      throw Error("unknown_fixture");
  }
  const gaps = [
    "stock.basis",
    "policy.priority_method",
    "allocations.order_line_ownership",
    "allocations.supply_to_order",
    "tracking.coverage",
    "promises.promised_at",
    "fulfillments.line_quantity_links",
    "communications",
    "invoices.correction_chain_coverage",
    "invoices.coverage",
    "invoices.line_links",
    "invoice_dispatch.coverage",
    "payments.status",
    "payments.attempt_history_coverage",
    "payment_allocations",
    "cases.coverage",
    "positions.processing_minor",
    "provider_ledger.payout_membership_coverage",
    "bank",
    "holds",
    "receipts",
    "entitlements",
    "allocations",
    "disputes.original_transaction_id",
  ];
  if (missing) {
    const remove: Record<number, string> = {
      2: "allocations",
      3: "allocations",
      4: "tracking",
      5: "promises",
      6: "fulfillments",
      7: "communications",
      8: "invoices",
      11: "invoice_dispatch",
      12: "payments",
      13: "payments",
      14: "payment_allocations",
      15: "cases",
      17: "provider_ledger",
      18: "bank",
      19: "holds",
      20: "receipts",
      21: "entitlements",
      22: "allocations",
    };
    if (remove[index])
      for (let n = records.length - 1; n >= 0; n--)
        if (records[n].record.dataset === remove[index]) records.splice(n, 1);
    const target = (dataset: string) =>
      records.find((r) => r.record.dataset === dataset)?.record as any;
    if (index === 0) delete target("stock").basis;
    if (index === 1) delete target("policy").priority_method;
    if (index === 10) delete target("invoices").lines;
    if (index === 16) {
      delete target("positions").processing_minor;
      delete target("positions").held_minor;
    }
    if (index === 23) delete target("disputes").original_transaction_id;
  }
  for (const capability of datasets)
    add("coverage-" + capability, {
      dataset: "coverage",
      capability,
      entity_scope: null,
      history_start: "2020-01-01T00:00:00Z",
      complete_through: "2030-01-01T00:00:00Z",
      backfill_complete: !(missing && index === 9 && capability === "invoices"),
      missing_fields:
        missing && capability === gaps[index].split(".")[0]
          ? [gaps[index]]
          : [],
      failure_state: "none",
      basis: "declared",
    });
  return { records, parameters, verify, gap: gaps[index], id };
}
