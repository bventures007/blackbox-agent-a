# ADR-008 Installation data key, authenticated encryption and backup envelope

**Status:** accepted 2026-10-31 (P0); validated by PILOT-01/02/07/08.

- `./blackbox setup` creates `.secrets/data.key` (32 CSPRNG bytes, 0600, directory 0700) and `.secrets/engine.token`. Only the API and worker mount the data key read-only; the engine mounts only its token.
- Provider credentials and sensitive directory values are encrypted with AES-256-GCM (Node `crypto`), 12-byte random nonce, AAD = `tenant_id|purpose|key_version`, stored as `v1:<key_version>:<nonce>:<ciphertext+tag>`. Key versions allow rotation (`./blackbox rotate-data-key`): new values use the new key, existing rows are re-encrypted in checkpointed batches, the old key is retired only after verification.
- Backups: `./blackbox backup` quiesces writers via the maintenance fence, runs `pg_dump --format=custom` of the database, copies referenced evidence and the installation key material, and streams them through AES-256-GCM in 1 MiB chunks. The file key is wrapped for the backup **recovery key pair** (X25519; public key stored in `.secrets/backup-recipient.pub`, private key shown once as `bbx_recovery_...` and never persisted). Manifest with versions, cutoffs, checksums and redaction-ledger state is included; finalisation is by atomic rename. This mirrors the age envelope design using Node's maintained primitives; no custom cipher.
- Owner/agent login keys are verifier-only and unrelated to any encryption key (ADR-003).
