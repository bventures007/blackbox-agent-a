-- Raw-content policy is separate from immutable replay facts. No journal rewrite.
CREATE TABLE bb.evidence_context (
 tenant_id uuid NOT NULL, evidence_id uuid NOT NULL, connection_id uuid,
 evidence_class text NOT NULL CHECK(evidence_class IN ('provider_response','typed_submission','imported_document','owner_assertion','legacy_unclassified')),
 PRIMARY KEY(tenant_id,evidence_id),
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence,
 FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections
);
-- Old duplicate-only batches may have no journal association. Do not invent one.
INSERT INTO bb.evidence_context
SELECT e.tenant_id,e.evidence_id,c.connection_id,
 CASE WHEN c.connection_id IS NULL THEN 'legacy_unclassified'
 WHEN c.owner_assertion THEN 'owner_assertion'
 WHEN s.provider='shopify' THEN 'provider_response' ELSE 'typed_submission' END
FROM bb.evidence e LEFT JOIN LATERAL (
 SELECT min(j.connection_id::text)::uuid connection_id,bool_and(j.rule_version='owner-decision-v1') owner_assertion
 FROM bb.journal j WHERE j.tenant_id=e.tenant_id AND j.evidence_id=e.evidence_id AND j.record_type='source'
 HAVING count(DISTINCT j.connection_id)=1
) c ON true LEFT JOIN bb.connections s ON s.tenant_id=e.tenant_id AND s.connection_id=c.connection_id;

CREATE TABLE bb.evidence_policies (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, policy_id uuid NOT NULL,
 connection_id uuid, evidence_class text,
 days integer NOT NULL CHECK(days BETWEEN 1 AND 3650),
 principal_id uuid NOT NULL, reason text NOT NULL CHECK(reason IN ('business_requirement','minimize_content','default_policy','restore_reconciliation')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,policy_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 CHECK(evidence_class IS NULL OR evidence_class IN ('provider_response','typed_submission','imported_document','owner_assertion','legacy_unclassified'))
);
CREATE INDEX evidence_policy_scope ON bb.evidence_policies(tenant_id,connection_id,evidence_class,created_at DESC);
-- Only host/provider integration authority may set a ceiling, never the owner settings route.
CREATE TABLE bb.evidence_provider_limits (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, limit_id uuid NOT NULL,
 connection_id uuid NOT NULL, evidence_class text NOT NULL,
 days integer NOT NULL CHECK(days BETWEEN 1 AND 3650),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,limit_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 CHECK(evidence_class IN ('provider_response','typed_submission','imported_document','owner_assertion','legacy_unclassified'))
);
CREATE INDEX evidence_limit_scope ON bb.evidence_provider_limits(tenant_id,connection_id,evidence_class);
CREATE TABLE bb.evidence_restrictions (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, evidence_id uuid NOT NULL,
 restriction_id uuid NOT NULL, principal_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('expired','owner_restriction','provider_restriction','restored_ledger')),
 restricted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,evidence_id), UNIQUE(tenant_id,restriction_id)
 -- No evidence FK: a newer ledger can cover content absent from an older backup.
);
CREATE TABLE bb.evidence_disposals (
 tenant_id uuid NOT NULL, evidence_id uuid NOT NULL, disposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 outcome text NOT NULL CHECK(outcome IN ('removed','already_absent')),
 PRIMARY KEY(tenant_id,evidence_id), FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence_restrictions
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['evidence_context','evidence_policies','evidence_provider_limits','evidence_restrictions','evidence_disposals'] LOOP
 EXECUTE format('ALTER TABLE bb.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE bb.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON bb.%I USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant())',n);
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON bb.%I FOR EACH ROW EXECUTE FUNCTION bb.immutable()',n);
 EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON bb.%I FOR EACH STATEMENT EXECUTE FUNCTION bb.immutable()',n);
 END LOOP;
END $$;
GRANT SELECT ON bb.evidence_context,bb.evidence_policies,bb.evidence_provider_limits,bb.evidence_restrictions,bb.evidence_disposals TO bb_runtime;
GRANT INSERT ON bb.evidence_context TO bb_api,bb_worker;
GRANT INSERT ON bb.evidence_policies,bb.evidence_restrictions TO bb_api;

CREATE FUNCTION bb.evidence_policy_days(t uuid,c uuid,k text) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT least(coalesce((SELECT p.days FROM bb.evidence_policies p WHERE p.tenant_id=t
 AND (p.connection_id IS NULL OR p.connection_id=c) AND (p.evidence_class IS NULL OR p.evidence_class=k)
 ORDER BY (p.connection_id IS NOT NULL)::integer+(p.evidence_class IS NOT NULL)::integer DESC,
 (p.connection_id IS NOT NULL) DESC,p.created_at DESC,p.policy_id DESC LIMIT 1),90),
 coalesce((SELECT min(l.days) FROM bb.evidence_provider_limits l WHERE l.tenant_id=t AND l.connection_id=c AND l.evidence_class=k),3650))
$$;
REVOKE ALL ON FUNCTION bb.evidence_policy_days(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bb.evidence_policy_days(uuid,uuid,text) TO bb_runtime;

-- A later shorter policy is permanent for existing content, even if later extended.
-- Longer policies affect future receipts only. Provider ceilings always win.
CREATE VIEW bb.evidence_retention WITH (security_invoker=true) AS
SELECT e.*,x.connection_id,coalesce(x.evidence_class,'legacy_unclassified') evidence_class,
 v.effective_expires_at,
 r.reason restriction_reason,r.restricted_at,d.disposed_at,
 (v.effective_expires_at>now() AND r.evidence_id IS NULL) retained,
 (v.effective_expires_at>now() AND r.evidence_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM bb.recovery_guards g WHERE g.tenant_id=e.tenant_id AND g.evidence_blocked)) accessible
FROM bb.evidence e LEFT JOIN bb.evidence_context x USING(tenant_id,evidence_id)
LEFT JOIN bb.evidence_restrictions r USING(tenant_id,evidence_id)
LEFT JOIN bb.evidence_disposals d USING(tenant_id,evidence_id)
CROSS JOIN LATERAL (SELECT least(e.expires_at,
 e.created_at+make_interval(days=>coalesce((SELECT min(p.days) FROM bb.evidence_policies p
 WHERE p.tenant_id=e.tenant_id AND p.created_at>=e.created_at
 AND (p.connection_id IS NULL OR p.connection_id=x.connection_id)
 AND (p.evidence_class IS NULL OR p.evidence_class=coalesce(x.evidence_class,'legacy_unclassified'))),3650)),
 e.created_at+make_interval(days=>coalesce((SELECT min(l.days) FROM bb.evidence_provider_limits l
 WHERE l.tenant_id=e.tenant_id AND l.connection_id=x.connection_id AND l.evidence_class=x.evidence_class),3650))) effective_expires_at) v;
GRANT SELECT ON bb.evidence_retention TO bb_runtime;
