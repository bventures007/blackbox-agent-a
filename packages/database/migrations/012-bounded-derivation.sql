-- Operational quarantine never alters or acknowledges immutable business inputs.
ALTER TABLE bb.outbox ADD COLUMN error_code text CHECK(error_code IN ('unsupported_event','unsupported_event_version','reducer_conflict','entity_history_too_large','derivation_retry_exhausted'));
ALTER TABLE bb.outbox ADD COLUMN failed_at timestamptz;
ALTER TABLE bb.outbox ADD CONSTRAINT outbox_state CHECK(state IN ('pending','applied','quarantined'));
CREATE UNIQUE INDEX one_derivation_review ON bb.review_cases(tenant_id,entry_id) WHERE kind='derivation_failed';
-- Preserve exhausted legacy work as an explicit review; do not silently reset its budget.
UPDATE bb.outbox SET state='quarantined',error_code='derivation_retry_exhausted',failed_at=now() WHERE state='pending' AND attempts>=8;
INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,entry_id,evidence_id,kind)
 SELECT j.tenant_id,gen_random_uuid(),j.connection_id,j.entry_id,j.evidence_id,'derivation_failed'
 FROM bb.outbox o JOIN bb.journal j USING(tenant_id,sequence) WHERE o.state='quarantined';
ALTER TABLE bb.outbox ADD CONSTRAINT outbox_attempt_budget CHECK(attempts>=0 AND (state<>'pending' OR attempts<8));
ALTER TABLE bb.outbox ADD CONSTRAINT outbox_quarantine_detail CHECK((state='quarantined')=(error_code IS NOT NULL AND failed_at IS NOT NULL));
CREATE INDEX outbox_due ON bb.outbox(tenant_id,next_at,sequence) WHERE state='pending';
-- Only the owner decision service resets a specific quarantined input. RLS still applies.
GRANT UPDATE(state,attempts,next_at,error_code,failed_at) ON bb.outbox TO bb_api;
ALTER TABLE bb.projection_builds DROP CONSTRAINT projection_builds_error_code_check;
ALTER TABLE bb.projection_builds ADD CONSTRAINT projection_builds_error_code_check CHECK(error_code IN ('source_generation_changed','unsupported_event','unsupported_event_version','entity_history_too_large','reducer_conflict','candidate_corrupt','candidate_incomplete','build_budget_exceeded'));
UPDATE bb.runtime_contract SET contract=contract||'{"input_reader":2,"outbox_processing":2}'::jsonb,changed_at=now();

-- An indexed admission guard prevents pre-reader projections from hiding unknown
-- durable kinds/datasets/versions. This is a format boundary, not a business rule.
CREATE FUNCTION bb.input_header_supported_v2(version integer,event text,entity uuid,payload jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT coalesce(version=1 AND event=payload->>'kind' AND entity::text=payload->>'entity_id' AND
 CASE WHEN payload->'record' IS NULL OR payload->'record'='null'::jsonb THEN event=ANY(ARRAY[
 'order.accepted','order.revised','payment.authorized','payment.captured','payment.failed','payment.voided','refund.completed','refund.pending','inventory.snapshot','inventory.reserved','inventory.reservation_released','invoice.issued','invoice.credit_issued','invoice.payment_marked','payment.fee_booked','shipment.dispatched','shipment.delivered','return.approved','return.received','return.restocked','payout.announced','payout.sent','payout.failed','payout.reversed','bank.credit_booked'])
 ELSE event=CASE payload->'record'->>'dataset'
 WHEN 'orders' THEN CASE payload->'record'->>'status' WHEN 'cancelled' THEN 'order.cancelled' WHEN 'open' THEN 'order.revised' WHEN 'closed' THEN 'order.revised' END
 WHEN 'stock' THEN 'inventory.snapshot' WHEN 'allocations' THEN 'allocation.revised'
 WHEN 'supply' THEN 'supply.commitment_recorded' WHEN 'promises' THEN 'customer.commitment_recorded'
 WHEN 'fulfillments' THEN 'shipment.observed' WHEN 'tracking' THEN 'carrier.scan_observed'
 WHEN 'communications' THEN 'communication.observed'
 WHEN 'invoices' THEN CASE payload->'record'->>'kind' WHEN 'credit' THEN 'invoice.credit_issued' WHEN 'invoice' THEN 'invoice.revised' END
 WHEN 'invoice_dispatch' THEN 'invoice.dispatch_observed'
 WHEN 'payments' THEN CASE WHEN payload->'record'->>'status'=ANY(ARRAY['authorized','captured','failed','voided']) THEN 'payment.'||(payload->'record'->>'status') END
 WHEN 'payouts' THEN CASE WHEN payload->'record'->>'status'=ANY(ARRAY['announced','sent','failed','reversed']) THEN 'payout.'||(payload->'record'->>'status') END
 WHEN 'refunds' THEN CASE WHEN payload->'record'->>'status'=ANY(ARRAY['pending','completed','failed','reversed']) THEN 'refund.'||(payload->'record'->>'status') END
 WHEN 'payment_allocations' THEN 'payment.allocation_recorded' WHEN 'policy' THEN 'business.rule_recorded'
 WHEN 'cases' THEN 'business.case_recorded' WHEN 'provider_ledger' THEN 'provider.ledger_posted'
 WHEN 'positions' THEN 'provider.balance_observed' WHEN 'bank' THEN 'bank.credit_booked'
 WHEN 'holds' THEN CASE payload->'record'->>'state' WHEN 'released' THEN 'provider.hold_released' WHEN 'active' THEN 'provider.hold_recorded' END
 WHEN 'returns' THEN 'return.revised' WHEN 'receipts' THEN 'return.disposition_observed'
 WHEN 'entitlements' THEN 'refund.entitlement_recorded' WHEN 'disputes' THEN 'dispute.opened'
 WHEN 'coverage' THEN 'coverage.observed' WHEN 'identity' THEN 'entity.link_recorded' END END,false)
$$;
CREATE INDEX unreadable_source_v2 ON bb.journal(tenant_id,sequence,entity_id)
 WHERE record_type='source' AND NOT bb.input_header_supported_v2(schema_version,event_type,entity_id,payload);
