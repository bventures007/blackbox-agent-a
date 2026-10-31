# Owner review and append-only correction

The Sources view has an English/German owner review list and evidence-backed decision dialog. This implemented subset handles typed provider-content conflicts, proposed payment/bank/entity links, retained Shopify order/transaction inputs, and quarantined accepted-source derivations. It is not a full PILOT-04 or independent capability approval: legacy lifecycle corrections and compatible forward repair of unsupported event formats remain unfinished.

## Authority, identity and precedence

All review routes require the protected owner session; writes require the existing exact origin and CSRF check. The session is checked again under a credential row lock before committing. Every reference is tenant scoped. A foreign link target, foreign/expired evidence, stale case revision, changed target entry, or reused command with different content is rejected. Decisions have client-generated UUID command identities, a keyed request fingerprint and an optimistic case revision. Concurrent repeats return the original receipt. Competing commands at one revision cannot both commit.

Migration 005 makes claims, decisions, decision-to-journal links and query-readiness checks immutable under real runtime database identities. Mutable case state is separate. A provider revision/content pair has one stable case. Both accepted and conflicting claims have protected evidence references. Typed content conflicts append a narrow coverage assertion to the journal/outbox, so API and MCP can expose the conflict at its actual recorded cutoff. Rejected input is never converted into accepted money.

An owner correction preserves the record, connection, economic-effect and related entity identities. It explicitly supersedes the current assertion, with the same effective time, a new recorded sequence, a protected explanation/evidence bundle and `owner-decision-v1` provenance. Array membership and identity anchors cannot be edited by the correction form. Neither arrival time nor a generic manual flag wins universally. A later genuine provider revision remains a separate observation. Canonical facts remain allowlisted typed business values; free-form explanations/supporting text stay encrypted outside the journal. The default evidence-access expiry is 90 days from receipt; full retention/purge/key-rotation operations remain separate work.

Confirm/reject actions apply only to proposed identity, payment-allocation and bank links. Confirmation verifies that the target is present in the workspace. Rejection appends a rejected assertion. Only verified payment allocations or bank matches participate in the existing Rust calculations. A link decision cannot create another capture or bank transaction. Domain contradictions still return conflicts or unavailable calculations; human confirmation does not prove global completeness.

## Recalculation and history

The correction, outbox, immutable decision and operational case transition commit atomically. The returned required cursor is a durable receipt. A case remains `in_progress` while the engine is behind. The owner dialog checks one affected structured intent per bounded request through the real Rust query service, under the current session, at the decision's recorded cutoff. Readiness results retain rule version, status, missing inputs and conflicts. Finalization checks that the decision is still current and then resolves the case. Closing the browser does not stop the engine; pending owner query checks resume when the case is opened again. A saved decision can be revised with another evidenced supersession if recalculation or further evidence requires it.

Questions-v5 returns `human_confirmed_inputs` with immutable entry/decision/case/actor/reason/time references. The Questions view labels their presence. Notes are not inserted into the answer envelope. Fixed recorded cutoffs retain earlier amounts, evidence and absence of future decisions after process restart or deleted projection recovery.

Resolving one claim does not repair historical import cohorts, advance successful source-check timestamps, or assert a complete provider history. The last affected conflict marker becomes an explicit `source_reviewed_gap`; unrelated conflicts remain. Source health retains unresolved cases and truthful historical gaps. Repeating the exact resolved conflicting claim cannot reopen the same case or add money; different content creates a new review case.

## Retained-input retry

Retries use the encrypted original accepted input, connection/account namespace and immutable import-plan scope. They do not fetch replacement provider data or fabricate a new transaction identity. Transaction evidence retains the minimal order context and one explicitly labeled transaction subset; retrying that subset does not certify the whole provider population. The same original identity/deduplication boundary applies. An accepted input from an earlier parser failure can be processed by the current normalizer. Poison inputs stay open and stop after three owner retries. Missing/expired evidence disables reprocessing with a visible explanation. Untyped malformed inputs cannot be edited into invented business facts by the correction form; they remain unresolved or use retained-input retry.

## Reproduction and actual scope

```sh
pnpm typecheck
pnpm test
python3 scripts/verify-reviews.py --output .runtime/reviews-evidence.json
```

The integration runner uses signed producer HTTP, real PostgreSQL roles, Rust, API, actual SDK MCP and Chrome. It exercises current and historical money, distinct concurrent decisions, repeated commands, stale/foreign/CSRF/revoked-session denials, link confirmation/rejection, poison and expired original inputs, English decision entry, German mobile layout, restart between acknowledgment and application, and deleted-projection recovery. A prior parser failure is explicitly injected as an encrypted quarantine to exercise retry; it is not a live provider incident. The runner preserves screenshots and reports actual outcomes. Native developer runs do not certify Compose distribution, performance, live Shopify access or independent review.

## Accepted-source derivation retry

Schema12 bounds transient automatic attempts to eight, honoring each job's next-at time. Unsupported kinds/versions, reducer conflicts and entity-history-budget failures stop immediately. One scoped `derivation_failed` case references the accepted journal entry and original evidence; later failures reopen that same case without resetting its lifetime owner retry count. Quarantined rows remain unapplied. The workspace applied cursor cannot pass any pending or quarantined gap; other workspaces continue independently.

The owner may leave the case unresolved or retry that exact accepted entry after fixing the cause. Origin, CSRF, current session, optimistic revision, immutable command identity and the three-owner-retry budget apply. The decision, security audit, encrypted explanation and outbox reset commit together. No replacement source record, payment, stock effect or mutable journal rewrite is created. Restricted original raw evidence stays restricted: this path reuses canonical accepted values and may retain their original provenance reference without decrypting expired content. Additional supporting evidence must still be accessible in the same workspace.

A saved retry remains recalculating until Rust publishes a complete cursor and the actual authorized lifecycle/affected typed queries succeed. Failed retry reopens the case. Unsupported formats need a compatible reader; retries cannot reinterpret unknown input. The host forward-fix path for a workspace already blocked by an unsupported format still needs separate operational verification; this increment does not claim that a normal upgrade can drain such a gap.

Rust validates explicit event versions, header/payload identity, known lifecycle kinds and typed dataset/status-to-kind admission. This is not a complete replacement for the strict canonical JSON schemas at ingestion. An indexed PostgreSQL admission guard prevents older applied cursors or projections from concealing unknown headers/datasets. Lifecycle projections carry input-reader metadata in their integrity checksum; older projections cold-replay. Typed projection and cold reads check original journal headers. Both query endpoints have a 4.2-second execution deadline, SQL timeouts and final session/agent rechecks.

Run `python3 scripts/verify-derivation.py --output work/derivation-proof.json` against the isolated native harness after building Rust and web assets. The proof exercises actual worker quarantine, API/SDK MCP, scoped owner decisions, bounded real-role failure handling, restart, deleted projection recovery and EN/DE owner UI. Synthetic retry schedules, simulated old projection metadata and runtime measurements are explicitly distinguished from real outages, production data and smoke acceptance.
