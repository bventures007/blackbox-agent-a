#!/usr/bin/env bash
# ./blackbox restore FILE.bbx --into DIR [--port N] [--project NAME]
# Isolated restore into a fresh installation folder: decrypts with the recovery key (prompted, never an argument),
# verifies manifest and checksums, restores PostgreSQL and evidence, fences access (owner key rotated, agents revoked,
# provider connections paused) and starts the restored stack on its own port/project/volumes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ENV_FILE="$ROOT/infra/compose/.env"; CRYPTO="$ROOT/scripts/backup-crypto.mjs"
img() { grep -E '^BLACKBOX_IMAGE_NODE=' "$ENV_FILE" | cut -d= -f2; }
die() { echo "✖ $1" >&2; exit "${2:-1}"; }
FILE="${1:-}"; shift || true; INTO=""; PORT="19081"; PROJECT="blackbox-agent-a-restore"
while [ $# -gt 0 ]; do case "$1" in --into) INTO="$2"; shift;; --port) PORT="$2"; shift;; --project) PROJECT="$2"; shift;; esac; shift; done
[ -f "$FILE" ] || die "backup file not found: $FILE" 2; [ -n "$INTO" ] || die "--into DIR is required (isolated restore; the live installation is never overwritten)" 2
[ -e "$INTO" ] && [ -n "$(ls -A "$INTO" 2>/dev/null)" ] && die "$INTO exists and is not empty; choose an empty folder (no automatic overwrite)" 2
MANIFEST="${FILE%.bbx}.manifest.json"
START=$(date +%s)
printf 'Backup recovery key (input hidden): '; read -r -s REC; echo; [[ "$REC" =~ ^bbx_recovery_[a-z2-7]{52}$ ]] || die "malformed recovery key" 2
mkdir -p "$INTO"; TMP=$(mktemp -d "$INTO/.restore.XXXX"); trap 'rm -rf "$TMP"' EXIT
echo "▸ decrypting and verifying"
BBX_RECOVERY_KEY="$REC" docker run --rm -i --network none -e BBX_RECOVERY_KEY -v "$CRYPTO:/crypto.mjs:ro" "$(img)" node /crypto.mjs decrypt < "$FILE" > "$TMP/bundle.tar" || die "decryption failed: wrong recovery key or corrupted/incomplete backup" 4
unset REC
tar -C "$TMP" -xf "$TMP/bundle.tar" || die "bundle unreadable" 4
python3 - "$TMP" "$MANIFEST" <<'PY' || exit 4
import json, sys, hashlib, os
tmp, sidecar = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(tmp, 'manifest.json')))
assert m['format'] == 1, 'unsupported backup format'
assert m['schema_version'] == 1 and m['reducer_version'] == 'r1', f"incompatible versions in backup: schema {m['schema_version']} reducer {m['reducer_version']}"
for n, info in m['files'].items():
    h = hashlib.sha256(open(os.path.join(tmp, n), 'rb').read()).hexdigest()
    assert h == info['sha256'], f'checksum mismatch for {n}'
if os.path.exists(sidecar):
    s = json.load(open(sidecar)); assert s['generation_id'] == m['generation_id'], 'sidecar manifest belongs to another generation'
print('manifest ok:', m['generation_id'], m['kind'], m['created_at'], 'cutoffs', json.dumps(m['cutoffs'])[:200])
PY
echo "▸ preparing isolated installation at $INTO (project $PROJECT, port $PORT)"
mkdir -p "$INTO/infra/compose" "$INTO/scripts" "$INTO/release" "$INTO/.secrets" "$INTO/.local"; chmod 700 "$INTO/.secrets"
cp -R "$ROOT/infra/compose/compose.yaml" "$ROOT/infra/compose/.env.example" "$ROOT/infra/compose/postgres-init" "$INTO/infra/compose/"; cp "$ROOT/blackbox" "$INTO/blackbox"; cp "$ROOT"/scripts/*.sh "$ROOT"/scripts/*.mjs "$INTO/scripts/"; cp "$ROOT/release/VERSION" "$INTO/release/VERSION" 2>/dev/null || true
sed -e "s/^BLACKBOX_PROJECT=.*/BLACKBOX_PROJECT=$PROJECT/" -e "s/^BLACKBOX_PORT=.*/BLACKBOX_PORT=$PORT/" "$ENV_FILE" > "$INTO/infra/compose/.env"
umask 077; tar -C "$INTO/.secrets" -xf "$TMP/installation-material.tar"; chmod 600 "$INTO/.secrets"/*
for r in migrator api worker engine; do printf 'postgres://bbx_%s:%s@postgres:5432/blackbox\n' "$r" "$(cat "$INTO/.secrets/pg_${r}_password")" > "$INTO/.secrets/url_$r"; done
(cd "$INTO/infra/compose" && docker compose --env-file .env up -d postgres) >/dev/null
i=0; until (cd "$INTO/infra/compose" && docker compose --env-file .env exec -T postgres pg_isready -U postgres -d blackbox) >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && die "restored PostgreSQL did not start"; sleep 1; done
echo "▸ restoring database and evidence"
(cd "$INTO/infra/compose" && docker compose --env-file .env exec -T postgres pg_restore -U postgres -d blackbox --no-owner --role=bbx_migrator) < "$TMP/db.dump" || die "pg_restore failed"
docker run --rm -i -v "${PROJECT}_data:/d" alpine sh -c 'mkdir -p /d && tar -C /d -xf -' < "$TMP/evidence.tar" || true
echo "▸ fencing restored access: rotating owner key, revoking agent keys, pausing provider connections"
OUT=$(cd "$INTO/infra/compose" && docker compose --env-file .env run --rm --no-deps -T api node apps/api/dist/cli.js restore-fence) || die "fencing failed"
(cd "$INTO" && ./blackbox up >/dev/null)
END=$(date +%s)
echo; echo "Restore complete in $((END-START)) s machine time (operator input time not included)."; echo "New owner access key for the restored installation (shown once): $(echo "$OUT" | awk '/BLACKBOX_OWNER_KEY/{print $2}')"
echo "Restored UI: http://127.0.0.1:$PORT/  · provider connections are paused until you review account bindings in Sources · old agent keys are revoked."
