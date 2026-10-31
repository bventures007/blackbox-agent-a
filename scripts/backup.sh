#!/usr/bin/env bash
# ./blackbox backup [--configure --destination DIR] | [--now] ; see docs/operations.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; SECRETS="$ROOT/.secrets"; LOCAL="$ROOT/.local"; ENV_FILE="$ROOT/infra/compose/.env"; CRYPTO="$ROOT/scripts/backup-crypto.mjs"
compose() { (cd "$ROOT/infra/compose" && docker compose --env-file "$ENV_FILE" "$@"); }
img() { grep -E '^BLACKBOX_IMAGE_NODE=' "$ENV_FILE" | cut -d= -f2; }
proj() { grep -E '^BLACKBOX_PROJECT=' "$ENV_FILE" | cut -d= -f2; }
version() { cat "$ROOT/release/VERSION" 2>/dev/null || echo 0.1.0-dev; }
# node_run [-e VAR ...] <subcommand> [args]: leading -e options go to docker, the rest is the crypto helper's own command line
node_run() { local dargs=(); while [ $# -gt 0 ] && [ "$1" = "-e" ]; do dargs+=("$1" "$2"); shift 2; done; docker run --rm -i --network none -v "$CRYPTO:/crypto.mjs:ro" "${dargs[@]}" "$(img)" node /crypto.mjs "$@"; }
cli() { compose run --rm --no-deps -T api node apps/api/dist/cli.js "$@"; }
log() { printf '{"schema_version":1,"level":"%s","component":"wrapper","event_name":"backup.%s","message":"%s","occurred_at":"%s"}\n' "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOCAL/setup.log"; echo "▸ $3"; }
die() { log ERROR failed "$1"; echo "✖ $1" >&2; exit "${2:-1}"; }

configure() {
  local dest="${1:-}"; [ -n "$dest" ] || die "--destination DIR is required (a folder outside this installation, ideally on a separate volume)" 2
  case "$dest" in "$ROOT"*) die "destination must be outside the installation folder" 2;; esac
  mkdir -p "$dest" || die "cannot create $dest" 2; [ -w "$dest" ] || die "destination not writable" 2
  if ! mount | grep -q " on $(df "$dest" | awk 'NR==2{print $NF}') " 2>/dev/null; then :; fi
  local same_device="false"; [ "$(df "$dest" | awk 'NR==2{print $1}')" = "$(df "$ROOT" | awk 'NR==2{print $1}')" ] && same_device="true"
  local keys; keys=$(node_run keygen) || die "key generation failed"
  local pub rec; pub=$(echo "$keys" | python3 -c 'import json,sys;print(json.load(sys.stdin)["public_hex"])'); rec=$(echo "$keys" | python3 -c 'import json,sys;print(json.load(sys.stdin)["recovery_key"])')
  # verify an encrypt/decrypt round trip before the transient secret is discarded
  local probe="roundtrip-$(date +%s)"; local out; out=$(printf '%s' "$probe" | node_run encrypt "$pub" 2>/dev/null | BBX_RECOVERY_KEY="$rec" node_run -e BBX_RECOVERY_KEY decrypt) || die "round trip failed"
  [ "$out" = "$probe" ] || die "round trip mismatch"
  umask 077; printf '%s\n' "$pub" > "$SECRETS/backup-recipient.pub"; printf '%s\n' "$dest" > "$SECRETS/backup-destination"; echo "$same_device" > "$SECRETS/backup-same-device"
  cli backup-config --destination "$dest" --same-device "$same_device" >/dev/null || die "could not record backup configuration"
  log INFO configured "backup destination enrolled (same_device=$same_device); recovery key shown once"
  cat <<MSG

  Backup recovery key / Wiederherstellungsschlüssel (shown once / einmalig):

      $rec

  EN: Save it separately from your access key (password manager). Without it, backups cannot be restored.
      Scheduled backups encrypt with the public part only; this secret is never stored by Blackbox.
      ${same_device:+}$( [ "$same_device" = "true" ] && echo "Note: the destination is on the same device; this does not protect against device loss." )
  DE: Bewahre ihn getrennt vom Zugangsschlüssel auf (Passwort-Manager). Ohne ihn können Sicherungen nicht wiederhergestellt werden.
      Geplante Sicherungen verschlüsseln nur mit dem öffentlichen Teil; Blackbox speichert dieses Geheimnis nie.
MSG
}

create() {
  local kind="${1:-manual}"
  [ -f "$SECRETS/backup-recipient.pub" ] || die "backups are not configured: ./blackbox backup --configure --destination DIR" 2
  local dest; dest=$(cat "$SECRETS/backup-destination"); [ -d "$dest" ] && [ -w "$dest" ] || die "backup destination $dest is unavailable (unmounted?); nothing written" 2
  [ -n "$(ls -A "$dest" 2>/dev/null || true)" ] || [ -w "$dest" ] || true
  local pub; pub=$(cat "$SECRETS/backup-recipient.pub"); local ts; ts=$(date -u +%Y%m%dT%H%M%SZ); local gen="blackbox-backup-$ts"; local tmp; tmp=$(mktemp -d "$dest/.tmp-$gen.XXXX")
  trap 'cli fence release backup >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  cli fence acquire backup 1800 >/dev/null || die "another maintenance operation holds the fence" 2
  log INFO started "backup $gen started ($kind); writers fenced"
  sleep 2 # let in-flight ingestion transactions commit
  local cutoffs; cutoffs=$(cli cutoffs) || die "could not read journal cutoffs"
  local gen_id; gen_id=$(cli backup-record start "$kind" "$dest" "$gen.bbx" "$cutoffs") || die "could not record generation"
  mkdir -p "$tmp/bundle"
  compose exec -T postgres pg_dump -U postgres -Fc blackbox > "$tmp/bundle/db.dump" || die "pg_dump failed"
  docker run --rm -v "$(proj)_data:/d:ro" alpine sh -c 'if [ -d /d/evidence ]; then tar -C /d -cf - evidence; else tar -cf - -T /dev/null; fi' > "$tmp/bundle/evidence.tar" || die "could not collect evidence files"
  tar -C "$SECRETS" -cf "$tmp/bundle/installation-material.tar" data_key engine_token backup-recipient.pub pg_migrator_password pg_api_password pg_worker_password pg_engine_password pg_superuser_password 2>/dev/null || die "could not collect installation material"
  python3 - "$tmp/bundle/manifest.json" "$gen_id" "$kind" "$(version)" "$cutoffs" "$tmp/bundle" <<'PY'
import json, sys, hashlib, os
path, gen_id, kind, version, cutoffs, bundle = sys.argv[1:7]
files = {}
for n in ('db.dump', 'evidence.tar', 'installation-material.tar'):
    p = os.path.join(bundle, n); h = hashlib.sha256(); 
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    files[n] = {'sha256': h.hexdigest(), 'bytes': os.path.getsize(p)}
json.dump({'format': 1, 'generation_id': gen_id, 'kind': kind, 'app_version': version, 'schema_version': 1, 'reducer_version': 'r1', 'postgres_major': 17, 'created_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z', 'cutoffs': json.loads(cutoffs), 'files': files, 'redaction_ledger_included': True}, open(path, 'w'), indent=1)
PY
  tar -C "$tmp/bundle" -cf - manifest.json db.dump evidence.tar installation-material.tar | node_run encrypt "$pub" 2> "$tmp/encrypt.json" > "$tmp/$gen.bbx.part" || die "encryption failed"
  local sha; sha=$(shasum -a 256 "$tmp/$gen.bbx.part" | awk '{print $1}'); local bytes; bytes=$(wc -c < "$tmp/$gen.bbx.part" | tr -d ' ')
  mv "$tmp/$gen.bbx.part" "$dest/$gen.bbx" && python3 -c "import json,sys; m=json.load(open('$tmp/bundle/manifest.json')); m['ciphertext_sha256']='$sha'; m['ciphertext_bytes']=$bytes; json.dump(m, open('$dest/$gen.manifest.json','w'), indent=1)"
  cli backup-record complete "$gen_id" "$sha" "$bytes" >/dev/null || die "could not finalize generation record"
  rm -rf "$tmp/bundle"
  cli fence release backup >/dev/null; trap - EXIT; rm -rf "$tmp"
  log INFO completed "backup $gen.bbx completed ($bytes bytes, sha256 $sha)"
  retention "$dest"
  echo "Backup written: $dest/$gen.bbx (sha256 $sha). Plaintext staging was removed."
}
retention() {
  # keep the newest 7 daily and 4 weekly complete generations owned by this installation; never delete the last usable one
  local dest="$1"; python3 - "$dest" <<'PY'
import json, os, sys, datetime
dest = sys.argv[1]; gens = []
for n in sorted(os.listdir(dest)):
    if n.endswith('.manifest.json'):
        try: m = json.load(open(os.path.join(dest, n)))
        except Exception: continue
        bbx = os.path.join(dest, n.replace('.manifest.json', '.bbx'))
        if os.path.exists(bbx) and 'ciphertext_sha256' in m: gens.append((m['created_at'], bbx, os.path.join(dest, n)))
gens.sort(reverse=True)
keep = set(); daily = {}; weekly = {}
for created, bbx, man in gens:
    d = created[:10]; w = datetime.date.fromisoformat(d).isocalendar()[:2]
    if d not in daily and len(daily) < 7: daily[d] = bbx; keep.add(bbx)
    if w not in weekly and len(weekly) < 4: weekly[w] = bbx; keep.add(bbx)
if gens: keep.add(gens[0][1])
removed = 0
for created, bbx, man in gens:
    if bbx not in keep: os.remove(bbx); os.remove(man); removed += 1
print(f'retention: {len(gens)} generations, kept {len(keep)}, removed {removed}')
PY
}
case "${1:-}" in
  --configure) shift; dest=""; while [ $# -gt 0 ]; do case "$1" in --destination) dest="$2"; shift;; esac; shift; done; configure "$dest";;
  --now|"") create manual;;
  --scheduled) create scheduled;;
  --pre-upgrade) create pre_upgrade;;
  --status) cli backup-status;;
  *) echo "usage: ./blackbox backup [--configure --destination DIR] [--now] [--status]"; exit 2;;
esac
