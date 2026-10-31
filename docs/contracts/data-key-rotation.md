# Host data-key rotation

Run from the installation directory as its owning OS user:

```sh
./blackbox backup
./blackbox key rotate
# If interrupted, inspect local diagnostics and restore any missing original material, then:
./blackbox key resume
./blackbox status
```

The first command requires an enrolled backup destination and is recommended before maintenance. Rotation itself does not require an internet connection or provider login. It pauses API/MCP answers and collection, verifies referenced evidence and every stored provider envelope, records a security audit, and resumes only the previously running services. A missing/corrupt ciphertext or key leaves the operation fenced; normal `up`, `setup`, `reset-access`, backup and MCP startup cannot bypass the fence. Do not remove `.runtime/maintenance.json` or generate substitute keys. Resume requires the protected pending/active keys from the interrupted operation.

Installation material lives in `.runtime/secrets` (directory 0700, files 0600). `keyring.json` contains version IDs, not secret bytes. `identity` supplies stable opaque IDs; `internal` supplies internal authentication. `data` is the initial data version; later versions use `data-<32 lowercase hexadecimal characters>`. API/worker need the protected encryption directory. The engine receives only `internal`; the MCP container receives only its named read-only agent credential. Docker UID/GID mapping uses the owning host user.

Fresh installs support rotation. Early development installs without independent identity metadata report an explicit compatibility error and preserve their existing IDs; do not copy the old data key into `identity` or invent a keyring to bypass it. Restore an older backup with the matching recovery material; raw evidence/provider access remain guarded until the separate policy/account reconciliation workflow is complete.

Rotation preserves journal/evidence hashes and identity anchors. Existing encrypted backups retain their own keys and remain independently recoverable; retiring a live key does not redact those backups or guarantee physical erasure. Raw evidence expiry, restriction ledgers and canonical numeric retention are separate policies. No complete P4 or independent security approval follows from this command alone.
