-- Applied only by the installation migration identity, never a runtime service.
CREATE SCHEMA bb;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE ROLE bb_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE bb_api LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'api_password';
CREATE ROLE bb_worker LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'worker_password';
CREATE ROLE bb_engine LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'engine_password';
GRANT bb_runtime TO bb_api, bb_worker, bb_engine;
GRANT USAGE ON SCHEMA bb TO bb_runtime;
CREATE FUNCTION bb.tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('bb.tenant_id',true),'')::uuid
$$;
CREATE TABLE bb.workspaces (tenant_id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE bb.credentials (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, credential_id uuid NOT NULL,
 principal_id uuid NOT NULL, purpose text NOT NULL CHECK(purpose IN ('owner','agent','producer','session')),
 verifier text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz, last_used_at timestamptz, idle_seconds integer,
 revoked_at timestamptz, PRIMARY KEY(tenant_id,credential_id)
);
CREATE UNIQUE INDEX one_owner ON bb.credentials(tenant_id) WHERE purpose='owner' AND revoked_at IS NULL;
CREATE TABLE bb.connections (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, connection_id uuid NOT NULL,
 provider text NOT NULL, account_anchor uuid NOT NULL,
 state text NOT NULL DEFAULT 'configured', config jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,connection_id)
);
CREATE TABLE bb.heads (tenant_id uuid PRIMARY KEY REFERENCES bb.workspaces, committed bigint NOT NULL DEFAULT 0, applied bigint NOT NULL DEFAULT 0);
CREATE TABLE bb.evidence (
 tenant_id uuid NOT NULL, evidence_id uuid NOT NULL, sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
 PRIMARY KEY(tenant_id,evidence_id), FOREIGN KEY(tenant_id) REFERENCES bb.workspaces
);
CREATE TABLE bb.journal (
 tenant_id uuid NOT NULL, sequence bigint NOT NULL, entry_id uuid NOT NULL,
 record_type text NOT NULL CHECK(record_type IN ('source','fact','commitment','movement','reservation')),
 record_id uuid NOT NULL, event_type text NOT NULL, schema_version integer NOT NULL CHECK(schema_version=1),
 connection_id uuid NOT NULL, entity_id uuid NOT NULL, provider_identity text NOT NULL,
 occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload jsonb NOT NULL, payload_hash text NOT NULL, evidence_id uuid NOT NULL,
 input_entry_id uuid, supersedes_entry_id uuid, rule_version text NOT NULL,
 correlation_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,sequence), UNIQUE(tenant_id,entry_id),
 UNIQUE(tenant_id,connection_id,provider_identity,record_type),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence,
 FOREIGN KEY(tenant_id,input_entry_id) REFERENCES bb.journal(tenant_id,entry_id),
 FOREIGN KEY(tenant_id,supersedes_entry_id) REFERENCES bb.journal(tenant_id,entry_id)
);
CREATE INDEX journal_entity ON bb.journal(tenant_id,entity_id,sequence);
CREATE INDEX journal_effective ON bb.journal(tenant_id,entity_id,occurred_at,sequence);
CREATE TABLE bb.outbox (
 tenant_id uuid NOT NULL, sequence bigint NOT NULL, entity_id uuid NOT NULL,
 attempts integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'pending',
 next_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,sequence),
 FOREIGN KEY(tenant_id,sequence) REFERENCES bb.journal
);
CREATE TABLE bb.projections (
 tenant_id uuid NOT NULL, entity_id uuid NOT NULL, applied bigint NOT NULL,
 rule_version text NOT NULL, state jsonb NOT NULL, checksum text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,entity_id)
);
CREATE TABLE bb.review_cases (
 tenant_id uuid NOT NULL, case_id uuid NOT NULL, connection_id uuid NOT NULL,
 entry_id uuid, kind text NOT NULL, revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,case_id), FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections,
 FOREIGN KEY(tenant_id,entry_id) REFERENCES bb.journal(tenant_id,entry_id)
);
CREATE TABLE bb.security_audit (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces, audit_id uuid NOT NULL,
 principal_id uuid NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,audit_id)
);
CREATE TABLE bb.import_runs (
 tenant_id uuid NOT NULL, run_id uuid NOT NULL, connection_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending', cursor text, fetched integer NOT NULL DEFAULT 0,
 committed integer NOT NULL DEFAULT 0, last_success_at timestamptz, last_new_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,run_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES bb.connections
);
CREATE FUNCTION bb.immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'immutable_record' USING ERRCODE='42501'; END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['workspaces','credentials','connections','heads','evidence','journal','outbox','projections','review_cases','security_audit','import_runs'] LOOP
 EXECUTE format('ALTER TABLE bb.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE bb.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON bb.%I USING (tenant_id=bb.tenant()) WITH CHECK (tenant_id=bb.tenant())',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['journal','evidence','security_audit'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON bb.%I FOR EACH ROW EXECUTE FUNCTION bb.immutable()',n);
 EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON bb.%I FOR EACH STATEMENT EXECUTE FUNCTION bb.immutable()',n);
 END LOOP;
END $$;
GRANT SELECT ON ALL TABLES IN SCHEMA bb TO bb_runtime;
GRANT INSERT ON bb.journal,bb.evidence,bb.security_audit TO bb_api,bb_worker,bb_engine;
GRANT INSERT,UPDATE ON bb.credentials,bb.connections,bb.heads,bb.review_cases,bb.import_runs TO bb_api;
GRANT INSERT,UPDATE ON bb.heads,bb.outbox,bb.review_cases,bb.import_runs TO bb_worker;
GRANT INSERT,UPDATE ON bb.heads,bb.projections,bb.outbox TO bb_engine;
GRANT INSERT ON bb.outbox TO bb_api;
-- Lookup is the sole pre-tenant credential boundary. Verifiers derive from 256-bit keys.
CREATE FUNCTION bb.authenticate(v text) RETURNS TABLE(tenant_id uuid,credential_id uuid,principal_id uuid,purpose text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bb AS $$
 SELECT c.tenant_id,c.credential_id,c.principal_id,c.purpose FROM bb.credentials c
 WHERE c.verifier=v AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())
 AND (c.idle_seconds IS NULL OR COALESCE(c.last_used_at,c.created_at)+make_interval(secs=>c.idle_seconds)>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION bb.authenticate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bb.authenticate(text) TO bb_api,bb_engine;
-- Worker scheduling obtains only installation work identities, never payload/auth data.
CREATE FUNCTION bb.pending_tenants() RETURNS TABLE(tenant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bb AS $$
 SELECT DISTINCT o.tenant_id FROM bb.outbox o WHERE o.state='pending' AND o.next_at<=now() LIMIT 50
$$;
REVOKE ALL ON FUNCTION bb.pending_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bb.pending_tenants() TO bb_worker,bb_engine;
