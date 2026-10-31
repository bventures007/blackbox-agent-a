-- Rebuilds publish a versioned interpretation; they never rewrite journal inputs.
ALTER TABLE bb.heads ADD COLUMN projection_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE bb.heads ADD COLUMN projection_rule text NOT NULL DEFAULT 'lifecycle-v3'
 CHECK(projection_rule IN ('lifecycle-v2','lifecycle-v3'));
-- Existing installations keep their prior interpretation until an explicit build
-- has verified and atomically published the replacement. Fresh workspaces use v3.
UPDATE bb.heads SET projection_rule='lifecycle-v2';

ALTER TABLE bb.projections ADD COLUMN generation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE bb.projections ADD COLUMN verified_checksum text;
ALTER TABLE bb.projections DROP CONSTRAINT projections_pkey;
ALTER TABLE bb.projections ADD PRIMARY KEY(tenant_id,generation_id,entity_id);

CREATE TABLE bb.projection_builds (
 tenant_id uuid NOT NULL REFERENCES bb.workspaces,
 build_id uuid NOT NULL,
 source_generation_id uuid NOT NULL,
 source_rule text NOT NULL CHECK(source_rule IN ('lifecycle-v2','lifecycle-v3')),
 target_rule text NOT NULL CHECK(target_rule='lifecycle-v3'),
 state text NOT NULL DEFAULT 'scanning' CHECK(state IN ('scanning','catching_up','verifying','ready','published','failed')),
 source_cutoff bigint NOT NULL CHECK(source_cutoff>=0),
 target_cutoff bigint NOT NULL CHECK(target_cutoff>=source_cutoff),
 scan_cursor uuid,
 verify_cursor uuid,
 built_count bigint NOT NULL DEFAULT 0 CHECK(built_count>=0),
 verified_count bigint NOT NULL DEFAULT 0 CHECK(verified_count>=0),
 error_code text CHECK(error_code IN ('source_generation_changed','unsupported_event','reducer_conflict','candidate_corrupt','candidate_incomplete','build_budget_exceeded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 PRIMARY KEY(tenant_id,build_id),
 CHECK((state='published')=(published_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_projection_build ON bb.projection_builds(tenant_id)
 WHERE state IN ('scanning','catching_up','verifying','ready');
ALTER TABLE bb.projection_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE bb.projection_builds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON bb.projection_builds USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant());
GRANT SELECT ON bb.projection_builds TO bb_runtime;
-- Only the privileged host starts a build. The engine can advance that explicit
-- grant; ordinary browser/API/worker roles cannot create or approve one.
GRANT UPDATE ON bb.projection_builds TO bb_engine;

UPDATE bb.runtime_contract SET contract=jsonb_set(jsonb_set(contract,
 '{reducers,lifecycle}','"lifecycle-v3"'),'{projections,lifecycle}','"lifecycle-v3"')
 ||'{"projection_build":1,"lifecycle_readers":["lifecycle-v2","lifecycle-v3"]}'::jsonb,changed_at=now();
