-- Global non-personal installation metadata. Runtime identities can only read it.
CREATE TABLE IF NOT EXISTS bb.schema_migrations (
 version text PRIMARY KEY, sha256 text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(),
 provenance text NOT NULL DEFAULT 'applied'
);
ALTER TABLE bb.schema_migrations ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'applied';
ALTER TABLE bb.schema_migrations ADD CONSTRAINT migration_digest_format CHECK(sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE bb.schema_migrations ADD CONSTRAINT migration_provenance CHECK(provenance IN ('applied','observed_legacy_schema'));
CREATE TABLE bb.runtime_contract (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 contract jsonb NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','fenced')),
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bb.runtime_contract(contract) VALUES ('{"api":1,"application":1,"backup":1,"encryption":{"evidence_read":[1,2],"evidence_write":2,"keyring":2,"provider_read":[1,2],"provider_write":2},"engine_rpc":1,"events":{"lifecycle":1,"typed_records":1},"journal":1,"mcp_bridge":1,"postgres_read":[17,18],"projections":{"lifecycle":"lifecycle-v2","typed_records":"records-v3"},"reducers":{"lifecycle":"lifecycle-v2","questions":"questions-v9","typed_records":"records-v3"},"snapshot":null,"worker":1}'::jsonb);
GRANT SELECT ON bb.runtime_contract,bb.schema_migrations TO bb_runtime;
