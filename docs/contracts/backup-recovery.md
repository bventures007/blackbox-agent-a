# Host backup and isolated restore — implementation checkpoint

Manual backup and isolated restore are implemented. Scheduling, retention generations, owner policy reconciliation, upgrade recovery and full acceptance remain in progress. Do not treat this checkpoint as completed backup protection or a released installation package.

Developer preparation uses `python3 scripts/fetch-host-tools.py`; the eventual installation archive bundles those pinned host executables. It never installs global software. The ordinary runtime needs Docker/Compose; PostgreSQL, application code and maintenance verification run in the pinned containers. No recovery secret is passed on command arguments or stored by the product beside a backup.

From an initialized installation with its protected data keys:

```
./blackbox backup configure /absolute/existing-owned-destination
./blackbox backup
```

Configuration requires a protected terminal. Save the separate age recovery identity when shown, outside the installation and backup destination. The wrapper checks an initial encryption/decryption round trip before saving only public recipient material. Configuration can be postponed; an unconfigured installation has no backup protection. The configured directory is pinned by device/inode and a private installation-owned child. A missing/unmounted/replaced destination fails rather than becoming a new directory on the system disk. Same-device backup is labeled as not protecting against device loss.

Backup takes an exclusive host maintenance lock, records a durable fence, stops API/worker/engine writers, waits for the final PostgreSQL TCP listener, verifies every retained evidence ciphertext against the actual data key and database hash, then streams a consistent custom dump, keys and referenced evidence into age. It records committed/applied heads and verifies they did not change. Atomic publication follows encryption completion and file fsync. Services return to their prior state even on failure; unfinished maintenance blocks ordinary startup. Failed generations are not valid restores. No raw dump is staged on disk. Expired evidence is excluded and its provenance retained in encrypted policy metadata. Full redaction-ledger reconciliation remains outstanding.

Restore always uses a new destination:

```
./blackbox restore /absolute/generation.bb.age --to /absolute/new-installation --port 18755
```

The wrapper prompts for recovery material without echoing it. It first authenticates and validates the complete archive, paths, file set, hashes, database chunk ordering and known compatibility. Wrong keys, corrupt/incompatible archives and existing targets fail without overwriting an installation. A second authenticated pass restores to a fresh isolated PostgreSQL volume and protected files. The fresh empty initialization schema is removed before restoring the dump; global database roles/passwords are newly generated, and original application grants are restored. Known schema-5 preview backups receive the additive recovery-guard migration before services can start. Unknown contracts fail explicitly.

All old owner/agent/producer/session credentials are revoked. The data/identity keys are recovered; the internal authentication/cursor secret stays newly generated. Connections are paused, source leases fenced and raw-content/provider guards installed before HTTP starts. A new owner key is issued through the protected terminal; save it and log in again. Numeric journal-derived answers remain available. Raw evidence and provider collection stay blocked until explicit host policy/account reconciliation; that follow-up workflow is still being implemented. No backup is advertised as recovering access with only a lost personal login key.

An interruption during the owner-key/startup stage can be resumed with:

```
./blackbox restore resume --to /absolute/new-installation
```

Resume revokes access and issues a fresh owner key again before startup. A failure earlier during database/file restoration leaves the new destination stopped and fenced; retry into another new destination from the unchanged backup. This is not an in-place replacement or automatic downgrade. Detailed interrupted-operation recovery and upgrade tooling are still in progress.

Clean e09de97 verified recovery after removing the original synthetic installation, volume and local keys. The separately retained recovery key opened the backup; restored key material decrypted all retained evidence before HTTP, old owner/agent/session credentials failed, and new API/actual SDK MCP credentials reproduced the saved fixed-cutoff answer. Wrong live keys, tampered retained evidence, wrong recovery keys and corrupted ciphertext were rejected. Run `python3 scripts/verify-backup-recovery.py --output .runtime/recovery.json --node-image-commit IMAGE_SOURCE_COMMIT --engine-image-commit ENGINE_SOURCE_COMMIT` against recorded prebuilt development images. It creates and removes only its own new synthetic installation, then stops the recovered test services.

Evidence: reports/runs/backup-recovery-e09de97. The 55-entry/one-object/124555-byte fixture took 32.96 seconds from simulated original loss to authorized API and MCP queries (automated operator, effectively no input delay). This is not the required 250-MiB smoke recovery-time result. Policy reconciliation, scheduler/retention, complete operations, distribution and independent approval remain outstanding.
