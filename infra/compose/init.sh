#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v api_password="$BB_API_PASSWORD" -v worker_password="$BB_WORKER_PASSWORD" -v engine_password="$BB_ENGINE_PASSWORD" -f /migrations/001-foundation.sql
for migration in /migrations/0*.sql; do
  case "$migration" in */001-foundation.sql) continue ;; esac
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f "$migration"
done
