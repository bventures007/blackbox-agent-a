-- Incomplete provenance cannot establish a provider/class retention entitlement.
-- Canonical history/context remain immutable; the existing shared cleanup path audits disposal.
CREATE OR REPLACE VIEW bb.evidence_retention WITH (security_invoker=true) AS
SELECT e.*,x.connection_id,coalesce(x.evidence_class,'legacy_unclassified') evidence_class,
 v.effective_expires_at,
 r.reason restriction_reason,r.restricted_at,d.disposed_at,
 (v.effective_expires_at>now() AND r.evidence_id IS NULL) retained,
 (v.effective_expires_at>now() AND r.evidence_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM bb.recovery_guards g WHERE g.tenant_id=e.tenant_id AND g.evidence_blocked)) accessible
FROM bb.evidence e LEFT JOIN bb.evidence_context x USING(tenant_id,evidence_id)
LEFT JOIN bb.evidence_restrictions r USING(tenant_id,evidence_id)
LEFT JOIN bb.evidence_disposals d USING(tenant_id,evidence_id)
CROSS JOIN LATERAL (SELECT least(CASE WHEN x.connection_id IS NULL OR x.evidence_class='legacy_unclassified' THEN e.created_at ELSE e.expires_at END,
 e.created_at+make_interval(days=>coalesce((SELECT min(p.days) FROM bb.evidence_policies p
 WHERE p.tenant_id=e.tenant_id AND p.created_at>=e.created_at
 AND (p.connection_id IS NULL OR p.connection_id=x.connection_id)
 AND (p.evidence_class IS NULL OR p.evidence_class=coalesce(x.evidence_class,'legacy_unclassified'))),3650)),
 e.created_at+make_interval(days=>coalesce((SELECT min(l.days) FROM bb.evidence_provider_limits l
 WHERE l.tenant_id=e.tenant_id AND l.connection_id=x.connection_id AND l.evidence_class=x.evidence_class),3650))) effective_expires_at) v;

-- Legacy plaintext cursors are discarded, never copied into canonical or audit rows.
-- Pending jobs enumerate again at their original fixed scope; ingestion stays idempotent.
INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)
SELECT tenant_id,gen_random_uuid(),'00000000-0000-0000-0000-000000000000','source.legacy_cursor_discarded'
FROM bb.source_jobs WHERE checkpoint->>'after' IS NOT NULL;
UPDATE bb.source_jobs SET checkpoint=(checkpoint-'sealed_after')||jsonb_build_object('after',NULL,'pages',0),
 state=CASE WHEN state='running' THEN 'queued' ELSE state END,
 fence=fence+1,lease_owner=NULL,leased_until=NULL,updated_at=now()
WHERE checkpoint->>'after' IS NOT NULL;
UPDATE bb.import_runs SET cursor=NULL WHERE cursor IS NOT NULL;
ALTER TABLE bb.source_jobs ADD CONSTRAINT source_cursor_not_plaintext CHECK(checkpoint->>'after' IS NULL);
ALTER TABLE bb.import_runs ADD CONSTRAINT import_cursor_not_plaintext CHECK(cursor IS NULL);
UPDATE bb.runtime_contract SET contract=contract||'{"source_checkpoint":2}'::jsonb,changed_at=now();
