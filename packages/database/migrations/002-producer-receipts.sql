CREATE TABLE bb.producer_receipts (
 tenant_id uuid NOT NULL, credential_id uuid NOT NULL, nonce uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,credential_id,nonce),
 FOREIGN KEY(tenant_id,credential_id) REFERENCES bb.credentials
);
ALTER TABLE bb.producer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bb.producer_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON bb.producer_receipts USING(tenant_id=bb.tenant()) WITH CHECK(tenant_id=bb.tenant());
GRANT SELECT,INSERT,DELETE ON bb.producer_receipts TO bb_api;
