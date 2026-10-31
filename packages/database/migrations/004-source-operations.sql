-- Source plans are append-only. Schedules, protected credentials and logical cohorts are operational state.
ALTER TABLE bb.workspaces ADD COLUMN suggested_history_from timestamptz, ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
GRANT UPDATE(suggested_history_from,timezone) ON bb.workspaces TO bb_api;
CREATE TABLE bb.import_plans (
 tenant_id uuid NOT NULL, plan_id uuid NOT NULL, connection_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), selected_by uuid NOT NULL,
 selected_at timestamptz NOT NULL DEFAULT now(), parameters jsonb NOT NULL,
 capabilities text[] NOT NULL, provider_revision text NOT NULL,
 PRIMARY KEY(tenant_id,plan_id), UNIQUE(tenant_id,connection_id,revision),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections
);
CREATE TRIGGER immutable_plan BEFORE UPDATE OR DELETE ON bb.import_plans FOR EACH ROW EXECUTE FUNCTION bb.immutable();
CREATE TRIGGER immutable_plan_table BEFORE TRUNCATE ON bb.import_plans FOR EACH STATEMENT EXECUTE FUNCTION bb.immutable();
CREATE TABLE bb.source_secrets (
 tenant_id uuid NOT NULL, connection_id uuid NOT NULL, key_version text NOT NULL,
 sealed jsonb NOT NULL, scopes text[] NOT NULL DEFAULT '{}', validated_at timestamptz NOT NULL,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connection_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections
);
CREATE TABLE bb.source_jobs (
 tenant_id uuid NOT NULL, job_id uuid NOT NULL, connection_id uuid NOT NULL, plan_id uuid NOT NULL,
 capability text NOT NULL, kind text NOT NULL CHECK(kind IN ('initial','incremental','reconciliation','history_expansion')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','paused','complete','complete_with_gaps','failed','cancelled','reauthorization_required')),
 phase text NOT NULL DEFAULT 'check_connection', run_id uuid NOT NULL,
 next_at timestamptz NOT NULL DEFAULT now(), lease_owner uuid, leased_until timestamptz,
 fence bigint NOT NULL DEFAULT 0, checkpoint jsonb NOT NULL DEFAULT '{}',
 attempts integer NOT NULL DEFAULT 0, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(tenant_id,job_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 FOREIGN KEY(tenant_id,plan_id) REFERENCES bb.import_plans, FOREIGN KEY(tenant_id,run_id) REFERENCES bb.import_runs
);
CREATE INDEX source_jobs_due ON bb.source_jobs(next_at,tenant_id) WHERE state IN ('queued','running');
CREATE UNIQUE INDEX one_running_source_capability ON bb.source_jobs(tenant_id,connection_id,capability) WHERE state='running';
CREATE TABLE bb.import_objects (
 tenant_id uuid NOT NULL, run_id uuid NOT NULL, object_id uuid NOT NULL, dataset text NOT NULL,
 state text NOT NULL CHECK(state IN ('fetched','committed','duplicate','skipped','quarantined')),
 emitted_entries integer NOT NULL DEFAULT 0, required_cursor bigint,
 evidence_id uuid, error_code text, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,run_id,object_id), FOREIGN KEY(tenant_id,run_id) REFERENCES bb.import_runs,
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence
);
CREATE INDEX import_objects_readiness ON bb.import_objects(tenant_id,run_id,required_cursor);
CREATE TABLE bb.source_health (
 tenant_id uuid NOT NULL, connection_id uuid NOT NULL, capability text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(), collection_state text NOT NULL DEFAULT 'configured',
 last_attempt_at timestamptz, last_success_at timestamptz, last_new_at timestamptz,
 last_reconciliation_at timestamptz, next_poll_at timestamptz, next_reconciliation_at timestamptz,
 poll_seconds integer NOT NULL CHECK(poll_seconds BETWEEN 15 AND 86400),
 reconciliation_seconds integer NOT NULL CHECK(reconciliation_seconds BETWEEN 60 AND 604800),
 coverage jsonb NOT NULL DEFAULT '{}', error_code text, next_action text,
 PRIMARY KEY(tenant_id,connection_id,capability), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections
);
CREATE TABLE bb.source_checks (
 tenant_id uuid NOT NULL, check_id uuid NOT NULL, connection_id uuid NOT NULL, capability text NOT NULL,
 run_id uuid NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(), scope jsonb NOT NULL,
 outcome text NOT NULL, committed_cursor bigint NOT NULL,
 PRIMARY KEY(tenant_id,check_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 FOREIGN KEY(tenant_id,run_id) REFERENCES bb.import_runs
);
CREATE TRIGGER immutable_source_check BEFORE UPDATE OR DELETE ON bb.source_checks FOR EACH ROW EXECUTE FUNCTION bb.immutable();
CREATE TRIGGER immutable_source_check_table BEFORE TRUNCATE ON bb.source_checks FOR EACH STATEMENT EXECUTE FUNCTION bb.immutable();
ALTER TABLE bb.import_runs ADD COLUMN plan_id uuid, ADD COLUMN kind text NOT NULL DEFAULT 'initial',
 ADD COLUMN phase text NOT NULL DEFAULT 'import_records', ADD COLUMN started_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN completed_at timestamptz, ADD COLUMN error_code text, ADD COLUMN next_action text,
 ADD FOREIGN KEY(tenant_id,plan_id) REFERENCES bb.import_plans;
ALTER TABLE bb.review_cases ADD COLUMN evidence_id uuid, ADD COLUMN run_id uuid, ADD COLUMN object_id uuid,
 ADD FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence,
 ADD FOREIGN KEY(tenant_id,run_id) REFERENCES bb.import_runs;
CREATE UNIQUE INDEX import_review_identity ON bb.review_cases(tenant_id,run_id,object_id,kind) WHERE run_id IS NOT NULL;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['import_plans','source_secrets','source_jobs','import_objects','source_health','source_checks'] LOOP
 EXECUTE format('ALTER TABLE bb.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE bb.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON bb.%I USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant())',n);
 END LOOP;
END $$;
GRANT SELECT ON bb.import_plans,bb.source_jobs,bb.import_objects,bb.source_health TO bb_runtime;
GRANT SELECT ON bb.source_checks TO bb_runtime;
GRANT INSERT ON bb.source_checks TO bb_worker;
GRANT UPDATE(state,config) ON bb.connections TO bb_worker;
GRANT SELECT,INSERT,UPDATE ON bb.source_secrets TO bb_api,bb_worker;
GRANT INSERT ON bb.import_plans TO bb_api;
GRANT INSERT,UPDATE ON bb.source_jobs,bb.import_objects,bb.source_health TO bb_api,bb_worker;
CREATE FUNCTION bb.pending_source_tenants() RETURNS TABLE(tenant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bb AS $$
 SELECT DISTINCT j.tenant_id FROM bb.source_jobs j JOIN bb.connections c USING(tenant_id,connection_id)
 WHERE j.state IN ('queued','running') AND j.next_at<=clock_timestamp()
 AND (j.leased_until IS NULL OR j.leased_until<clock_timestamp()) AND c.state NOT IN ('paused','disconnected','reauthorization_required') LIMIT 50
$$;
REVOKE ALL ON FUNCTION bb.pending_source_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bb.pending_source_tenants() TO bb_worker;
