-- Host recovery authority only. No business facts are rewritten by this guard.
CREATE TABLE bb.recovery_guards (
 tenant_id uuid PRIMARY KEY REFERENCES bb.workspaces,
 restored_at timestamptz NOT NULL DEFAULT now(),
 evidence_blocked boolean NOT NULL DEFAULT true,
 sources_blocked boolean NOT NULL DEFAULT true,
 policy_reconciled_at timestamptz,
 sources_reconciled_at timestamptz
);
ALTER TABLE bb.recovery_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bb.recovery_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON bb.recovery_guards USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant());
GRANT SELECT ON bb.recovery_guards TO bb_runtime;
CREATE OR REPLACE FUNCTION bb.pending_source_tenants() RETURNS TABLE(tenant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bb AS $$
 SELECT DISTINCT j.tenant_id FROM bb.source_jobs j JOIN bb.connections c USING(tenant_id,connection_id)
 WHERE j.state IN ('queued','running') AND j.next_at<=clock_timestamp()
 AND (j.leased_until IS NULL OR j.leased_until<clock_timestamp())
 AND c.state NOT IN ('paused','disconnected','reauthorization_required')
 AND NOT EXISTS(SELECT 1 FROM bb.recovery_guards g WHERE g.tenant_id=j.tenant_id AND g.sources_blocked)
 LIMIT 50
$$;
REVOKE ALL ON FUNCTION bb.pending_source_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bb.pending_source_tenants() TO bb_worker;
