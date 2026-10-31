#!/bin/bash
# Runs once on first database initialisation. Creates the migrator (table owner) and three runtime roles that are
# NOSUPERUSER / NOBYPASSRLS / NOCREATEROLE / NOCREATEDB. Passwords come from secret files, never from the image.
set -euo pipefail
read_secret() { tr -d '\n' < "/run/secrets/$1"; }
PG_MIGRATOR="$(read_secret pg_migrator_password)"; PG_API="$(read_secret pg_api_password)"; PG_WORKER="$(read_secret pg_worker_password)"; PG_ENGINE="$(read_secret pg_engine_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE bbx_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '$PG_MIGRATOR';
CREATE ROLE bbx_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '$PG_API';
CREATE ROLE bbx_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '$PG_WORKER';
CREATE ROLE bbx_engine LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD '$PG_ENGINE';
CREATE DATABASE blackbox OWNER bbx_migrator;
REVOKE ALL ON DATABASE blackbox FROM PUBLIC;
GRANT CONNECT ON DATABASE blackbox TO bbx_api, bbx_worker, bbx_engine;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname blackbox <<SQL
ALTER SCHEMA public OWNER TO bbx_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
