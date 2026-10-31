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
  cat /migrations/001-foundation.sql
} | psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1
for migration in /migrations/0*.sql; do
  case "$migration" in */001-foundation.sql) continue ;; esac
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f "$migration"
done
