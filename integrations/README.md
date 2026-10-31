# Working with the central integration register

Open **[INTEGRATIONS.md](../INTEGRATIONS.md)** to review progress as a human. It is the central source-by-source work list, with a five-track matrix and links to the exact required data. The file renders directly on GitHub; no application, database or spreadsheet software is needed.

The owner can give an agent this instruction:

> Work on the next first-release capability in INTEGRATIONS.md. Read its data contract and prerequisites, claim the row, implement the six required steps, run the actual tests and append the evidence. Regenerate the overview. Report what is implemented, what was tested, which fields remain missing and what is waiting for independent confirmation. Do not mark your own work independently approved.

## One authority for progress

- `integrations/register.json`: stable `provider.dataset` work IDs, release scope and per-mode transport investigation obligations (`transport_plan`). One provider has several independently tracked capabilities.
- `integrations/history.jsonl`: authoritative append-only progress/evidence history. Every action includes a unique ID, UTC recorded timestamp, actor identity/type and an explanation. Correct a mistake by adding an invalidation or new record; never rewrite old history.
- `INTEGRATIONS.md`: generated human-readable status, per-source work/evidence history and data requirements. Do not edit it by hand.
- `specs/question-data-contracts.json`: canonical field requirements, provider candidate mappings, journal families, Rust projections and affected question contracts. These are design requirements, not runtime status. Implementation mappings add exact source paths and semantics for each capability.
- `reports/question-coverage.json` and `reports/acceptance.json`: question and product acceptance evidence. They must cite corresponding integration row/test IDs when asserting source coverage. They do not replace the integration register.

The initial register has 127 rows covering 22 sources/internal producers. Roadmap rows are **desired capabilities pending API research**, not assertions that those providers expose the data. The initial release scope remains Shopify/Shopify Payments, easybill, DHL, the signed generic API, replay, bank CSV, versioned rules and internal ingestion/identity. No connector has been implemented or verified by preparing this list.

Every data family names its applicable Source, Fact, Commitment, Movement and Reservation tracks. These are logical linked views of the immutable journal, not a requirement to force every observation into five physical tables. The verified mapping must identify the precise tracks for each event. A carrier scan does not itself create a stock movement; an invoice payment marker does not create another cash receipt.

## Six implementation steps per capability

| Step | Required work and evidence |
| --- | --- |
| `mapping` | Pin provider API/import/event schema revision; exact source resource/path → canonical field; nullable/missing behavior, units/sign/currency/timezone, derivation rules, event-to-track mapping, account/entity identity, grants, coverage and permitted retention. Explicitly list unavailable fields. |
| `transport` | Configuration/authentication and tenant binding; credential checks; backfill/history window and all pagination; webhook authentication or justified polling/import equivalent; incremental cursor, reconciliation, rate limits/retry/backoff, revocation and disconnect. |
| `postgres` | Durable receipt, idempotency/conflicting delivery handling, immutable canonical observations/links, normalization provenance and transactional outbox. Late/corrected data append; runtime roles cannot mutate the journal. |
| `rust` | Deterministic reducers, tenant/entity indexes, bounded RAM publication only after durable commit, applied cursor, durable checkpoint, snapshot/tail restart and indexed cold access. |
| `query_mcp` | Shared API/MCP query and evidence traversal, all affected question cases, pagination/time semantics, explicit partial/unknown/conflict answers and committed/applied cursor coverage. |
| `operations` | Connection health, permissions and history gaps, dead letters/replay, metrics/redacted logs, schema changes, retention gates and a runbook for recovery/reconciliation. |

Reuse shared infrastructure and tests. Each row must link the code and cases proving that this capability actually uses it. An unrelated successful shared test cannot certify every adapter.

## Required verification

| Test kind | Minimum coverage |
| --- | --- |
| `contract` | Sanitized provider-shaped fixtures or typed internal payloads; positive/negative/null/unknown fields, pinned schema and money/quantity/identity semantics. Test supported fields and truthful unsupported behavior. |
| `pipeline` | Actual adapter/import → PostgreSQL → Rust → API **and** MCP, with expected values, evidence IDs and coverage. Use the affected question IDs and independent expected results. |
| `recovery` | Duplicate/reordered/late/corrected events, interrupted ingestion, cursor retry, restart/replay and cold hydration without double counting. |
| `tenant_isolation` | Actual application/worker database roles and connection pool reuse, unauthorized source/entity access and MCP isolation between two tenants. |
| `live` | Separately authorized provider sandbox/live account, actual merchant statement import, or authorized real producer as appropriate. Record exact environment, grants, source revision, exercised field subset and limitations. Synthetic fixtures are never live evidence. Internal rules/replay/runtime have no external-provider live gate. |

Tests have `passed`, `failed` or `blocked` outcomes. Failed/blocked evidence stays in history. Live access requires separate owner authorization under AGENTS.md; missing credentials must not prevent independent implementation and fixture/pipeline work. Record a blocker and next action. Never request customer secrets in a prompt or store them in this repository.

An independent reviewer must inspect/reproduce evidence, cite the current tests, confirm the tested code revision and acknowledge the exact missing-field, unsupported-event and unsupported-mode lists. The reviewer ID must differ from all implementation contributors and test recorders. This can be another authorized agent or person; do not invent a reviewer or alternate identity to self-approve. A self-check remains test evidence, not independent confirmation.

An approval may validate a **partial** source capability, including correctly returning unknown for missing data. The overview keeps its missing fields visible. Full product release additionally requires all 24 positive question paths and all other acceptance gates; passing this register cannot waive those requirements. If a provider lacks necessary fields, a verified supplemental producer must supply them before a complete live answer is possible.

## Update commands

From the repository root, with Python 3 and Git:

```sh
python3 scripts/integration-register.py check
python3 scripts/integration-register.py render
python3 scripts/integration-register.py append --event work/integration-event.json
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
```

`append` accepts one JSON event or an array, validates the result and regenerates the human view. An invalid append restores the original log. It does not fabricate actors, timestamps, code, tests or approvals. Use a real UTC timestamp at recording time; use the note to identify a separate earlier execution time if necessary.

```sh
python3 scripts/integration-register.py check --base FULL_PREVIOUS_COMMIT_SHA
python3 scripts/integration-register.py check --release
```

The first command also rejects edited/deleted prior history and missing row IDs; plan changes require an appended explanation. The second is an additional release check and intentionally fails on this unimplemented seed. Run it in the eventual product release pipeline before a release claim. Do not weaken it just because external access is unavailable. Ordinary PR checks allow honest unfinished work and roadmap rows.

### Recording progress

Every non-seed record has `id`, `row`, `at` (UTC, ending in `Z`), `actor` (`id`, `name`, `kind`: `human`, `agent` or `ci`), `action` and `note`. Agent IDs should identify the actual run/agent; describe model/version in the build-environment record. CI identities should reference a real run. These are recorded identities, not cryptographically authenticated human signatures.

Supported actions:

| Action | Additional fields / effect |
| --- | --- |
| `claim` | Assigns the recording actor to the row. |
| `progress` | `completed_steps`: subset of the six step IDs. Work claims remain separate from test proof. |
| `blocked` | `next_action`: exact prerequisite and verification step. Preserves completed work/tests. |
| `unblocked` | Explains how the previous blocker was resolved. |
| `plan_changed` | `authorization_or_decision`: owner instruction or decision reference explaining changed scope/requirements or new row. Never remove or reuse an existing row ID. |
| `invalidate` | Explains a correction or affected code change; clears current implementation/tests/approval while retaining all past records. |
| `implementation` | `commit`: full Git SHA; `contributors`: actual contributor IDs; `work`: explanations for all six step IDs; `code`: array of artifact references; `mapping`: artifact reference included in `code`. Starts a new revision and resets its tests/review. |
| `test` | `revision`: implementation event ID; `tested_commit`; `kind`; `result`; actual `command`, `environment`, `case_ids`, `modes`, `observed`; immutable `artifact`. Live tests also need `authorized_scope` and `source_revision`. |
| `review` | `revision`, `tested_commit`, `decision`: `approved` or `changes_requested`; `test_ids`; `acknowledged_missing_fields`; `acknowledged_unsupported_events`; `acknowledged_unsupported_modes`; immutable review `artifact`. Approval requires every applicable test kind to have passed and an independent actor. |

Artifact references have the shape `{"path":"reports/integrations/RUN_ID/result.txt","sha256":"ACTUAL_64_CHARACTER_SHA256"}`. Paths are repository-relative and cannot escape the repository. Preserve test/review artifacts under unique run paths, sanitized of secrets and personal data, and commit them. If large evidence is held externally, commit a durable sanitized summary with exact CI/artifact URL, immutable digest, retention and access instructions; a transient URL alone is insufficient.

Commit code and the mapping contract **before** recording the implementation event and running tests against that revision. `code` lists exact hashes of adapter/reducer/query/schema/migration/configuration/dependency files relevant to this row, including transitive shared code and lockfiles. The checker verifies them against the named Git revision and current files. Reviewers must check that the dependency list is complete. When relevant code changes, append `invalidate`, make the change, then record the new committed revision and rerun affected tests. Old mapping contracts are read from their historical Git commit; old test/review artifacts must remain available.

### Per-capability mapping artifact

Create a JSON artifact with:

- `row_id`, `source_revision`, `input_resources` (list), `grants` (list, explicitly empty for appropriate internal paths), `identity_rule`, `coverage_rule`.
- `retention`: `decision` (`permitted`, `restricted`, `unresolved`) and `basis` with the actual permission/agreement/policy reference. Unresolved/restricted rights cannot produce a passed live verification. In particular, do not override the DHL retention obligation with a generic statement.
- `fields`: exactly every `required_fields` name from the referenced dataset. Each has `status` (`source`, `derived`, `missing`), `normalization`, `missing_behavior`, and respectively `source_path`, `rule` or `reason`. A derived field must cite its actual versioned rule and evidence inputs. A missing field must disable complete-answer claims that require it.
- `synchronization`: complete lifecycle rules and all three mode profiles as defined in specs/SOURCE-SYNCHRONIZATION.md and the connectivity-mode section below.
- `import_readiness`: all nine concrete rule explanations defined in specs/IMPORT-ONBOARDING-AND-DATA-READINESS.md: `time_selection`, `historical_availability`, `open_and_related_records`, `opening_state`, `progress_accounting`, `readiness_rules`, `health_rules`, `history_expansion`, `data_handling`.
- `event_rules`: exactly one item per journal event family, with `event`, `tracks` and `rule`. Unsupported events have an empty track list and an explicit `unsupported_reason`. Event-level rules must not fabricate a movement or commitment from mere observation.

The data contracts give candidate paths and known caveats. The implementation agent must complete this artifact from actual schemas/fixtures and verify account coverage; copying a candidate field name is insufficient proof.

## Enforced checks and limits

The supplied GitHub Actions workflow checks the catalogue, register, generated overview, append-only history against the prior/base commit and the validator's regression suite. It rejects missing field/event mappings, absent or changed artifacts, mismatched commits, stale code evidence, missing test details, missing live proof where required, and self-approval. New capabilities must also be added to the source/data catalogue and this register in the same change.

Repository administrators must separately configure the `Integration register / validate` check as a required merge check and protect the branch if they want GitHub to prevent direct bypasses. This preparation does **not** change repository permissions or branch settings. Git history plus CI is an auditable engineering control, not an immutable database or a cryptographic guarantee of test execution. A repository administrator can change the controls; an independent review is still necessary.

Future product source cards and connection-health screens should consume capability manifests derived from the verified implementation subset. The product's runtime connection state remains tenant/account-specific and must never be inferred merely from a green development-register row.

## Connectivity-mode evidence (baseline v8)

Every row has a `transport_plan` for `local_standalone`, `local_gateway` and `public_server`. These are investigation obligations, not verified transport support. INTEGRATIONS.md renders a mode matrix beneath each source. All 127 rows remain unimplemented at this baseline. Read specs/SOURCE-SYNCHRONIZATION.md for the exact `synchronization` object required in each committed mapping artifact: initial import/cursors/reconciliation/dedup/freshness rules plus a status, methods, schedule, history limit, authentication, recovery, limitations and reason for each mode. Field mapping and mode support are distinct.

Test history records now require `modes`, a nonempty list of mode IDs actually exercised by that evidence. Contract tests cover all three, including truthful refusal for unsupported paths. Pipeline/recovery/tenant/live suites cover every supported or partial mode. Multiple runs can be summarized in one immutable record/artifact for that test kind; the latest record must preserve evidence for the whole required mode set, since it supersedes the prior current test record. Do not list a mode merely because shared code exists. Independent approval also includes `acknowledged_unsupported_modes`. The validator rejects direct webhooks in private modes, gateway webhooks outside gateway mode, missing mode declarations and approvals without required mode coverage.

A plan change requires appended `plan_changed` history for each affected row. These preparation records do not assign an implementer, count an implementation step or certify provider support. Provider limitations, credentials and the existing launch/roadmap scope remain unchanged.

## Historical import and readiness evidence (baseline v9)

Each row now has an `import_readiness_plan` investigation obligation. The generated source overview includes an expandable import/readiness section. The committed mapping must provide every `import_readiness` explanation above; the validator rejects missing/blank mappings. For provider sources, verify the actual timestamp/filter/history/grant semantics and accessible older open/related context. CSV and internal producers describe their real coverage and trigger instead of pretending to have a continuously synchronized provider.

Use existing contract/pipeline/recovery/tenant and applicable live evidence to prove the relevant IMPORT/HEALTH behaviors, with logical record counts, plan/run IDs, coverage intervals, missing prerequisites, actual query cutoffs and successful-sync versus new-event timestamps. A coherent explanation is not evidence of a successful import. Reviewers inspect the actual UI/API/MCP outcomes and source restrictions. Existing release gates and actor/commit/test/independence rules remain unchanged. The development register does not replace the product's per-tenant runtime Sources dashboard.
