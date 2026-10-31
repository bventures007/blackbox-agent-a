use super::*;
pub(crate) fn invoices<'a>(ctx: &mut Context<'a>) -> Vec<&'a Record> {
    ctx.rows("invoices")
        .into_iter()
        .filter(|r| {
            s(&r.data, "kind") == "invoice" && s(&r.data, "state") == "final" && ctx.currency(r)
        })
        .collect()
}
pub(crate) fn invoice_net(invoice: &Record, documents: &[&Record]) -> Result<i64, String> {
    let credits = sum(
        documents.iter().copied().filter(|r| {
            s(&r.data, "kind") == "credit"
                && s(&r.data, "state") == "final"
                && s(&r.data, "invoice_id") == invoice.id
                && s(&r.data, "currency") == s(&invoice.data, "currency")
        }),
        "gross_minor",
    )?;
    sub(n(&invoice.data, "gross_minor")?, credits)
}
pub(crate) fn allocated(
    invoice: &Record,
    allocations: &[&Record],
    payments: &[&Record],
) -> Result<i64, String> {
    allocations
        .iter()
        .filter(|a| {
            s(&a.data, "invoice_id") == invoice.id
                && s(&a.data, "confidence") == "verified"
                && s(&a.data, "currency") == s(&invoice.data, "currency")
        })
        .try_fold(0, |total, a| {
            let payment = payments.iter().find(|p| {
                p.id == s(&a.data, "transaction_id")
                    && s(&p.data, "status") == "captured"
                    && s(&p.data, "currency") == s(&a.data, "currency")
            });
            if let Some(p) = payment {
                let all = sum(
                    allocations.iter().copied().filter(|r| {
                        s(&r.data, "transaction_id") == p.id
                            && s(&r.data, "confidence") == "verified"
                    }),
                    "amount_minor",
                )?;
                if all > n(&p.data, "amount_minor")? {
                    return Err("allocation_exceeds_capture".into());
                }
                add(total, n(&a.data, "amount_minor")?)
            } else {
                Ok(total)
            }
        })
}
pub fn query(ctx: &mut Context<'_>) -> Result<Vec<Value>, String> {
    let intent = ctx.request.intent.as_str();
    let mut out = vec![];
    let orders = ctx.rows("orders");
    let documents = ctx.rows("invoices");
    let invoices = invoices(ctx);
    let payments = ctx.effects("payments");
    let allocations = ctx.rows("payment_allocations");
    match intent {
        "orders.payment_state" | "payments.recovered_attempts" => {
            for order in orders
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r))
            {
                let related: Vec<_> = payments
                    .iter()
                    .copied()
                    .filter(|p| {
                        s(&p.data, "order_id") == order.id
                            && s(&p.data, "currency") == s(&order.data, "currency")
                    })
                    .collect();
                let captured = sum(
                    related
                        .iter()
                        .copied()
                        .filter(|r| s(&r.data, "status") == "captured"),
                    "amount_minor",
                )?;
                let required = n(&order.data, "gross_minor")?;
                let remaining = sub(required, captured)?.max(0);
                if intent == "orders.payment_state" {
                    out.push(json!({"id":order.id,"currency":order.data["currency"],"collected_minor":captured,"remaining_minor":remaining,"state":if captured>=required{"collected"}else if captured>0{"partially_collected"}else{"not_collected"}}));
                } else {
                    let failed: Vec<_> = related
                        .iter()
                        .filter(|r| s(&r.data, "status") == "failed")
                        .map(|r| r.id.clone())
                        .collect();
                    out.push(json!({"id":order.id,"recovered":!failed.is_empty()&&captured>=required,"failed_history_retained":failed,"collected_minor":captured,"required_minor":required}));
                }
            }
        }
        "invoices.outstanding" | "invoices.payment_variance" | "receivables.review_queue" => {
            let cases = ctx.rows("cases");
            let today = &ctx.request.as_of[..10];
            if intent == "receivables.review_queue" {
                ctx.policy("reminder");
            }
            let case_known = !ctx.missing.contains("cases.coverage");
            for invoice in invoices
                .into_iter()
                .filter(|r| ctx.scoped(r))
                .collect::<Vec<_>>()
            {
                let net = invoice_net(invoice, &documents)?;
                let reported = invoice.data["reported_paid_minor"].as_i64();
                if intent == "invoices.outstanding" {
                    if let Some(paid) = reported {
                        out.push(json!({"id":invoice.id,"currency":invoice.data["currency"],"reported_open_minor":sub(net,paid)?.max(0),"credit_balance_minor":sub(paid,net)?.max(0),"new_cash_from_marker":0}));
                    } else {
                        ctx.gap("invoices.reported_paid_minor");
                    }
                    continue;
                }
                let paid = allocated(invoice, &allocations, &payments)?;
                let remaining = sub(net, paid)?.max(0);
                if intent == "invoices.payment_variance" {
                    out.push(json!({"id":invoice.id,"currency":invoice.data["currency"],"remaining_minor":remaining,"allocated_capture_minor":paid,"fee_added_to_customer_debt":0,"unallocated_payments_separate":true}));
                } else if remaining > 0 {
                    let mut due = s(&invoice.data, "due_date");
                    if due.is_empty() {
                        ctx.gap("invoices.due_date");
                        continue;
                    }
                    let related: Vec<_> = cases
                        .iter()
                        .filter(|r| s(&r.data, "invoice_id") == invoice.id)
                        .collect();
                    for c in &related {
                        let extension = s(&c.data, "agreed_extension_until");
                        if extension > due {
                            due = extension;
                        }
                    }
                    if due < today {
                        out.push(json!({"id":invoice.id,"currency":invoice.data["currency"],"open_minor":remaining,"due_date":due,"review_required":true,"held_for_review":related.iter().any(|r|s(&r.data,"status")!="closed"),"queue_label":if case_known{"review_overdue"}else{"amounts_due_case_context_unknown"},"send_reminder":false,"automatic_action":false}));
                    }
                }
            }
        }
        "orders.missing_invoice" => {
            let policy = ctx.policy("invoicing");
            let shipments = ctx.rows("fulfillments");
            if let Some(policy) = policy {
                for order in orders
                    .into_iter()
                    .filter(|r| ctx.scoped(r) && ctx.currency(r))
                {
                    let trigger = s(&policy.data, "invoicing_trigger");
                    let eligible = trigger == "order_accepted"
                        || trigger == "after_confirmed_dispatch"
                            && shipments.iter().any(|shipment| {
                                s(&shipment.data, "order_id") == order.id
                                    && shipment_progress(shipment, &ctx.request.as_of)
                                        .is_ok_and(|(hand, _)| hand == Some(true))
                            });
                    let linked: Vec<_> = invoices
                        .iter()
                        .copied()
                        .filter(|i| {
                            s(&i.data, "order_id") == order.id
                                && s(&i.data, "currency") == s(&order.data, "currency")
                        })
                        .collect();
                    let covered = linked
                        .iter()
                        .try_fold(0, |v, i| add(v, invoice_net(i, &documents)?))?;
                    if eligible && covered < n(&order.data, "gross_minor")? {
                        out.push(json!({"id":order.id,"missing_invoice":true,"uninvoiced_minor":sub(n(&order.data,"gross_minor")?,covered)?,"currency":order.data["currency"]}));
                    }
                }
            }
        }
        "invoices.order_amount_variance" => {
            for invoice in invoices
                .into_iter()
                .filter(|r| ctx.scoped(r))
                .collect::<Vec<_>>()
            {
                let Some(order) = orders.iter().find(|o| {
                    o.id == s(&invoice.data, "order_id")
                        && s(&o.data, "currency") == s(&invoice.data, "currency")
                }) else {
                    ctx.gap("invoices.order_link");
                    continue;
                };
                if invoice.data["lines"].is_null() {
                    ctx.gap("invoices.line_links");
                    continue;
                }
                let mut agreed = 0;
                let mut billed = 0;
                for line in array(&invoice.data, "lines") {
                    let Some(order_line) = array(&order.data, "lines").iter().find(|l| {
                        s(l, "line_id") == s(line, "line_id") && s(l, "unit") == s(line, "unit")
                    }) else {
                        ctx.gap("invoices.line_links");
                        continue;
                    };
                    let denom = q(order_line, "quantity")?;
                    let qty = q(line, "quantity")?;
                    if denom == 0 || qty > denom {
                        ctx.conflicts
                            .insert("invoice_quantity_outside_agreement".into());
                        continue;
                    }
                    let numerator = n(order_line, "line_gross_minor")? as i128 * qty as i128;
                    if numerator % (denom as i128) != 0 {
                        ctx.gap("orders.line_rounding_basis");
                        continue;
                    }
                    let covered =
                        i64::try_from(numerator / (denom as i128)).map_err(|_| "money_overflow")?;
                    agreed = add(agreed, covered)?;
                    billed = add(billed, n(line, "covered_gross_minor")?)?;
                }
                out.push(json!({"id":invoice.id,"currency":invoice.data["currency"],"agreed_covered_gross_minor":agreed,"invoice_covered_gross_minor":billed,"difference_minor":sub(billed,agreed)?}));
            }
        }
        "invoices.dispatch_evidence" => {
            let dispatches = ctx.rows("invoice_dispatch");
            for invoice in invoices
                .into_iter()
                .filter(|r| ctx.scoped(r))
                .collect::<Vec<_>>()
            {
                let sent = dispatches.iter().any(|r| {
                    s(&r.data, "invoice_id") == invoice.id && s(&r.data, "status") == "sent"
                });
                out.push(json!({"id":invoice.id,"without_send_evidence":!sent,"send_evidence":if sent{Some("provider_reported_sent")}else{None},"recipient_delivery_proven":false}));
            }
        }
        _ => return Err("unsupported_intent".into()),
    }
    Ok(out)
}
