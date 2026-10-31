-- 0001_foundation: tenants, append-only five-track journal, identity, operational state.
-- Runs as bbx_migrator (table owner). Runtime roles bbx_api, bbx_worker, bbx_engine are created by
-- infra/compose/postgres-init/01-roles.sh and only receive the grants below.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  tenant_id     uuid PRIMARY KEY,
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Europe/Berlin',
  kind          text NOT NULL CHECK (kind IN ('workspace', 'synthetic')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_sequences (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  next_sequence bigint NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------- journal
CREATE TABLE journal_entries (
  entry_id            uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  journal_sequence    bigint NOT NULL,
  record_type         text NOT NULL CHECK (record_type IN ('source', 'fact', 'commitment', 'movement', 'reservation')),
  record_id           text NOT NULL,
  event_type          text NOT NULL,
  schema_version      integer NOT NULL,
  connection_id       uuid,
  provider_namespace  text,
  dedup_key           text NOT NULL,
  occurred_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL,
  entity_refs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload             jsonb NOT NULL,
  payload_hash        text NOT NULL,
  evidence_refs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_entry_ids     uuid[] NOT NULL DEFAULT '{}',
  rule_version        text,
  supersedes_entry_id uuid,
  correlation_id      text,
  causation_id        text,
  UNIQUE (tenant_id, journal_sequence),
  UNIQUE (tenant_id, dedup_key)
);
CREATE INDEX journal_entries_tenant_record ON journal_entries (tenant_id, record_type, journal_sequence);
CREATE INDEX journal_entries_tenant_occurred ON journal_entries (tenant_id, occurred_at, journal_sequence);
CREATE INDEX journal_entries_tenant_recorded ON journal_entries (tenant_id, recorded_at, journal_sequence);
CREATE INDEX journal_entries_tenant_connection ON journal_entries (tenant_id, connection_id, journal_sequence);
CREATE INDEX journal_entries_tenant_event ON journal_entries (tenant_id, event_type, journal_sequence);

CREATE TABLE journal_entity_links (
  tenant_id        uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  journal_sequence bigint NOT NULL,
  entry_id         uuid NOT NULL REFERENCES journal_entries (entry_id) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, entity_type, entity_id, journal_sequence)
);
CREATE INDEX journal_entity_links_entry ON journal_entity_links (tenant_id, entry_id);

CREATE TABLE journal_evidence (
  tenant_id       uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  evidence_id     text NOT NULL,
  connection_id   uuid,
  object_key      text NOT NULL,
  sha256          text NOT NULL,
  size_bytes      bigint NOT NULL,
  media_type      text NOT NULL,
  retention_class text NOT NULL DEFAULT 'raw_evidence_90d',
  received_at     timestamptz NOT NULL DEFAULT now(),
  source_ref      text,
  PRIMARY KEY (tenant_id, evidence_id)
);

-- Append-only enforcement below role grants: any UPDATE/DELETE/TRUNCATE is rejected for every role.
CREATE OR REPLACE FUNCTION journal_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal is append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'BBX01';
END $$;

CREATE TRIGGER journal_entries_no_update BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER journal_entity_links_no_update BEFORE UPDATE OR DELETE ON journal_entity_links
  FOR EACH ROW EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER journal_entity_links_no_truncate BEFORE TRUNCATE ON journal_entity_links
  FOR EACH STATEMENT EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER journal_evidence_no_update BEFORE UPDATE OR DELETE ON journal_evidence
  FOR EACH ROW EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER journal_evidence_no_truncate BEFORE TRUNCATE ON journal_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION journal_reject_mutation();

-- Single append boundary shared by TypeScript and Rust callers.
-- p_entries: jsonb array of objects with entry_id, record_type, record_id, event_type, schema_version,
-- connection_id, provider_namespace, dedup_key, occurred_at, entity_refs, payload, evidence_refs,
-- input_entry_ids, rule_version, supersedes_entry_id, correlation_id, causation_id.
-- Returns one row per input: inserted=false when an identical (same payload hash) entry already existed.
-- Raises BBX02 when the same dedup_key exists with a different payload hash (conflict; never replaces).
CREATE OR REPLACE FUNCTION journal_append(p_tenant uuid, p_entries jsonb)
RETURNS TABLE (entry_id uuid, journal_sequence bigint, inserted boolean, recorded_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE
  v_next     bigint;
  v_item     jsonb;
  v_hash     text;
  v_existing record;
  v_id       uuid;
  v_ref      jsonb;
  v_now      timestamptz := clock_timestamp();
BEGIN
  IF current_setting('app.tenant_id', true) IS DISTINCT FROM p_tenant::text THEN
    RAISE EXCEPTION 'tenant scope mismatch' USING ERRCODE = 'BBX03';
  END IF;
  SELECT ts.next_sequence INTO v_next FROM tenant_sequences ts WHERE ts.tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown tenant' USING ERRCODE = 'BBX03';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_hash := encode(digest(convert_to((v_item->'payload')::text, 'UTF8'), 'sha256'), 'hex');
    SELECT je.entry_id, je.journal_sequence, je.payload_hash, je.recorded_at INTO v_existing
      FROM journal_entries je WHERE je.tenant_id = p_tenant AND je.dedup_key = v_item->>'dedup_key';
    IF FOUND THEN
      IF v_existing.payload_hash <> v_hash THEN
        RAISE EXCEPTION 'dedup key % already recorded with different content', v_item->>'dedup_key'
          USING ERRCODE = 'BBX02', DETAIL = v_existing.entry_id::text;
      END IF;
      entry_id := v_existing.entry_id; journal_sequence := v_existing.journal_sequence; inserted := false; recorded_at := v_existing.recorded_at;
      RETURN NEXT;
      CONTINUE;
    END IF;
    v_id := COALESCE((v_item->>'entry_id')::uuid, gen_random_uuid());
    INSERT INTO journal_entries (entry_id, tenant_id, journal_sequence, record_type, record_id, event_type, schema_version,
      connection_id, provider_namespace, dedup_key, occurred_at, recorded_at, entity_refs, payload, payload_hash, evidence_refs,
      input_entry_ids, rule_version, supersedes_entry_id, correlation_id, causation_id)
    VALUES (v_id, p_tenant, v_next, v_item->>'record_type', v_item->>'record_id', v_item->>'event_type', (v_item->>'schema_version')::int,
      (v_item->>'connection_id')::uuid, v_item->>'provider_namespace', v_item->>'dedup_key', (v_item->>'occurred_at')::timestamptz, v_now,
      COALESCE(v_item->'entity_refs', '[]'::jsonb), v_item->'payload', v_hash, COALESCE(v_item->'evidence_refs', '[]'::jsonb),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_item->'input_entry_ids'))::uuid[], '{}'),
      v_item->>'rule_version', (v_item->>'supersedes_entry_id')::uuid, v_item->>'correlation_id', v_item->>'causation_id');
    FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'entity_refs', '[]'::jsonb)) LOOP
      INSERT INTO journal_entity_links (tenant_id, entity_type, entity_id, journal_sequence, entry_id)
      VALUES (p_tenant, v_ref->>'type', v_ref->>'id', v_next, v_id) ON CONFLICT DO NOTHING;
    END LOOP;
    entry_id := v_id; journal_sequence := v_next; inserted := true; recorded_at := v_now;
    v_next := v_next + 1;
    RETURN NEXT;
  END LOOP;
  UPDATE tenant_sequences SET next_sequence = v_next WHERE tenant_id = p_tenant;
  PERFORM pg_notify('journal_committed', p_tenant::text);
  RETURN;
END $$;

-- ---------------------------------------------------------------- identity (installation scope)
CREATE TABLE owners (
  owner_id     uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE principals (
  principal_id uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('owner', 'agent', 'producer', 'system')),
  name         text NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE TABLE credentials (
  credential_id uuid PRIMARY KEY,
  principal_id  uuid NOT NULL REFERENCES principals (principal_id) ON DELETE RESTRICT,
  tenant_id     uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  purpose       text NOT NULL CHECK (purpose IN ('owner_login', 'agent_key', 'producer_key')),
  key_id        text NOT NULL UNIQUE,
  verifier      bytea NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  expires_at    timestamptz,
  last_used_at  timestamptz
);
CREATE TABLE sessions (
  session_id          uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  owner_id            uuid NOT NULL REFERENCES owners (owner_id) ON DELETE RESTRICT,
  token_hash          bytea NOT NULL UNIQUE,
  remembered          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at     timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE TABLE login_attempts (
  source       text PRIMARY KEY,
  failures     integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  audit_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL,
  actor_id   text,
  action     text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION journal_reject_mutation();

-- ---------------------------------------------------------------- sources and import (tenant scope, mutable)
CREATE TABLE connections (
  connection_id     uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  provider          text NOT NULL,
  display_name      text NOT NULL,
  account_namespace text NOT NULL,
  status            text NOT NULL DEFAULT 'configured',
  config_encrypted  text,
  config_public     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, account_namespace)
);
CREATE TABLE capability_state (
  tenant_id              uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  connection_id          uuid NOT NULL REFERENCES connections (connection_id) ON DELETE RESTRICT,
  capability             text NOT NULL,
  mode                   text NOT NULL DEFAULT 'local_standalone',
  collection_state       text NOT NULL DEFAULT 'configured',
  cursor                 jsonb,
  last_attempt_at        timestamptz,
  last_successful_sync_at timestamptz,
  last_import_completed_at timestamptz,
  last_import_outcome    text,
  last_reconciliation_at timestamptz,
  last_received_at       timestamptz,
  last_new_record_at     timestamptz,
  last_journal_commit_at timestamptz,
  next_poll_at           timestamptz,
  next_poll_reason       text,
  retry_state            jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_count          integer NOT NULL DEFAULT 0,
  failed_count           integer NOT NULL DEFAULT 0,
  quarantined_count      integer NOT NULL DEFAULT 0,
  coverage               jsonb NOT NULL DEFAULT '{}'::jsonb,
  restrictions           jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, capability)
);
CREATE TABLE import_plans (
  plan_id               uuid NOT NULL,
  plan_revision         integer NOT NULL,
  tenant_id             uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  connection_id         uuid NOT NULL REFERENCES connections (connection_id) ON DELETE RESTRICT,
  preset                text NOT NULL CHECK (preset IN ('last_30_days', 'this_year', 'last_12_months', 'custom', 'from_now')),
  timezone              text NOT NULL,
  requested_from        timestamptz,
  initial_cutoff        timestamptz NOT NULL,
  include_open_items    boolean NOT NULL,
  include_related       boolean NOT NULL,
  include_opening_state boolean NOT NULL,
  strict_from_now       boolean NOT NULL DEFAULT false,
  capability_scope      jsonb NOT NULL DEFAULT '[]'::jsonb,
  overrides             jsonb NOT NULL DEFAULT '{}'::jsonb,
  restrictions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor_id              text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, plan_revision)
);
CREATE TABLE import_runs (
  run_id         uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  connection_id  uuid NOT NULL REFERENCES connections (connection_id) ON DELETE RESTRICT,
  plan_id        uuid,
  plan_revision  integer,
  run_kind       text NOT NULL CHECK (run_kind IN ('initial', 'history_expansion', 'incremental', 'reconciliation', 'import')),
  state          text NOT NULL DEFAULT 'queued',
  phase          text NOT NULL DEFAULT 'check_connection',
  started_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  attempt        integer NOT NULL DEFAULT 0,
  cursor         jsonb,
  scope          jsonb NOT NULL DEFAULT '{}'::jsonb,
  counters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors         jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action    text,
  outcome        text
);
CREATE INDEX import_runs_connection ON import_runs (tenant_id, connection_id, updated_at DESC);

CREATE TABLE jobs (
  job_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  kind            text NOT NULL,
  singleton_key   text UNIQUE,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at          timestamptz NOT NULL DEFAULT now(),
  lease_until     timestamptz,
  lease_owner     text,
  attempt         integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 10,
  state           text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'dead')),
  last_error_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (state, run_at) WHERE state IN ('queued', 'running');

CREATE TABLE engine_checkpoints (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  applied_sequence bigint NOT NULL,
  reducer_version  text NOT NULL,
  schema_version   integer NOT NULL,
  snapshot_path    text,
  snapshot_sha256  text,
  written_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_cases (
  case_id             uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  kind                text NOT NULL,
  state               text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'resolved')),
  revision            integer NOT NULL DEFAULT 1,
  connection_id       uuid,
  run_id              uuid,
  input_ref           jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected            jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_code         text NOT NULL,
  stage               text NOT NULL,
  evidence_ref        text,
  history             jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_entry_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_cases_open ON review_cases (tenant_id, state, updated_at DESC);

CREATE TABLE redaction_ledger (
  ledger_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  evidence_id text NOT NULL,
  action      text NOT NULL CHECK (action IN ('restrict', 'expire', 'destroy')),
  reason      text NOT NULL,
  actor_id    text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TRIGGER redaction_ledger_no_update BEFORE UPDATE OR DELETE ON redaction_ledger FOR EACH ROW EXECUTE FUNCTION journal_reject_mutation();
CREATE TRIGGER redaction_ledger_no_truncate BEFORE TRUNCATE ON redaction_ledger FOR EACH STATEMENT EXECUTE FUNCTION journal_reject_mutation();

-- Installation-scoped settings use the nil UUID as tenant_id (no tenant row exists for it); workspace rows reference a tenant.
CREATE TABLE settings (
  tenant_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  scope      text NOT NULL CHECK (scope IN ('installation', 'workspace')),
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (scope, key, tenant_id),
  CHECK ((scope = 'installation') = (tenant_id = '00000000-0000-0000-0000-000000000000'))
);
CREATE TABLE debug_windows (
  window_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  component     text NOT NULL,
  connection_id uuid,
  run_id        uuid,
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  stopped_at    timestamptz,
  actor_id      text NOT NULL
);
CREATE TABLE maintenance_fence (
  fence_id    integer PRIMARY KEY CHECK (fence_id = 1),
  holder      text,
  phase       text,
  acquired_at timestamptz,
  expires_at  timestamptz,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO maintenance_fence (fence_id) VALUES (1);
CREATE TABLE backup_generations (
  generation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('scheduled', 'manual', 'pre_upgrade')),
  state         text NOT NULL CHECK (state IN ('running', 'complete', 'failed', 'incomplete')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  cutoffs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination   text,
  file_name     text,
  size_bytes    bigint,
  sha256        text,
  manifest      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code    text
);
-- schema_migrations is owned by the migration runner (created before the first migration runs).
CREATE TABLE release_info (
  info_id          integer PRIMARY KEY CHECK (info_id = 1),
  app_version      text NOT NULL,
  schema_version   integer NOT NULL,
  reducer_version  text NOT NULL,
  installed_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- row-level security
-- Tenant scope comes from set_config('app.tenant_id', ..., true) inside each transaction.
-- app.scope = 'identity' is set only by the API authentication transaction to look up a credential
-- before the tenant is known; app.scope = 'engine' is set by the engine for cross-tenant projection reads.
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_scope() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(NULLIF(current_setting('app.scope', true), ''), 'tenant') $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries','journal_entity_links','journal_evidence','connections','capability_state',
    'import_plans','import_runs','review_cases','redaction_ledger','debug_windows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant_select ON %I FOR SELECT USING (tenant_id = app_tenant() OR app_scope() = ''engine'')', t, t);
    EXECUTE format('CREATE POLICY %I_tenant_insert ON %I FOR INSERT WITH CHECK (tenant_id = app_tenant())', t, t);
    EXECUTE format('CREATE POLICY %I_tenant_update ON %I FOR UPDATE USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t, t);
    EXECUTE format('CREATE POLICY %I_tenant_delete ON %I FOR DELETE USING (tenant_id = app_tenant())', t, t);
  END LOOP;
  -- identity tables: tenant scope, or the explicit identity lookup scope of the API authenticator
  FOREACH t IN ARRAY ARRAY['owners','principals','credentials','sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_scope_select ON %I FOR SELECT USING (tenant_id = app_tenant() OR app_scope() = ''identity'')', t, t);
    EXECUTE format('CREATE POLICY %I_scope_insert ON %I FOR INSERT WITH CHECK (tenant_id = app_tenant() OR app_scope() = ''identity'')', t, t);
    EXECUTE format('CREATE POLICY %I_scope_update ON %I FOR UPDATE USING (tenant_id = app_tenant() OR app_scope() = ''identity'')', t, t);
  END LOOP;
  -- tenant-nullable operational tables (installation-wide rows have tenant_id NULL)
  FOREACH t IN ARRAY ARRAY['jobs','settings','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_scope_select ON %I FOR SELECT USING (tenant_id IS NULL OR tenant_id = ''00000000-0000-0000-0000-000000000000'' OR tenant_id = app_tenant() OR app_scope() IN (''engine'',''identity'',''scheduler''))', t, t);
    EXECUTE format('CREATE POLICY %I_scope_insert ON %I FOR INSERT WITH CHECK (tenant_id IS NULL OR tenant_id = ''00000000-0000-0000-0000-000000000000'' OR tenant_id = app_tenant() OR app_scope() IN (''identity'',''scheduler''))', t, t);
    EXECUTE format('CREATE POLICY %I_scope_update ON %I FOR UPDATE USING (tenant_id IS NULL OR tenant_id = ''00000000-0000-0000-0000-000000000000'' OR tenant_id = app_tenant() OR app_scope() = ''scheduler'')', t, t);
    EXECUTE format('CREATE POLICY %I_scope_delete ON %I FOR DELETE USING (tenant_id IS NULL OR tenant_id = ''00000000-0000-0000-0000-000000000000'' OR tenant_id = app_tenant() OR app_scope() = ''scheduler'')', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA public TO bbx_api, bbx_worker, bbx_engine;
GRANT SELECT ON tenants, tenant_sequences, release_info, schema_migrations, engine_checkpoints, maintenance_fence TO bbx_api, bbx_worker, bbx_engine;
GRANT SELECT, INSERT ON journal_entries, journal_entity_links, journal_evidence TO bbx_api, bbx_worker, bbx_engine;
GRANT SELECT, INSERT ON audit_events, redaction_ledger TO bbx_api, bbx_worker;
GRANT UPDATE ON tenant_sequences TO bbx_api, bbx_worker, bbx_engine;
GRANT SELECT, INSERT, UPDATE ON owners, principals, credentials, sessions, login_attempts, connections, capability_state,
  import_plans, import_runs, review_cases, settings, debug_windows, backup_generations, maintenance_fence TO bbx_api, bbx_worker;
GRANT DELETE ON sessions, login_attempts, debug_windows TO bbx_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO bbx_api, bbx_worker;
GRANT SELECT, INSERT, UPDATE ON engine_checkpoints TO bbx_engine;
GRANT SELECT ON connections, capability_state TO bbx_engine;
GRANT SELECT, INSERT ON review_cases TO bbx_engine;
GRANT EXECUTE ON FUNCTION journal_append(uuid, jsonb), app_tenant(), app_scope() TO bbx_api, bbx_worker, bbx_engine;
-- Explicitly make sure runtime roles never gain destructive privileges on journal tables.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON journal_entries, journal_entity_links, journal_evidence, audit_events, redaction_ledger FROM bbx_api, bbx_worker, bbx_engine;
