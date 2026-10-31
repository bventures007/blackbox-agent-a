-- Rebuildable typed record read models. Canonical observations remain immutable in journal.
CREATE TABLE bb.record_versions (
 tenant_id uuid NOT NULL, sequence bigint NOT NULL, record_id uuid NOT NULL,
 dataset text NOT NULL, entity_id uuid NOT NULL, connection_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
 payload jsonb NOT NULL, checksum text NOT NULL, supersedes_entry_id uuid, evidence_id uuid NOT NULL, entry_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,sequence), FOREIGN KEY(tenant_id,sequence) REFERENCES bb.journal,
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence
);
CREATE TABLE bb.current_records (LIKE bb.record_versions INCLUDING DEFAULTS);
ALTER TABLE bb.current_records ADD PRIMARY KEY(tenant_id,record_id);
ALTER TABLE bb.current_records ADD FOREIGN KEY(tenant_id,sequence) REFERENCES bb.journal;
CREATE INDEX record_versions_entity ON bb.record_versions(tenant_id,entity_id,record_id,occurred_at DESC,sequence DESC);
CREATE INDEX record_versions_dataset ON bb.record_versions(tenant_id,dataset,record_id,occurred_at DESC,sequence DESC);
CREATE INDEX current_records_entity ON bb.current_records(tenant_id,entity_id,dataset);
CREATE INDEX current_records_dataset ON bb.current_records(tenant_id,dataset,record_id);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['record_versions','current_records'] LOOP
 EXECUTE format('ALTER TABLE bb.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE bb.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON bb.%I USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant())',n);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON bb.record_versions,bb.current_records TO bb_engine;

ALTER TABLE bb.heads ADD COLUMN record_count bigint NOT NULL DEFAULT 0;
CREATE INDEX journal_record_versions ON bb.journal(tenant_id,record_id,occurred_at DESC,sequence DESC) WHERE record_type='source' AND payload ? 'record';
