# Append-only journal and complete business read access

Status: binding implementation specification, not an implemented database or MCP server. This document refines sections 4 and 7 of BUILD-PROMPT-EN.txt. The owner's requirement is an append-only business flight recorder and agent access to its complete authorized business context.

## 1. Journal invariant

The canonical journal only grows. After a journal entry is committed, ordinary application, worker, connector, MCP and workspace-administrator operations cannot update, delete or truncate it. This includes its business payload, evidence references and recorded time. Corrections, reversals, changed commitments, reservation releases, entity-link corrections and extraction-review decisions are additional entries referencing earlier entries.

For example: append a promise for 10 units; later append a correction to 8 units referring to the original promise. Both entries remain readable. The current-state projection shows 8, and an earlier cutoff still shows 10. Do not interpret the two versions as a promise for 18 units. This applies to all five tracks: Sources, Facts, Commitments, Movements and Reservations.

Keep mutable operational state separate: authentication, memberships, connector cursors, job status, retry counts, caches and current-state projections are not the canonical journal. Projections may be updated or rebuilt from immutable entries using versioned rules. Do not store the only copy of a business change in a mutable table.

## 2. Minimum logical data structure

Implement a canonical journal with immutable typed records or versioned payloads. The SQL layout is an implementation decision; document it and supply migrations. Every entry must expose these logical fields:

| Field | Meaning |
| --- | --- |
| `entry_id`, `tenant_id` | Stable entry identity and mandatory tenant scope |
| `journal_sequence` | Stable, tenant-scoped traversal position for committed entries |
| `record_type`, `record_id` | Source, fact, commitment, movement or reservation; stable identity of the business record whose history this entry extends |
| `event_type`, `schema_version` | Explicit event meaning and versioned interpretation |
| `connection_id`, provider/account namespace | Provenance for external observations; explicitly identified internal derivation context where applicable |
| provider event ID / deduplication key | Persistent source identity preventing repeated business effects; applicable to external observations |
| `occurred_at`, `recorded_at` | Effective business time and server-assigned durable recording time; retain relevant source-time metadata |
| `entity_refs` | Tenant-scoped links to orders, lines, customers, invoices, shipments, transactions, refunds, payouts and items |
| `payload` | Immutable typed business content, with integer minor currency units and explicit quantity units |
| `evidence_refs`, `input_entry_ids` | Original evidence and exact journal inputs supporting a derived assertion |
| derivation rule/version | Reproducible interpretation for derived facts and state changes |
| `supersedes_entry_id` / reversal reference | Explicit link to an earlier assertion being corrected or reversed; no overwrite |
| correlation/causation IDs | Links connecting related business events and their causes |

All links are tenant-scoped. Record ambiguity instead of merging by order number or email alone. A journal entry can contribute to multiple UI views without causing duplicate monetary or quantity effects. Keep original observations and derived assertions distinguishable.

Define which fields are required for each event type. Corrections and derivations must point to immutable input versions. Reprocessing with a new derivation rule cannot silently rewrite prior derived entries. Preserve the prior rule and either append explicitly superseding derivations or maintain a versioned rebuilt view with its interpretation disclosed.

## 3. Database enforcement and recovery

Enforce append-only behavior below the UI and service conventions. Runtime roles must not own journal tables or have superuser/BYPASSRLS, UPDATE, DELETE, TRUNCATE, schema-alteration or role-escalation capability over journal data. Use reviewed database permissions and defensive rejection triggers or an equivalent enforced design. Apply the same protection to immutable child records containing payloads or links. Ensure cascades and cleanup jobs cannot delete journal rows.

Permit append operations only through the tenant-validated ingestion/derivation boundary. Keep migration credentials separate from runtime credentials. Workspace owners must not be able to edit journal history through any application endpoint. Document that privileged database/host operators remain a separate trust boundary; do not claim physical tamper-proof or WORM storage without implementing and verifying it.

Journal append, deduplication and dispatch/outbox behavior must be transactional. Retries may add delivery-attempt records in operational storage, but cannot duplicate canonical business effects. The same provider event identity with different content must surface a conflict instead of replacing the old payload.

For complete traversal, a cursor must not skip an entry that commits late. Define a committed snapshot/high-water mark and use an ordering mechanism that preserves it, for example tenant-scoped serialized sequence allocation within the append transaction. A bare sequence allocated before commit is insufficient if a lower sequence can commit after the client advances past it. Concurrent writes, transaction rollback and late business timestamps must be tested. Late business events append at the new recording position while retaining their original effective time.

Demonstrate restart, restore and replay without rewriting canonical entries. Historical answers must state both the effective-time cutoff and recorded-time/snapshot cutoff, plus the derivation version where relevant.

## 4. Evidence content and retention boundary

Keep secrets and unnecessary personal content out of the permanent journal. Raw email bodies, attachments and provider documents belong in separately controlled evidence storage, referenced by opaque IDs and integrity metadata where appropriate. Ordinary processing must not replace evidence content under an existing reference.

An explicitly authorized retention/redaction workflow may remove or restrict separately stored sensitive evidence and append an audit entry explaining its unavailability. It must not silently alter a historical journal assertion or pretend the removed content is still retrievable. MCP must return an explicit unavailable/redacted result when appropriate.

Do not implement routine pruning of canonical journal entries. If a deployment requirement demands deleting personal information that was mistakenly embedded in the journal, surface that conflict for an explicit policy/design decision instead of quietly weakening append-only protection. This specification is not a claim of legal compliance or indefinite recoverability of all raw evidence.

## 5. MCP scope: all authorized business records

The 24 supplied questions are acceptance examples and supported domain queries, not the limit of what an external agent can inspect. Provide composable, read-only tools covering all five tracks, their current states, complete recorded histories, entity relationships, provenance, conflicts, coverage and permitted evidence.

Complete access means the business data the caller is authorized to read in its tenant. It excludes other tenants, credentials, auth/session tables, internal operational secrets and unauthorized personal evidence. All tools enforce the same application authorization as the UI. No arbitrary SQL or business write/payment actions are required.

Implement the following logical capabilities. Exact names may be adjusted with a documented equivalent mapping; none of the capabilities may be omitted:

| Tool/capability | Required result |
| --- | --- |
| `describe_business_schema` | Available record/event types, filterable fields, relationships, units, time semantics and supported query capabilities; tenant-specific connector coverage without leaking other tenants |
| `list_journal_entries` | Cursor-paginated committed entries across every track, with filters for type, entity, source and effective/recorded time; stable snapshot boundary and continuation |
| `get_journal_entry` | One permitted entry with typed payload, provenance and correction/derivation links |
| `get_entity_history` | Complete paginated history and authorized related-record links for an entity; superseded entries remain accessible |
| `search_events` | Search over permitted recorded business events with structured filters, evidence references and explicit pagination/truncation status |
| `get_business_state` | Current or historical authorized state for an entity, including the five track views and calculation provenance |
| `get_evidence` | Permitted original evidence and derivation inputs; explicit unavailable/redacted state instead of broken links or invented content |
| `query_business` | Validated, bounded structured filters and permitted aggregates/grouping over exposed business records, plus the supported question intents; reject unsupported fields/operators and ambiguous money/quantity aggregation |

If `query_business` and the existing answer tool are separate, both must use the same shared domain/query services. Domain amounts and status calculations must not depend on an LLM performing ad hoc arithmetic over unrelated snapshots.

Every list/search/history result must distinguish an empty result from incomplete coverage, truncation, permissions or unavailable evidence. Return continuation information rather than silently dropping records. Reuse the same snapshot boundary across multi-page reads and related queries. Large datasets use bounded pages and resource quotas; complete access does not mean returning the entire database in one response.

Agents may answer additional questions by composing these tools. They must still return unknown/unsupported when the data, permissions or query capabilities are insufficient. Full read coverage is not a promise to answer every imaginable question correctly.

## 6. Required verification

- JOURNAL-01: demonstrate rejection of UPDATE, DELETE and TRUNCATE for actual API, worker and ingestion runtime roles, including immutable child rows and deletion through cascades. Verify that normal append operations still work with correct tenant authorization.
- JOURNAL-02: append a correction and a reversal; prove original entries remain unchanged and readable, current/historical state is correct, duplicates cause no extra effect, and replay rebuilds state. Same-identity/different-content input must preserve the original and expose the conflict.
- MCP-04: traverse all five tracks and their history/provenance through a protocol client, including an additional synthetic business record outside the 24 named question examples. Compare results with scoped domain services; assert cross-tenant denial and explicit missing/redacted evidence behavior.
- MCP-05: paginate beyond several pages while entries commit concurrently, including reversed commit order and rollbacks. Prove no omission or duplication within a fixed snapshot, correct continuation for later entries, and no cross-tenant cursor reuse.

These are core release gates. Record actual commands, tested commit, environment and evidence in reports/acceptance.json. Until executed, their status is not_started or implemented_unverified, never passed.
