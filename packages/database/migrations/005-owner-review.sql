-- Owner decisions are immutable. Case assignment/retry/readiness is operational state.
ALTER TABLE bb.review_cases ADD COLUMN claim_hash text;
ALTER TABLE bb.review_cases ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 3);
ALTER TABLE bb.review_cases ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE bb.review_cases ADD COLUMN resolved_at timestamptz;
ALTER TABLE bb.review_cases ADD COLUMN resolution_id uuid;
CREATE UNIQUE INDEX review_claim_identity ON bb.review_cases(tenant_id,connection_id,entry_id,claim_hash) WHERE claim_hash IS NOT NULL;
CREATE TABLE bb.review_claims (
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,claim jsonb NOT NULL,evidence_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,case_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES bb.review_cases,
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence
);
CREATE TABLE bb.review_decisions (
 tenant_id uuid NOT NULL,decision_id uuid NOT NULL,case_id uuid NOT NULL,principal_id uuid NOT NULL,
 request_fingerprint text NOT NULL,case_revision integer NOT NULL,
 action text NOT NULL CHECK(action IN ('leave','retry','correct','confirm_link','reject_link')),
 reason_code text NOT NULL,evidence_id uuid NOT NULL,required_cursor bigint NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('unresolved','recalculating')),checks jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,decision_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES bb.review_cases,
 FOREIGN KEY(tenant_id,evidence_id) REFERENCES bb.evidence
);
ALTER TABLE bb.review_cases ADD FOREIGN KEY(tenant_id,resolution_id) REFERENCES bb.review_decisions;
CREATE TABLE bb.review_decision_entries (
 tenant_id uuid NOT NULL,decision_id uuid NOT NULL,entry_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,decision_id,entry_id),UNIQUE(tenant_id,entry_id),
 FOREIGN KEY(tenant_id,decision_id) REFERENCES bb.review_decisions,
 FOREIGN KEY(tenant_id,entry_id) REFERENCES bb.journal(tenant_id,entry_id)
);
CREATE TABLE bb.review_checks (
 tenant_id uuid NOT NULL,check_id uuid NOT NULL,decision_id uuid NOT NULL,
 checked_cursor bigint NOT NULL,results jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,check_id),FOREIGN KEY(tenant_id,decision_id) REFERENCES bb.review_decisions
);
CREATE UNIQUE INDEX review_check_once ON bb.review_checks(tenant_id,decision_id,(results->>'intent'));
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['review_claims','review_decisions','review_decision_entries','review_checks'] LOOP
 EXECUTE format('ALTER TABLE bb.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE bb.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON bb.%I USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant())',n);
 EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON bb.%I FOR EACH ROW EXECUTE FUNCTION bb.immutable()',n);
 EXECUTE format('CREATE TRIGGER immutable_table BEFORE TRUNCATE ON bb.%I FOR EACH STATEMENT EXECUTE FUNCTION bb.immutable()',n);
 END LOOP;
END $$;
GRANT SELECT ON bb.review_claims,bb.review_decisions,bb.review_decision_entries,bb.review_checks TO bb_runtime;
GRANT INSERT ON bb.review_claims TO bb_api,bb_worker;
GRANT INSERT ON bb.review_decisions,bb.review_decision_entries,bb.review_checks TO bb_api;
