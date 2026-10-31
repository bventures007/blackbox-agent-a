-- Deny incomplete provenance even if the wall clock moves behind receipt time.
-- This identity boundary is independent of timestamp-based expiry.
CREATE OR REPLACE VIEW bb.evidence_retention WITH (security_invoker=true) AS
SELECT e.*,x.connection_id,coalesce(x.evidence_class,'legacy_unclassified') evidence_class,
 v.effective_expires_at,
 r.reason restriction_reason,r.restricted_at,d.disposed_at,
 (x.connection_id IS NOT NULL AND x.evidence_class<>'legacy_unclassified' AND v.effective_expires_at>now() AND r.evidence_id IS NULL) retained,
 (x.connection_id IS NOT NULL AND x.evidence_class<>'legacy_unclassified' AND v.effective_expires_at>now() AND r.evidence_id IS NULL AND NOT EXISTS(
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

