use super::*;
fn stock(ctx: &mut Context<'_>) -> Result<BTreeMap<(String, String), i64>, String> {
    let mut totals = BTreeMap::new();
    let mut scopes = BTreeSet::new();
    let coverage = ctx.rows("coverage");
    for r in ctx.rows("stock") {
        let d = &r.data;
        let item = s(d, "item_id");
        let unit = s(d, "unit");
        if ctx.request.item_id.as_ref().is_some_and(|v| v != item)
            || ctx.request.unit.as_ref().is_some_and(|v| v != unit)
        {
            continue;
        }
        if let Some(snapshot) = d["snapshot_id"].as_str() {
            let cohort = coverage
                .iter()
                .filter(|c| {
                    c.connection_id == r.connection_id
                        && s(&c.data, "capability") == "stock"
                        && s(&c.data, "entity_scope") == item
                        && c.data["stock_snapshot_id"].is_string()
                })
                .max_by_key(|c| (&c.occurred_at, &c.id));
            if cohort.is_none() {
                ctx.gap("stock.snapshot_cohort");
                continue;
            }
            if s(&cohort.unwrap().data, "stock_snapshot_id") != snapshot {
                continue;
            }
            // Actual missing fields block availability; scan limitations are returned separately.
            for field in array(&cohort.unwrap().data, "missing_fields") {
                if let Some(field) = field.as_str() {
                    ctx.gap(field);
                }
            }
        }
        if !scopes.insert((
            item.to_owned(),
            s(d, "location_id").to_owned(),
            unit.to_owned(),
        )) {
            ctx.conflicts.insert("overlapping_stock_authority".into());
            continue;
        }
        let value = match s(d, "basis") {
            "provider_available" => {
                if d["available"].is_string() {
                    q(d, "available")?
                } else {
                    ctx.gap("stock.available");
                    continue;
                }
            }
            "disjoint_physical" => {
                let fields = [
                    "physical",
                    "committed",
                    "reserved",
                    "damaged",
                    "quality_control",
                    "safety_stock",
                ];
                if fields.iter().any(|f| !d[f].is_string()) {
                    ctx.gap("stock.disjoint_states");
                    continue;
                }
                let mut v = q(d, "physical")?;
                for f in &fields[1..] {
                    v = sub(v, q(d, f)?)?;
                }
                v
            }
            _ => {
                ctx.gap("stock.basis");
                continue;
            }
        };
        if value < 0 {
            ctx.conflicts.insert("negative_available_stock".into());
        }
        let key = (item.to_owned(), unit.to_owned());
        totals.insert(key.clone(), add(*totals.get(&key).unwrap_or(&0), value)?);
    }
    Ok(totals)
}
pub(crate) fn shipment_qty(
    shipments: &[&Record],
    order: &str,
    line: &str,
    unit: &str,
    delivered: bool,
    as_of: &str,
) -> Result<i64, String> {
    let mut total = 0;
    for r in shipments.iter().filter(|r| {
        s(&r.data, "order_id") == order
            && shipment_progress(r, as_of).is_ok_and(|(hand, delivery)| {
                if delivered {
                    delivery == Some(true)
                } else {
                    hand == Some(true)
                }
            })
    }) {
        for l in array(&r.data, "lines")
            .iter()
            .filter(|l| s(l, "line_id") == line && s(l, "unit") == unit)
        {
            total = add(total, q(l, "quantity")?)?;
        }
    }
    Ok(total)
}
fn latest_scan<'a>(tracking: &[&'a Record], shipment: &str, as_of: &str) -> Option<&'a Record> {
    tracking
        .iter()
        .copied()
        .filter(|t| {
            s(&t.data, "shipment_id") == shipment
                && chrono::DateTime::parse_from_rfc3339(s(&t.data, "scan_at"))
                    .ok()
                    .zip(chrono::DateTime::parse_from_rfc3339(as_of).ok())
                    .is_some_and(|(scan, at)| scan <= at)
        })
        .max_by_key(|r| seconds(s(&r.data, "scan_at")).unwrap_or(0))
}
pub fn query(ctx: &mut Context<'_>) -> Result<Vec<Value>, String> {
    let intent = ctx.request.intent.as_str();
    let mut out = vec![];
    let orders = ctx.rows("orders");
    let shipments = ctx.rows("fulfillments");
    let allocations = ctx.rows("allocations");
    let tracking = ctx.rows("tracking");
    match intent {
        "inventory.available_to_sell" => {
            let stock = stock(ctx)?;
            let requested = micros(ctx.request.requested_quantity.as_deref().unwrap_or("1"))?;
            for ((item, unit), available) in stock {
                out.push(json!({"id":item,"unit":unit,"available":decimal(available),"requested":decimal(requested),"shortfall":decimal(sub(requested,available)?.max(0)),"incoming_counted_as_stock":false}));
            }
        }
        "orders.fulfillable" => {
            let mut free = stock(ctx)?;
            let policy = ctx.policy("priority");
            if let Some(policy) = policy {
                let method = s(&policy.data, "priority_method");
                if method.is_empty() {
                    ctx.gap("policy.priority_method");
                    return Ok(out);
                }
                let mut candidates: Vec<_> = orders
                    .into_iter()
                    .filter(|r| s(&r.data, "status") == "open" && ctx.scoped(r))
                    .collect();
                if method == "explicit_order" {
                    let ids = array(&policy.data, "priority_order");
                    if candidates
                        .iter()
                        .any(|r| !ids.iter().any(|id| id.as_str() == Some(&r.id)))
                    {
                        ctx.gap("policy.priority_order");
                        return Ok(out);
                    }
                    candidates
                        .sort_by_key(|r| ids.iter().position(|id| id.as_str() == Some(&r.id)));
                } else {
                    candidates.sort_by_key(|r| (s(&r.data, "created_at"), &r.id));
                }
                for order in candidates {
                    let mut lines = vec![];
                    let mut complete = true;
                    for line in array(&order.data, "lines") {
                        let line_id = s(line, "line_id");
                        let unit = s(line, "unit");
                        let key = (s(line, "item_id").to_owned(), unit.to_owned());
                        let remaining = sub(
                            sub(q(line, "quantity")?, q(line, "cancelled_quantity")?)?,
                            shipment_qty(
                                &shipments,
                                &order.id,
                                line_id,
                                unit,
                                false,
                                &ctx.request.as_of,
                            )?,
                        )?
                        .max(0);
                        let owned = allocations
                            .iter()
                            .filter(|a| {
                                s(&a.data, "order_id") == order.id
                                    && s(&a.data, "line_id") == line_id
                                    && s(&a.data, "unit") == unit
                                    && s(&a.data, "status") == "active"
                                    && s(&a.data, "basis") == "observed_reservation"
                            })
                            .try_fold(0, |v, a| add(v, q(&a.data, "quantity")?))?;
                        let from_own = owned.min(remaining);
                        let need = sub(remaining, from_own)?;
                        let available = free.get(&key).copied();
                        if available.is_none() {
                            ctx.gap("stock.item_location_coverage");
                        }
                        let taken = need.min(available.unwrap_or(0).max(0));
                        free.insert(key, sub(available.unwrap_or(0), taken)?);
                        let planned = add(from_own, taken)?;
                        complete &= planned == remaining;
                        lines.push(json!({"line_id":line_id,"unit":unit,"required":decimal(remaining),"allocated":decimal(planned),"from_owned_reservation":decimal(from_own),"from_free_stock":decimal(taken)}));
                    }
                    out.push(json!({"id":order.id,"state":if complete{"fully_fulfillable"}else{"partial"},"lines":lines,"provisional_plan":true,"stock_mutated":false}));
                }
            }
        }
        "orders.reservation_variance" | "orders.partial_delivery_gaps" => {
            let selected: Vec<_> = orders.into_iter().filter(|r| ctx.scoped(r)).collect();
            for order in selected {
                for line in array(&order.data, "lines") {
                    let line_id = s(line, "line_id");
                    let unit = s(line, "unit");
                    let accepted = sub(q(line, "quantity")?, q(line, "cancelled_quantity")?)?;
                    let dispatch = shipment_qty(
                        &shipments,
                        &order.id,
                        line_id,
                        unit,
                        false,
                        &ctx.request.as_of,
                    )?;
                    let delivered = shipment_qty(
                        &shipments,
                        &order.id,
                        line_id,
                        unit,
                        true,
                        &ctx.request.as_of,
                    )?;
                    let remaining = sub(accepted, dispatch)?.max(0);
                    if intent == "orders.partial_delivery_gaps" {
                        out.push(json!({"id":format!("{}:{}",order.id,line_id),"order_id":order.id,"line_id":line_id,"unit":unit,"remaining_to_dispatch":decimal(remaining),"remaining_to_deliver":decimal(sub(accepted,delivered)?.max(0))}));
                    } else {
                        let reserved = allocations
                            .iter()
                            .filter(|a| {
                                s(&a.data, "order_id") == order.id
                                    && s(&a.data, "line_id") == line_id
                                    && s(&a.data, "unit") == unit
                                    && s(&a.data, "status") == "active"
                                    && s(&a.data, "basis") == "observed_reservation"
                            })
                            .try_fold(0, |v, a| add(v, q(&a.data, "quantity")?))?;
                        out.push(json!({"id":format!("{}:{}",order.id,line_id),"order_id":order.id,"line_id":line_id,"unit":unit,"remaining_obligation":decimal(remaining),"active_reserved":decimal(reserved),"under_reserved":decimal(sub(remaining,reserved)?.max(0)),"over_reserved":decimal(sub(reserved,remaining)?.max(0))}));
                    }
                }
            }
        }
        "orders.inbound_delay_impact" => {
            let supplies = ctx.rows("supply");
            let promises = ctx.rows("promises");
            for a in allocations
                .iter()
                .filter(|a| s(&a.data, "status") == "active" && ctx.scoped(a))
            {
                if let Some(supply) = supplies.iter().find(|r| r.id == s(&a.data, "supply_id")) {
                    for promise in promises.iter().filter(|p| {
                        s(&p.data, "order_id") == s(&a.data, "order_id")
                            && s(&p.data, "promise_kind") == "customer_delivery"
                    }) {
                        if seconds(s(&supply.data, "promised_at"))?
                            > seconds(s(&promise.data, "promised_at"))?
                        {
                            out.push(json!({"id":s(&a.data,"order_id"),"supply_id":supply.id,"customer_due":promise.data["promised_at"],"supply_after":supply.data["promised_at"],"risk":"incoming_after_customer_deadline"}));
                        }
                    }
                }
            }
        }
        "shipments.attention" => {
            let policy = ctx.policy("attention");
            let selected: Vec<_> = shipments.into_iter().filter(|r| ctx.scoped(r)).collect();
            for shipment in selected {
                if let Some(scan) = latest_scan(&tracking, &shipment.id, &ctx.request.as_of) {
                    let age = sub(
                        seconds(&ctx.request.as_of)?,
                        seconds(s(&scan.data, "scan_at"))?,
                    )?
                    .max(0);
                    let attention = policy.is_some_and(|p| {
                        p.data["exceptions_require_attention"] == true
                            && s(&scan.data, "status") == "exception"
                            || p.data["stale_after_seconds"]
                                .as_i64()
                                .is_some_and(|v| age > v)
                                && s(&scan.data, "status") != "delivered"
                    });
                    out.push(json!({"id":shipment.id,"status":scan.data["status"],"forecast_at":scan.data["forecast_at"],"latest_scan_age_seconds":age,"attention":attention,"stale_is_not_failure":true}));
                } else {
                    ctx.gap("tracking.scan");
                }
            }
        }
        "shipments.promise_risk" => {
            ctx.policy("attention");
            let promises = ctx.rows("promises");
            for promise in promises
                .into_iter()
                .filter(|r| ctx.scoped(r) && s(&r.data, "promise_kind") == "customer_delivery")
            {
                let relevant: Vec<_> = shipments
                    .iter()
                    .filter(|r| s(&r.data, "order_id") == s(&promise.data, "order_id"))
                    .collect();
                let progress: Vec<_> = relevant
                    .iter()
                    .map(|r| shipment_progress(r, &ctx.request.as_of))
                    .collect::<Result<_, _>>()?;
                let delivered = if progress.iter().any(|(_, d)| d.is_none()) {
                    None
                } else {
                    Some(!progress.is_empty() && progress.iter().all(|(_, d)| *d == Some(true)))
                };
                out.push(json!({"id":promise.id,"order_id":promise.data["order_id"],"promised_at":promise.data["promised_at"],"overdue":delivered!=Some(true)&&seconds(s(&promise.data,"promised_at"))?<seconds(&ctx.request.as_of)?,"delivered":delivered,"arrival_date":"unknown"}));
            }
            if out.is_empty() {
                ctx.gap("promises.promised_at");
            }
        }
        "customer.delivery_reply" => {
            let communications = ctx.rows("communications");
            let known = !ctx.missing.contains("communications.coverage");
            for order in orders.into_iter().filter(|r| ctx.scoped(r)) {
                let mut facts = BTreeSet::new();
                for ship in shipments
                    .iter()
                    .filter(|r| s(&r.data, "order_id") == order.id)
                {
                    if let Some(scan) = latest_scan(&tracking, &ship.id, &ctx.request.as_of) {
                        facts.insert(s(&scan.data, "status").to_owned());
                        if scan.data["forecast_at"].is_null() {
                            facts.insert("arrival_unknown".into());
                        }
                    }
                }
                out.push(json!({"id":order.id,"facts":facts,"prior_promises_checked":known,"communication_count":communications.iter().filter(|r|s(&r.data,"order_id")==order.id).count(),"send_action":false}));
            }
        }
        _ => return Err("unsupported_intent".into()),
    }
    Ok(out)
}
