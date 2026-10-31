use super::*;
fn bank_matches<'a>(payout: &Record, bank: &[&'a Record]) -> Vec<&'a Record> {
    bank.iter()
        .copied()
        .filter(|b| {
            s(&b.data, "booking_status") == "booked"
                && s(&b.data, "match_confidence") == "verified"
                && s(&b.data, "payout_id") == payout.id
                && s(&b.data, "currency") == s(&payout.data, "currency")
                && s(&b.data, "account_id") == s(&payout.data, "bank_account_id")
                && s(&b.data, "reference") == s(&payout.data, "trace_reference")
                && b.data["amount_minor"] == payout.data["amount_minor"]
        })
        .collect()
}
pub fn query(ctx: &mut Context<'_>) -> Result<Vec<Value>, String> {
    let intent = ctx.request.intent.as_str();
    let mut out = vec![];
    match intent {
        "payouts.gross_to_net" => {
            let ledger = ctx.rows("provider_ledger");
            let payouts = ctx.rows("payouts");
            let selected: Vec<_> = payouts
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r))
                .collect();
            for payout in selected {
                let entries: Vec<_> = ledger
                    .iter()
                    .copied()
                    .filter(|r| {
                        s(&r.data, "payout_id") == payout.id
                            && s(&r.data, "currency") == s(&payout.data, "currency")
                            && s(&r.data, "account_id") == s(&payout.data, "account_id")
                    })
                    .collect();
                if entries.is_empty() {
                    ctx.gap("provider_ledger.payout_membership_coverage");
                    continue;
                }
                for entry in &entries {
                    if sub(n(&entry.data, "gross_minor")?, n(&entry.data, "fee_minor")?)?
                        != n(&entry.data, "net_minor")?
                    {
                        ctx.conflicts.insert("ledger_gross_fee_net_mismatch".into());
                    }
                }
                let net = sum(entries.iter().copied(), "net_minor")?;
                let residual = sub(n(&payout.data, "amount_minor")?, net)?;
                out.push(json!({"id":payout.id,"currency":payout.data["currency"],"computed_net_minor":net,"unexplained_minor":residual,"gross_minor":sum(entries.iter().copied(),"gross_minor")?,"fees_minor":sum(entries.iter().copied(),"fee_minor")?,"member_postings":entries.iter().map(|r|&r.id).collect::<Vec<_>>(),"reconciled":residual==0}));
            }
        }
        "payouts.missing_bank_confirmation" => {
            let payouts = ctx.rows("payouts");
            let bank = ctx.rows("bank");
            for payout in payouts
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r) && s(&r.data, "status") == "sent")
            {
                let matches = bank_matches(payout, &bank);
                let state = if matches.len() == 1 {
                    "confirmed"
                } else if matches.len() > 1 {
                    "ambiguous"
                } else {
                    "no_evidence_in_imported_interval"
                };
                out.push(json!({"id":payout.id,"currency":payout.data["currency"],"amount_minor":payout.data["amount_minor"],"missing_confirmation":matches.len()!=1,"conclusion":state,"matching_entries":matches.iter().map(|r|&r.id).collect::<Vec<_>>()}));
            }
        }
        "providers.holds_and_releases" => {
            for hold in ctx
                .rows("holds")
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r))
                .collect::<Vec<_>>()
            {
                let released = n(&hold.data, "released_minor")?;
                let held = sub(n(&hold.data, "amount_minor")?, released)?;
                if held < 0 {
                    ctx.conflicts.insert("hold_release_exceeds_amount".into());
                }
                out.push(json!({"id":hold.id,"account_id":hold.data["account_id"],"currency":hold.data["currency"],"held_minor":if held<0 {None}else{Some(held)},"released_minor":released,"release_promised_at":hold.data["release_promised_at"],"release_is_only_promised":!hold.data["release_promised_at"].is_null()&&hold.data["released_at"].is_null()}));
            }
        }
        "providers.money_positions" => {
            let ledger = ctx.rows("provider_ledger");
            let payouts = ctx.rows("payouts");
            let bank = ctx.rows("bank");
            let positions = ctx.rows("positions");
            let selected: Vec<_> = positions
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r))
                .collect();
            for position in selected {
                let d = &position.data;
                let account = s(d, "account_id");
                let currency = s(d, "currency");
                let net = sum(
                    ledger.iter().copied().filter(|r| {
                        s(&r.data, "account_id") == account && s(&r.data, "currency") == currency
                    }),
                    "net_minor",
                )?;
                let mut transit = 0;
                let mut confirmed = 0;
                for payout in payouts.iter().filter(|r| {
                    s(&r.data, "account_id") == account
                        && s(&r.data, "currency") == currency
                        && s(&r.data, "status") == "sent"
                }) {
                    if bank_matches(payout, &bank).len() == 1 {
                        confirmed = add(confirmed, n(&payout.data, "amount_minor")?)?;
                    } else {
                        transit = add(transit, n(&payout.data, "amount_minor")?)?;
                    }
                }
                let mut unknown = vec![];
                for (field, label) in [
                    ("processing_minor", "processing"),
                    ("held_minor", "held"),
                    ("available_minor", "available"),
                ] {
                    if d[field].is_null()
                        || field == "held_minor" && ctx.missing.contains("holds.coverage")
                    {
                        unknown.push(label);
                        ctx.gap(&format!("positions.{field}"));
                    }
                }
                let partition = if unknown.is_empty() {
                    Some(add(
                        add(n(d, "processing_minor")?, n(d, "held_minor")?)?,
                        n(d, "available_minor")?,
                    )?)
                } else {
                    None
                };
                let residual = partition
                    .map(|p| sub(net, add(add(p, transit)?, confirmed)?))
                    .transpose()?;
                if residual.is_some_and(|r| r != 0) {
                    ctx.conflicts.insert("asset_partition_residual".into());
                }
                out.push(json!({"id":position.id,"account_id":account,"currency":currency,"net_assets_minor":net,"provider_total_minor":d["total_minor"],"in_transit_minor":transit,"bank_confirmed_minor":confirmed,"processing_minor":d["processing_minor"],"held_minor":if unknown.contains(&"held"){Value::Null}else{d["held_minor"].clone()},"available_minor":d["available_minor"],"unknown_components":unknown,"unknown_components_are_zero":false,"unexplained_minor":residual}));
            }
        }
        "returns.lifecycle" => {
            let returns = ctx.rows("returns");
            let receipts = ctx.rows("receipts");
            let refunds = ctx.effects("refunds");
            let receipt_known = !ctx.missing.contains("receipts.coverage");
            let refund_known = !ctx.missing.contains("refunds.coverage");
            for ret in returns
                .into_iter()
                .filter(|r| ctx.scoped(r))
                .collect::<Vec<_>>()
            {
                let related: Vec<_> = receipts
                    .iter()
                    .filter(|r| {
                        s(&r.data, "return_id") == ret.id
                            && s(&r.data, "line_id") == s(&ret.data, "line_id")
                            && s(&r.data, "unit") == s(&ret.data, "unit")
                    })
                    .collect();
                let received = related
                    .iter()
                    .filter(|r| s(&r.data, "disposition") != "missing")
                    .try_fold(0, |n, r| add(n, q(&r.data, "quantity")?))?;
                let restocked = related
                    .iter()
                    .filter(|r| s(&r.data, "disposition") == "restocked")
                    .try_fold(0, |n, r| add(n, q(&r.data, "quantity")?))?;
                if received > q(&ret.data, "quantity")? {
                    ctx.conflicts
                        .insert("return_receipt_exceeds_requested".into());
                }
                let cash = refunds.iter().any(|r| {
                    s(&r.data, "return_id") == ret.id
                        && s(&r.data, "status") == "completed"
                        && s(&r.data, "destination") == "cash"
                });
                out.push(json!({"id":ret.id,"unit":ret.data["unit"],"requested_quantity":ret.data["quantity"],"received_quantity":if receipt_known{Some(decimal(received))}else{None},"quarantined_quantity":if receipt_known{Some(decimal(sub(received,restocked)?))}else{None},"sellable_added":if receipt_known{Some(decimal(restocked))}else{None},"physical_return_received":if receipt_known{Some(received>0)}else{None},"receipt_state":if receipt_known{"observed"}else{"unknown"},"request_is_not_receipt":true,"cash_refund_confirmed":if cash {Some(true)} else if refund_known {Some(false)} else {None}}));
            }
        }
        "credits.refund_gaps" => {
            let entitlements = ctx.rows("entitlements");
            let payments = ctx.effects("payments");
            let refunds = ctx.effects("refunds");
            let selected: Vec<_> = entitlements
                .into_iter()
                .filter(|r| {
                    ctx.scoped(r)
                        && ctx.currency(r)
                        && s(&r.data, "state") == "approved"
                        && s(&r.data, "destination") == "cash"
                })
                .collect();
            let mut grouped: BTreeMap<(&str, &str), Vec<&Record>> = BTreeMap::new();
            for entitlement in selected {
                grouped
                    .entry((
                        s(&entitlement.data, "original_transaction_id"),
                        s(&entitlement.data, "currency"),
                    ))
                    .or_default()
                    .push(entitlement);
            }
            for ((transaction, currency), mut entitlements) in grouped {
                entitlements.sort_by_key(|r| &r.id);
                if !payments.iter().any(|p| {
                    p.id == transaction
                        && s(&p.data, "status") == "captured"
                        && s(&p.data, "currency") == currency
                }) {
                    ctx.gap("entitlements.original_capture");
                    continue;
                }
                let refunded = sum(
                    refunds.iter().copied().filter(|r| {
                        s(&r.data, "original_transaction_id") == transaction
                            && s(&r.data, "status") == "completed"
                            && s(&r.data, "destination") == "cash"
                            && s(&r.data, "currency") == currency
                    }),
                    "amount_minor",
                )?;
                // A refund settles its original capture once. It is not subtracted separately from every credit.
                let due = sub(sum(entitlements.iter().copied(), "amount_minor")?, refunded)?.max(0);
                let mut row = json!({"id":if entitlements.len()==1{entitlements[0].id.as_str()}else{transaction},"currency":currency,"original_transaction_id":transaction,"cash_refund_due_minor":due});
                if entitlements.len() > 1 {
                    row["entitlement_ids"] =
                        json!(entitlements.iter().map(|r| &r.id).collect::<Vec<_>>());
                }
                out.push(row);
            }
        }

        "refunds.chargeback_overlap" => {
            let payments = ctx.effects("payments");
            let refunds = ctx.effects("refunds");
            let disputes = ctx.rows("disputes");
            for dispute in &disputes {
                if s(&dispute.data, "original_transaction_id").is_empty() {
                    ctx.gap("disputes.original_transaction_id");
                }
            }
            for payment in payments
                .into_iter()
                .filter(|r| ctx.scoped(r) && ctx.currency(r) && s(&r.data, "status") == "captured")
                .collect::<Vec<_>>()
            {
                let currency = s(&payment.data, "currency");
                let related: Vec<_> = refunds
                    .iter()
                    .copied()
                    .filter(|r| {
                        s(&r.data, "original_transaction_id") == payment.id
                            && s(&r.data, "currency") == currency
                            && s(&r.data, "destination") == "cash"
                    })
                    .collect();
                let refunded = sum(
                    related
                        .iter()
                        .copied()
                        .filter(|r| s(&r.data, "status") == "completed"),
                    "amount_minor",
                )?;
                let cases: Vec<_> = disputes
                    .iter()
                    .copied()
                    .filter(|r| {
                        s(&r.data, "original_transaction_id") == payment.id
                            && s(&r.data, "currency") == currency
                    })
                    .collect();
                let chargeback = sub(
                    sum(cases.iter().copied(), "debit_minor")?,
                    sum(cases.iter().copied(), "reversal_minor")?,
                )?;
                let invalid_reversal = cases.iter().any(|r| {
                    n(&r.data, "reversal_minor").unwrap_or(0)
                        > n(&r.data, "debit_minor").unwrap_or(0)
                });
                if invalid_reversal {
                    ctx.conflicts
                        .insert("chargeback_reversal_exceeds_debit".into());
                }
                let repayments = add(refunded, chargeback)?;
                let excess = sub(repayments, n(&payment.data, "amount_minor")?)?.max(0);
                let overlap = (refunded > 0
                    || related.iter().any(|r| s(&r.data, "status") == "pending"))
                    && cases.iter().any(|r| s(&r.data, "state") == "open");
                out.push(json!({"id":payment.id,"currency":currency,"net_customer_repayments_minor":if invalid_reversal {None}else{Some(repayments)},"excess_minor":if invalid_reversal {None}else{Some(excess)},"review_required":invalid_reversal||excess>0||overlap,"pending_overlap":overlap,"chargeback_fees_excluded":true}));
            }
        }
        "cancellations.outstanding_steps" => {
            let orders = ctx.rows("orders");
            let allocations = ctx.rows("allocations");
            let docs = ctx.rows("invoices");
            let payments = ctx.effects("payments");
            let entitlements = ctx.rows("entitlements");
            let refunds = ctx.effects("refunds");
            let shipments = ctx.rows("fulfillments");
            let receipts = ctx.rows("receipts");
            for order in orders
                .into_iter()
                .filter(|r| ctx.scoped(r) && s(&r.data, "status") == "cancelled")
                .collect::<Vec<_>>()
            {
                let mut steps = vec![];
                if allocations.iter().any(|a| {
                    s(&a.data, "order_id") == order.id
                        && s(&a.data, "status") == "active"
                        && s(&a.data, "basis") == "observed_reservation"
                        && q(&a.data, "quantity").is_ok_and(|n| n > 0)
                }) {
                    steps.push("release_reservation");
                }
                if allocations.iter().any(|a| {
                    s(&a.data, "order_id") == order.id
                        && s(&a.data, "status") == "active"
                        && s(&a.data, "basis") == "derived_plan"
                        && q(&a.data, "quantity").is_ok_and(|n| n > 0)
                }) {
                    steps.push("cancel_assignment");
                }
                for invoice in docs.iter().filter(|i| {
                    s(&i.data, "order_id") == order.id
                        && s(&i.data, "kind") == "invoice"
                        && s(&i.data, "state") == "final"
                }) {
                    if super::finance::invoice_net(invoice, &docs)? > 0 {
                        steps.push("correct_invoice");
                        break;
                    }
                }
                let mut dues: BTreeMap<(&str, &str), i64> = BTreeMap::new();
                for entitlement in entitlements.iter().filter(|e| {
                    s(&e.data, "order_id") == order.id
                        && s(&e.data, "state") == "approved"
                        && s(&e.data, "destination") == "cash"
                }) {
                    let key = (
                        s(&entitlement.data, "original_transaction_id"),
                        s(&entitlement.data, "currency"),
                    );
                    dues.insert(
                        key,
                        add(
                            *dues.get(&key).unwrap_or(&0),
                            n(&entitlement.data, "amount_minor")?,
                        )?,
                    );
                }
                for ((transaction, currency), due) in dues {
                    let completed = sum(
                        refunds.iter().copied().filter(|r| {
                            s(&r.data, "original_transaction_id") == transaction
                                && s(&r.data, "currency") == currency
                                && s(&r.data, "status") == "completed"
                                && s(&r.data, "destination") == "cash"
                        }),
                        "amount_minor",
                    )?;
                    if completed < due {
                        steps.push("refund_payment");
                        break;
                    }
                }
                if payments.iter().any(|p| {
                    s(&p.data, "order_id") == order.id && s(&p.data, "status") == "authorized"
                }) {
                    steps.push("void_authorization");
                }
                let mut shipped_by_line: BTreeMap<(&str, &str), i64> = BTreeMap::new();
                for shipment in shipments.iter().filter(|r| {
                    s(&r.data, "order_id") == order.id
                        && shipment_progress(r, &ctx.request.as_of)
                            .is_ok_and(|(hand, _)| hand == Some(true))
                }) {
                    for line in array(&shipment.data, "lines") {
                        let key = (s(line, "line_id"), s(line, "unit"));
                        shipped_by_line.insert(
                            key,
                            add(
                                *shipped_by_line.get(&key).unwrap_or(&0),
                                q(line, "quantity")?,
                            )?,
                        );
                    }
                }
                let shipped = shipped_by_line.values().any(|n| *n > 0);
                let dispatch_unknown = shipments
                    .iter()
                    .filter(|r| s(&r.data, "order_id") == order.id)
                    .any(|r| {
                        shipment_progress(r, &ctx.request.as_of)
                            .is_ok_and(|(hand, _)| hand.is_none())
                    });
                if dispatch_unknown {
                    steps.push("verify_handover");
                }
                let mut unreturned = false;
                for ((line, unit), quantity) in shipped_by_line {
                    let returned = receipts
                        .iter()
                        .filter(|r| {
                            s(&r.data, "line_id") == line
                                && s(&r.data, "unit") == unit
                                && s(&r.data, "disposition") != "missing"
                        })
                        .try_fold(0, |n, r| add(n, q(&r.data, "quantity")?))?;
                    if returned < quantity {
                        unreturned = true;
                    }
                    if returned > quantity {
                        ctx.conflicts
                            .insert("return_receipt_exceeds_shipped".into());
                    }
                }
                if unreturned || (shipped && ctx.missing.contains("receipts.coverage")) {
                    steps.push("verify_return_receipt");
                }
                out.push(json!({"id":order.id,"remaining_steps":steps,"stock_receipt_required":if dispatch_unknown{None}else{Some(shipped)},"reservation_step":if ctx.missing.contains("allocations.coverage"){"unknown"}else{"checked"},"do_not_mark_complete":!ctx.missing.is_empty()}));
            }
        }
        _ => return Err("unsupported_intent".into()),
    }
    Ok(out)
}
