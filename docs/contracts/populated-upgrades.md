# Fenced populated upgrades

The implemented path upgrades an exact schema8 PostgreSQL17 installation to schema10, or replaces schema10 images with the same runtime/rule contract. Schema7 and older supported archives use isolated restore. This command does not implement changed-rule projection publication and does not establish full PILOT-03 acceptance.

Use the new versioned host bundle in the existing installation directory, preserving `.runtime` and its original PostgreSQL volume. The old application containers contain their own code; replacing host files does not migrate their data. The distribution installer must deliver the matching host files and immutable Node/engine image identities. Until that distribution work is complete, the test suite explicitly copies the host bundle and records the exact images; this is developer validation, not a landing-download installation claim.

From the installation directory:

```sh
./blackbox upgrade --node-image sha256:<node-image-id> --engine-image sha256:<engine-image-id>
./blackbox upgrade --status
./blackbox logs --component wrapper --since 1h
```

The interactive command prompts for the independently saved backup recovery key. Never put its bytes in an argument, URL or log. Configure a reachable backup destination beforehand using `./blackbox backup configure /absolute/owned/destination`. The upgrade creates a new encrypted generation and decrypts/authenticates the entire archive before migration. A wrong recovery identity, unavailable destination or failed verification leaves migration blocked; there is no skip-backup option.

The command checks target image contracts without network access, installation mounts or credentials, verifies the original database identity, and holds one exclusive maintenance lease through backup, migration and validation. It preserves the target host files under `.runtime/upgrade-bundles/<operation-id>` and records their hashes plus both original and target image IDs. Protected `.runtime/release-images.json` pins all application components to immutable images and allows no extra mounts, environment or commands.

API/worker/engine stop before the coherent checkpoint. A temporary private engine drains existing derivations and captures up to eight representative answers per workspace at fixed cutoffs (maximum 64 workspaces/512 cases). A complete streaming journal digest, heads, schema constraints and RLS checks complement those samples. Probe credentials have no corresponding plaintext login key and are revoked after each probe. Only request scope and integrity hashes are saved; answer bodies are not logged.

Each migration and its checksum entry commit in one PostgreSQL transaction under a migration lock. The runtime contract remains fenced during migration. API and worker remain stopped while the target private engine verifies matching answers; the immutable journal digest and encryption readability must still match. The durable `resuming` phase precedes restarting application traffic. A retry in that phase allows subsequently accepted work rather than demanding the old cutoff again.

After interruption, restore the exact recorded host bundle if its files changed, then run:

```sh
./blackbox upgrade --resume
```

Resume takes the same lease, checks the preserved files/images, stops any probe container belonging to this operation, reasserts service fencing and validates the actual committed migration prefix. It never guesses that an interrupted transaction completed, overwrites an applied migration or downgrades the database. A saved failure contains a fixed error code and keeps its resumable phase. CLI diagnostics remain available while HTTP/MCP are stopped. The application provides EN/DE summaries for the allowlisted upgrade events after it resumes.

Rollback means an isolated restore of the recorded pre-upgrade generation with the recovery key and stale-access fencing, using `./blackbox restore <backup-path> --to <new-directory> --port <unused-loopback-port>`. That cutoff excludes later work. Do not point old images at the migrated database or delete the original volume to simulate rollback. A failed migration with no safe forward fix stays fenced until explicit recovery.

`scripts/verify-populated-upgrade.py` exercises the real schema8 installation, mismatched image refusal, wrong valid recovery identity, an actual SIGKILL after a committed migration, changed-file refusal, successful resume, API/SDK MCP/restart parity and an actual isolated restore of the pre-upgrade generation. Its synthetic pause makes the kill point repeatable; it is not a production hook. Run it with a hashed prior bundle and exact target image IDs, and preserve its output with the tested commit. Small-fixture times are not the smoke performance or recovery target.
