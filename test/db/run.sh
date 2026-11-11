#!/usr/bin/env bash
# Runs the migrations and the row-security checks on a throwaway Postgres.
#   PGURL=postgres://... test/db/run.sh     (default: the local socket below)
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="psql ${PGURL:-"-h /tmp/pgtest -p 5499 -U postgres"} -X -q -v ON_ERROR_STOP=1"
DB=moolah_test_$$
$PSQL -d postgres -c "create database $DB" >/dev/null
trap '$PSQL -d postgres -c "drop database $DB" >/dev/null' EXIT
$PSQL -d $DB -f test/db/supabase-stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d $DB -f "$f" >/dev/null; done
# the checks need ids made inside them; pass them through settings
$PSQL -d $DB -f test/db/rls.sql 2>&1 | sed -n 's/^psql:.*NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p'
