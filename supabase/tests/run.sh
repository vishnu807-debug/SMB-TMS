#!/usr/bin/env bash
# Rebuild a scratch database and apply stub + all migrations (+ optional test files).
set -euo pipefail
PSQL="psql -h ${PGHOST:-/tmp/claude-0} -p ${PGPORT:-5433} -U postgres -v ON_ERROR_STOP=1 -q"
DB=${TESTDB:-smp_test}
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f "$(dirname "$0")/00_supabase_stub.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do
  echo "== $(basename "$f")"
  $PSQL -d $DB -f "$f"
done
for f in "$@"; do echo "== test $(basename "$f")"; $PSQL -d $DB -f "$f"; done
