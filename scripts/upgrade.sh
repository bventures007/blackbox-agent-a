#!/usr/bin/env bash
# ./blackbox upgrade --from DIR   Fenced upgrade of this installation to the release extracted in DIR (new images + migrations).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ENV_FILE="$ROOT/infra/compose/.env"; LOCAL="$ROOT/.local"
compose() { (cd "$ROOT/infra/compose" && docker compose --env-file "$ENV_FILE" "$@"); }
cli() { compose run --rm --no-deps -T api node apps/api/dist/cli.js "$@"; }
die() { echo "✖ $1" >&2; exit "${2:-1}"; }
FROM=""; SKIP_BACKUP=0; while [ $# -gt 0 ]; do case "$1" in --from) FROM="$2"; shift;; --use-backup) SKIP_BACKUP=1;; esac; shift; done
[ -n "$FROM" ] && [ -f "$FROM/release/compat.json" ] || die "--from DIR must point to an extracted release with release/compat.json" 2
NEWV=$(cat "$FROM/release/VERSION"); CURV=$(cat "$ROOT/release/VERSION")
echo "▸ preflight: $CURV -> $NEWV"
python3 - "$FROM/release/compat.json" "$ROOT/release/compat.json" <<'PY' || die "incompatible release (see above); no data was changed" 2
import json, sys
new = json.load(open(sys.argv[1])); cur = json.load(open(sys.argv[2])) if __import__('os').path.exists(sys.argv[2]) else {}
assert new['postgres_major'] == cur.get('postgres_major', new['postgres_major']), 'PostgreSQL major version change is not an in-place upgrade'
assert new['schema_version'] >= cur.get('schema_version', 0), 'cannot downgrade schema'
assert new['backup_format'] == 1, 'backup format change requires a new recovery procedure'
print('compat ok: schema', cur.get('schema_version'), '->', new['schema_version'], '| reducer', cur.get('reducer_version'), '->', new['reducer_version'], '| rebuild required:', new['reducer_version'] != cur.get('reducer_version'))
PY
free=$(df -g "$ROOT" | awk 'NR==2{print $4}'); [ "${free:-0}" -ge 3 ] || die "less than 3 GiB free; upgrade needs space for images and a backup" 2
if [ $SKIP_BACKUP = 0 ]; then "$ROOT/scripts/backup.sh" --pre-upgrade || die "pre-upgrade backup failed; use --use-backup only after verifying an existing recoverable generation" 2; else cli backup-status | grep -q '"complete"' || die "no complete backup generation recorded" 2; fi
cli fence acquire upgrade 3600 >/dev/null || die "fence held by another operation" 2
trap 'cli fence release upgrade >/dev/null 2>&1 || true' EXIT
echo "▸ stopping writers (api, worker); engine keeps serving reads of the last published state"
compose stop api worker >/dev/null
if ls "$FROM"/release/images/*.tar >/dev/null 2>&1; then for t in "$FROM"/release/images/*.tar; do docker load -i "$t" >/dev/null; done; fi
cp "$FROM/release/VERSION" "$ROOT/release/VERSION"; cp "$FROM/release/compat.json" "$ROOT/release/compat.json"; cp "$FROM/infra/compose/compose.yaml" "$ROOT/infra/compose/compose.yaml"; cp -R "$FROM/scripts/." "$ROOT/scripts/"; cp "$FROM/blackbox" "$ROOT/blackbox"
sed -i '' "s/^BLACKBOX_VERSION=.*/BLACKBOX_VERSION=$NEWV/; s#^BLACKBOX_IMAGE_NODE=.*#BLACKBOX_IMAGE_NODE=$(grep '^BLACKBOX_IMAGE_NODE=' "$FROM/infra/compose/.env.example" | cut -d= -f2)#; s#^BLACKBOX_IMAGE_ENGINE=.*#BLACKBOX_IMAGE_ENGINE=$(grep '^BLACKBOX_IMAGE_ENGINE=' "$FROM/infra/compose/.env.example" | cut -d= -f2)#" "$ENV_FILE"
echo "▸ applying serialized migrations with the new image"
cli migrate || die "migration failed; the fence stays released only after you restore the pre-upgrade backup or rerun" 1
compose up -d engine api worker >/dev/null
i=0; until curl -fsS -m 3 -H "Host: 127.0.0.1:$(grep '^BLACKBOX_PORT=' "$ENV_FILE" | cut -d= -f2)" "http://127.0.0.1:$(grep '^BLACKBOX_PORT=' "$ENV_FILE" | cut -d= -f2)/api/health/live" >/dev/null; do i=$((i+1)); [ $i -gt 90 ] && die "api did not come back"; sleep 1; done
echo "▸ verifying journal invariants and a representative answer"
cli verify-upgrade || die "post-upgrade verification failed; see output"
cli fence release upgrade >/dev/null; trap - EXIT
echo "Upgrade to $NEWV complete. Rollback: ./blackbox restore <pre-upgrade generation> --into <empty folder> (image rollback alone does not undo migrations)."
