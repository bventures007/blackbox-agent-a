# Structured questions and typed records

`packages/contracts/records.ts` is the versioned supplemental record allowlist for
26 datasets. Record identity is stable within its owning connection and dataset.
New source revisions have new observation IDs and preserve the economic record
ID. An explicit supersession must reference a source entry for the same entity
and record. Cross-connection record identity reuse is rejected; explicit business
links and economic-effect identities have separate typed fields.

`packages/contracts/questions.ts` exposes the 24 exact versioned intents. API and
MCP call the same Rust query implementation. No model is called. `as_of` is the
clock used for promises, scan age and due review; `effective_at` limits observations
by business time and `recorded_cutoff` limits knowledge by committed journal
sequence. `from` currently requests interval coverage; it does not silently remove
older open/related context. The source-import date plan is a separate unfinished
feature. All times use timezone-aware parsing; exact quantities use integer
millionths and money uses checked integer minor units.

The worker transaction stores source-derived record versions and current records,
updates the checkpoint and then publishes state. Typed record responses use
checksum-validated current records or an indexed journal history read at a fixed
cutoff. Missing/corrupt acceleration does not authorize a newer or stale answer.
Source entries remain immutable; record projections can be rebuilt.

Every request passes current API and Rust authorization, including a final check
before delivery. Admission limits are eight per principal, 16 per workspace and
32 globally. Structured execution has a 4.2-second engine deadline and a bounded
20,000-record hydration limit. Results default to 100 rows with a 500-row maximum.
Larger scopes fail explicitly; no silent truncated aggregate is presented. The
current implementation still needs the required overload and performance proof.

Pagination is HMAC-bound to tenant, principal, intent, all caller filters and the
frozen recorded cutoff/clock. A later source commit cannot change subsequent pages
of that query. Record identifiers and evidence/input entry IDs accompany results;
original evidence is accessed only by the separately authenticated evidence tool.

A supplemental producer can declare only source intervals. It cannot submit a
`verified` coverage basis. The result says `declared_source_intervals` and
`independently_verified: false`; even sufficient synthetic input remains labeled
partial in that respect. Missing coverage or required fields produce explicit
missing inputs; partial-fragment intents retain evidenced facts. Unknown stock,
bank arrival, receipt or entitlement is not fabricated as zero. Runtime/provider
coverage verification and the complete source lifecycle remain independent work.

Tests translate the existing question examples into typed source observations,
not precomputed query answers. The implementation does not load expected results.
Positive and absent-input cases run through signed HTTP, PostgreSQL, Rust, API and
SDK MCP. Changed money/currency/fractional units, corrections, old snapshots and
fixed-cutoff recovery are tested separately. Passing this suite is not live
merchant verification, UI completion, independent capability review or release.

## Settlement scope refinements (questions-v2)

Cash refund gaps aggregate approved cash entitlements by original capture and currency and subtract completed refunds once per capture. Multiple credits return a grouped row with their entitlement identities. Cancellation queries hydrate fulfillments and compare shipped line/unit quantities with matching non-missing receipts; unrelated receipts cannot satisfy an order, and a zero-quantity reservation is not an outstanding stock release. An unobserved refund population returns unknown rather than false for cash confirmation. Impossible hold releases and dispute reversals return explicit conflicts with unknown monetary conclusions. These changes preserve the prior rule version in historical test evidence; new evaluations disclose questions-v2. Explicit historical rule-version selection remains part of the upgrade/rebuild work.
