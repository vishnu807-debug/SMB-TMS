#!/usr/bin/env bash
# Rebuild a scratch database and apply stub + all migrations (+ optional test files).
set -euo pipefail
# Local convenience: start the scratch cluster used during development if it is down.
if [ -z "${PGHOST:-}" ] && [ -d /tmp/claude-0/pgdata ] && ! pg_isready -h /tmp/claude-0 -p 5433 -q 2>/dev/null; then
  rm -f /tmp/claude-0/pgdata/postmaster.pid
  su pgt -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/claude-0/pgdata -o '-k /tmp/claude-0 -p 5433' -l /tmp/claude-0/pgdata/log -w start" >/dev/null
fi
PSQL="psql -h ${PGHOST:-/tmp/claude-0} -p ${PGPORT:-5433} -U postgres -v ON_ERROR_STOP=1 -q"
DB=${TESTDB:-smp_test}
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f "$(dirname "$0")/00_supabase_stub.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do
  echo "== $(basename "$f")"
  $PSQL -d $DB -f "$f"
done
for f in "$@"; do echo "== test $(basename "$f")"; $PSQL -d $DB -f "$f"; done
