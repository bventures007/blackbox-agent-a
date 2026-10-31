# Lifecycle event contract v2

The canonical event reader accepts version 1 envelopes and `lifecycle-v2` reducers.
Existing payment-v1 observations remain readable without rewriting the journal.
Current projections are disposable; their rule version and content hash must match.

`packages/contracts/index.ts` and `lifecycle.ts` define the strict input allowlist.
Permanent payloads contain opaque UUIDs, quantities, minor-unit money, currency,
effective time, business state enums and test/supersession metadata. No provider
names, addresses, emails, arbitrary text or raw documents are accepted. Original
signed input is encrypted as 90-day evidence; authenticated readers can traverse
its source entry, evidence locator and derived tracks. Raw evidence is not needed
for numeric replay. Full retention/redaction operations remain unfinished.

Quantities are nonnegative decimal strings, at most 12 integer and 6 fractional
digits. Rust converts to checked signed integer millionths for effects; output
uses exact decimal strings. Stocks are partitioned by item, location and unit.
An authoritative net available snapshot is not reduced by its own reservations.
Later unreconciled effects invalidate that availability instead of inventing a
new compatible stock basis. The disjoint physical basis tracks physical,
quarantined and reserved quantities separately. Confirmed dispatch reduces
physical stock; return receipt enters quarantine; restock releases quarantine
without receiving the same goods twice.

Invoice paid markers only affect reported receivables. Captures, fees, completed
refunds and sent payouts have separate asset effects. An announcement moves no
cash. Independent booked bank evidence must reference a sent payout with matching
currency/amount before moving its amount out of transit. Unknown/ambiguous matches
are not treated as bank confirmation. Current lifecycle totals are observed-only;
complete population coverage is not claimed by this event contract.

The Golden replay adapter translates observations, not expected answers. IDs are
HMAC-derived from a tenant-bound connection plus typed external identity. It does
not read checkpoint values. The test harness alone reads the immutable oracle.
The initial adapter supports the Golden event subset; this is not a full generic
26-dataset implementation or proof of real provider fields.

## Signed producer delivery

The owner creates a connection and a separate producer credential. A producer
cannot read business tools or configure sources, and an agent cannot ingest.
`POST /v1/ingest/<connection_uuid>` accepts `{observations:[...]}`. No tenant field
is accepted; tenant and connection binding come from current authorization.

Headers: Bearer producer key, `x-blackbox-time` (Unix seconds),
`x-blackbox-nonce` (fresh UUID), `x-blackbox-signature` (HMAC-SHA256 hex).
Sign this UTF-8 sequence with the producer key:

```
POST\n<exact request path>\n<timestamp>\n<nonce>\n<SHA256(canonical JSON body)>
```

Canonical JSON recursively sorts object keys in codepoint order, preserves array
order and uses JSON scalar encodings. Only validated finite safe integers enter
money fields. Timestamp tolerance is 300 seconds; nonce receipts are scoped to the
credential and durable for ten minutes. Retries use a fresh nonce and unchanged
observation identity. Event deduplication and the journal/outbox transaction
protect business effects separately from signed-delivery replay protection.

Only configured connection ownership is accepted. Successful receipt returns
202 after journal and outbox commit. Revocation is checked before receipt; future
requests fail. A producer's claim never establishes independently verified source
coverage. No public webhook gateway is created or required.
