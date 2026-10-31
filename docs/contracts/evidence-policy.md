# Raw evidence policy and restore reconciliation

Schema8 adds immutable evidence context, policy revisions, provider ceilings, restriction intents and disposal completions. All carry tenant identity and FORCE RLS. API/worker may append context; only API may append owner policy/restriction commands. Runtime identities cannot update/delete these records, insert provider ceilings or claim physical disposal. Host maintenance owns those last two operations. Canonical journal and numeric projections are not changed by raw-content restrictions.

Default retention is 90 days from local receipt, independent of an observation's business-effective time. An explicitly selected source/class policy determines a new receipt's expiry. Source plus class is most specific; a source-only selection takes precedence over class-only when specificity ties. An owner selects a business-requirement reason to exceed 90 days, up to the supported 3650-day bound. Later shorter matching policies permanently reduce existing content's lifetime; later increases cannot revive it. Every recorded provider ceiling is a hard upper bound. There is no claim that a particular live provider restriction has been certified without mapping research and authorized verification.

`bb.evidence_retention` is the shared security-invoker predicate for raw reads, repair evidence, verification, backup inclusion and key rotation. `retained` describes storage/backup eligibility; `accessible` additionally respects the restore guard. This distinction allows an encrypted restore to verify retained ciphertext while preventing human/agent access. Expired or restricted IDs return the same unavailable response as unknown/cross-tenant IDs. Raw reads hold the workspace head lock in shared mode; policy/restriction commands take it exclusively and recheck the owner session. A request authorized before an intent commits can finish before that intent; subsequent reads cannot reopen it.

EN/DE Settings supports source/class policies; Shopify's pre-import preview displays the effective days. Original-content dialogs have an explicit acknowledged restriction action. Browser evidence is refreshed and not shown after a failed refresh. Content already copied, downloaded or photographed cannot be revoked by this application.

Host commands:

```sh
./blackbox evidence purge
./blackbox evidence resume
./blackbox evidence export-ledger /absolute/private/current-ledger.json
./blackbox evidence reconcile --ledger /absolute/private/current-ledger.json --acknowledge-cutoff EXACT_RECOVERABLE_CUTOFF
./blackbox evidence reconcile --acknowledge-cutoff EXACT_RECOVERABLE_CUTOFF
```

Purge serializes with backup/key maintenance, stops application writers, verifies cluster/schema identity and commits restriction intent/audit before unlink. It only removes owned private single-link regular files under exact UUID evidence directories. A file safety error leaves the persistent fence; repair the unsafe local condition and resume explicitly. Missing files count as already absent, and disposal completion is append-only. Exact abandoned atomic-write filenames and unreferenced UUID objects are cleaned under the same fence; unknown files are left alone. Batch/budget limits fail visibly and can resume. No raw search index or temporary raw export is implemented; numeric projections are retained. Automatic periodic purging remains pending; at this increment the owner runs the guarded host command, while expiry denies access immediately.

The separate bounded ledger contains only opaque IDs, enumerated reasons, selected days and timestamps. HMAC-SHA256 authenticates its canonical format with the stable installation identity key, which data-key rotation preserves. Legacy coupled identities remain explicitly supported without key retirement. Exports use private files; new encrypted backups contain the same ledger and all policy tables. Schema8 backup validation checks the ledger before creating a restore destination. Source schemas5/6/7 remain explicitly supported by their existing strict compatibility readers and additive migration path.

Older restores remain raw-blocked. The owner must acknowledge the exact backup cutoff. A supplied current ledger must authenticate, postdate that cutoff and pass strict bounded record validation. Its policy/restriction entries merge without overwriting existing decisions, denied files are removed and retained material verified before clearing only the evidence guard. Provider collection remains separately blocked. Without a current ledger, the explicit no-ledger command records the owner's cutoff decision; it cannot reconstruct restrictions made after that backup, and may reopen otherwise-retained content only because the owner expressly reconciles that uncertainty. Never describe this as guaranteed erasure.

Existing immutable backup generations and exported copies are unchanged. The configured backup retention process handles its enrolled generations; separate copies remain outside control. Accidental canonical personal data is an incident requiring an explicit design/policy decision, not permission for ordinary journal UPDATE/DELETE.

Current data classification: original provider JSON, owner notes and raw documents belong in encrypted evidence; typed journal fields are schema-allowlisted business values and opaque local anchors; provider credentials use the separate tenant/connection-bound secret table. Context/ledger rows contain only UUIDs, enumerations, days and times. A complete per-field inventory across every selected connector is still required; this description does not substitute for that audit.

Verification: `python3 -m unittest discover -s scripts/tests`; `python3 scripts/verify-evidence-policy.py --output .runtime/evidence-policy.json`; `python3 scripts/verify-evidence-recovery.py --output .runtime/evidence-recovery.json --node-image-commit COMMIT --engine-image-commit COMMIT`. The latter uses fresh synthetic Compose resources and never erases unrelated volumes. Clean results are recorded separately; these commands alone are not passing evidence or independent approval.
