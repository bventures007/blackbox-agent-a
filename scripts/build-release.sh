#!/usr/bin/env bash
# Build the versioned local installation archive: wrapper, pinned Compose, bundled images, EN/DE guide, manifest + SHA-256.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; REUSE=0; if [ "${1:-}" = "--reuse-images" ]; then REUSE=1; shift; fi; VERSION="${1:-$(cat "$ROOT/release/VERSION")}"; OUT="$ROOT/release/dist"; NAME="blackbox-$VERSION"; STAGE="$OUT/$NAME"
rm -rf "$STAGE"; mkdir -p "$STAGE/infra/compose" "$STAGE/scripts" "$STAGE/release/images" "$STAGE/docs" "$OUT"
if [ $REUSE = 1 ] && docker image inspect "blackbox-agent-a/node:$VERSION" "blackbox-agent-a/engine:$VERSION" >/dev/null 2>&1; then echo "▸ reusing locally built images for $VERSION (--reuse-images)"; else
echo "▸ building images for $VERSION"
docker build -q -f "$ROOT/infra/docker/node.Dockerfile" -t "blackbox-agent-a/node:$VERSION" --build-arg SERVICE_VERSION="$VERSION" "$ROOT" >/dev/null
docker build -q -f "$ROOT/infra/docker/engine.Dockerfile" -t "blackbox-agent-a/engine:$VERSION" --build-arg SERVICE_VERSION="$VERSION" "$ROOT" >/dev/null
fi
docker pull -q postgres:17 >/dev/null
PG_DIGEST=$(docker image inspect postgres:17 --format '{{index .RepoDigests 0}}' | sed 's/.*@sha256://')
echo "▸ saving images"
docker save "blackbox-agent-a/node:$VERSION" -o "$STAGE/release/images/node.tar"; docker save "blackbox-agent-a/engine:$VERSION" -o "$STAGE/release/images/engine.tar"; docker save postgres:17 -o "$STAGE/release/images/postgres-17.tar"
cp "$ROOT/blackbox" "$STAGE/blackbox"; cp "$ROOT/infra/compose/compose.yaml" "$STAGE/infra/compose/"; cp -R "$ROOT/infra/compose/postgres-init" "$STAGE/infra/compose/"; cp "$ROOT"/scripts/*.sh "$ROOT"/scripts/*.mjs "$STAGE/scripts/"; cp "$ROOT/release/compat.json" "$STAGE/release/"; echo "$VERSION" > "$STAGE/release/VERSION"
sed -e "s/^BLACKBOX_VERSION=.*/BLACKBOX_VERSION=$VERSION/" -e "s#^BLACKBOX_IMAGE_NODE=.*#BLACKBOX_IMAGE_NODE=blackbox-agent-a/node:$VERSION#" -e "s#^BLACKBOX_IMAGE_ENGINE=.*#BLACKBOX_IMAGE_ENGINE=blackbox-agent-a/engine:$VERSION#" -e "s/^POSTGRES_DIGEST=.*/POSTGRES_DIGEST=$PG_DIGEST/" "$ROOT/infra/compose/.env.example" > "$STAGE/infra/compose/.env.example"
cp "$ROOT/docs/operations.md" "$ROOT/docs/feedback-guide.md" "$STAGE/docs/" 2>/dev/null || true
cat > "$STAGE/README.md" <<MD
# Blackbox $VERSION — local installation package (macOS Apple Silicon)

EN: 1) \`./blackbox doctor\` 2) \`./blackbox setup\` (save the key shown once) 3) \`./blackbox up\` 4) open http://127.0.0.1:19080/
Requires Docker Desktop 4.30+ running. Nothing is installed globally. Stop with \`./blackbox down\`; data is kept.

DE: 1) \`./blackbox doctor\` 2) \`./blackbox setup\` (den einmal angezeigten Schlüssel speichern) 3) \`./blackbox up\` 4) http://127.0.0.1:19080/ öffnen
Benötigt ein laufendes Docker Desktop 4.30+. Es wird nichts global installiert. Stoppen mit \`./blackbox down\`; Daten bleiben erhalten.

Full guide (EN/DE): landing page → Installation guide, or docs/operations.md. Images are bundled under release/images and loaded by setup.
MD
echo "▸ packaging"
( cd "$OUT" && tar -czf "$NAME-macos-arm64.tar.gz" "$NAME" )
SHA=$(shasum -a 256 "$OUT/$NAME-macos-arm64.tar.gz" | awk '{print $1}'); SIZE=$(wc -c < "$OUT/$NAME-macos-arm64.tar.gz" | tr -d ' ')
echo "$SHA  $NAME-macos-arm64.tar.gz" > "$OUT/$NAME-macos-arm64.tar.gz.sha256"
COMMIT=$(git -C "$ROOT" rev-parse HEAD)
python3 - "$ROOT/release/manifest.json" "$VERSION" "$SHA" "$SIZE" "$COMMIT" "$NAME" "$PG_DIGEST" <<'PY'
import json, sys, datetime
path, version, sha, size, commit, name, pg = sys.argv[1:8]
m = {"schema_version": 1, "version": version, "status": "preview", "date": datetime.date.today().isoformat(), "tested_commit": commit,
     "release_notes": f"Local pilot preview {version}: wrapper, pinned Compose, bundled images (node, engine, postgres:17@sha256:{pg[:12]}…). Synthetic-proven Shopify path; live provider proof pending authorization.",
     "prerequisites": ["macOS 14+ on Apple Silicon", "Docker Desktop 4.30+ (running)", "~3 GB free disk"], "guide_url": "guide.html",
     "images": {"node": f"blackbox-agent-a/node:{version}", "engine": f"blackbox-agent-a/engine:{version}", "postgres": f"postgres:17@sha256:{pg}"},
     "artifacts": [{"platform": "macos-arm64", "min_os": "macOS 14", "format": "tar.gz", "filename": f"{name}-macos-arm64.tar.gz", "size_bytes": int(size), "sha256": sha, "url": f"./downloads/{name}-macos-arm64.tar.gz", "status": "preview"}]}
json.dump(m, open(path, 'w'), indent=1); print(json.dumps(m["artifacts"][0]))
PY
rm -rf "$STAGE"
# Publishable landing bundle: static page + the manifest it reads + the immutable artifact it links to (served from the same origin)
SITE="$ROOT/release/site"; rm -rf "$SITE"; mkdir -p "$SITE/downloads"
( cd "$ROOT/apps/landing" && node build.mjs >/dev/null )
cp -R "$ROOT/apps/landing/dist/." "$SITE/"; cp "$ROOT/release/manifest.json" "$SITE/release.json"
cp "$OUT/$NAME-macos-arm64.tar.gz" "$OUT/$NAME-macos-arm64.tar.gz.sha256" "$SITE/downloads/"
echo "Landing bundle: $SITE (serve it as one static origin; downloads/ holds the versioned archive and its checksum)"
echo "Release archive: $OUT/$NAME-macos-arm64.tar.gz ($SIZE bytes, sha256 $SHA)"
