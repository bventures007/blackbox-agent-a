#!/bin/sh
set -eu
# Generated hex passwords enter psql through stdin, never process arguments.
for value in "$BB_API_PASSWORD" "$BB_WORKER_PASSWORD" "$BB_ENGINE_PASSWORD"; do
  case "$value" in ''|*[!0-9a-f]*) exit 2 ;; esac
  [ "${#value}" -eq 64 ] || exit 2
done
{
  printf "\\set api_password '%s'\n" "$BB_API_PASSWORD"
  printf "\\set worker_password '%s'\n" "$BB_WORKER_PASSWORD"
  printf "\\set engine_password '%s'\n" "$BB_ENGINE_PASSWORD"
  printf 'BEGIN;SELECT pg_advisory_xact_lock(18741002);\n'
  cat /migrations/001-foundation.sql
  printf "CREATE TABLE bb.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),provenance text NOT NULL DEFAULT 'applied');\n"
  digest=$(sha256sum /migrations/001-foundation.sql | cut -d ' ' -f 1)
  printf "INSERT INTO bb.schema_migrations(version,sha256)VALUES('001-foundation.sql','%s');COMMIT;\n" "$digest"
} | psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1
for migration in /migrations/0*.sql; do
  case "$migration" in */001-foundation.sql) continue ;; esac
  name=$(basename "$migration")
  case "$name" in *[!a-z0-9.-]*) exit 2 ;; esac
  digest=$(sha256sum "$migration" | cut -d ' ' -f 1)
  {
    printf 'BEGIN;SELECT pg_advisory_xact_lock(18741002);\n'
    cat "$migration"
    printf "INSERT INTO bb.schema_migrations(version,sha256)VALUES('%s','%s');COMMIT;\n" "$name" "$digest"
  } | psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1
done
