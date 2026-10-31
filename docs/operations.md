# Operations: lifecycle, backups, restore, upgrade, secrets

## Lifecycle on a Mac
- `./blackbox up` starts the supervised containers; closing the browser does not stop collection.
- Stopping Docker Desktop, sleeping or shutting down the Mac stops processing. Nothing is processed while stopped and nothing is lost: journal, cursors and snapshots are durable. `./blackbox up` resumes and the engine applies the committed tail; polls catch up with their configured overlap (no burst replay of every missed interval: one coalesced job per connection).
- No autostart/keep-awake service or menu-bar daemon is installed.

## Secrets (ADR-008)
`.secrets/` (0700, files 0600) holds: database role passwords and URLs, the engine token, the installation data key (`data_key`, AES-256-GCM for provider tokens), and after backup configuration the backup recipient public key. The owner access key is never stored; only its SHA-256 verifier is in the database. Lost owner key: `./blackbox reset-access` (rotates the key, revokes agent keys, keeps business data). Missing/corrupt data key stops dependent operations with an actionable error; it is never regenerated over existing encrypted data.

## Backups
```
./blackbox backup --configure --destination /Volumes/Backup/blackbox   # enroll destination, create recovery key (shown once), verify round trip
./blackbox backup                                                        # encrypted generation now
./blackbox backup --status
```
A generation = encrypted tar of `pg_dump -Fc`, evidence objects, installation key material and a manifest (versions, committed/applied cutoffs, checksums). Creation holds the maintenance fence (API ingestion returns 503 with Retry-After; worker pauses), takes a consistent dump, encrypts in a stream (no plaintext left at the destination), writes `<name>.bbx.part` and renames atomically; a `<name>.manifest.json` sidecar (no secrets) sits next to it. Retention keeps the newest 7 daily and 4 weekly complete generations of this installation and never deletes the last one. A same-device destination is labelled as not protecting against device loss. Scheduling: the worker records `backup.overdue` when the newest complete generation is older than 24 h; the actual creation is the wrapper command (no OS service is installed). Recoverable age and overdue state appear in System & Diagnostics.

## Restore (isolated)
```
./blackbox restore /Volumes/Backup/blackbox/blackbox-backup-2026….bbx --into ~/blackbox-restored --port 19081
```
Prompts for the recovery key (hidden input), decrypts, verifies manifest/checksums/versions, creates a fresh project (own volumes, port, secrets from the backup's installation material), restores PostgreSQL and evidence, then fences access: owner key rotated and shown once, all agent keys revoked, provider connections paused until you review account bindings, engine snapshot pointers cleared (rebuild from the restored journal). The live installation is never overwritten.

## Upgrade
```
./blackbox upgrade --from ~/Downloads/blackbox-0.2.0   # extracted newer package
```
Preflight (compat manifest: schema/reducer/backup format/PostgreSQL major, free space), pre-upgrade backup (or `--use-backup` after verifying one), fence, stop writers, load images, serialized migrations, start, verify journal invariants and release info, release fence. Rollback is an isolated restore of the pre-upgrade generation; image rollback does not undo migrations.

## Diagnostics while the API is down
```
./blackbox logs --since 2h --level warn --component worker
./blackbox diagnostics export --since 1h --output report.json
./blackbox doctor
```
