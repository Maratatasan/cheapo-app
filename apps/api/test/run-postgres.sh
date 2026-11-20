#!/bin/sh
set -eu

# Keep the trust-authenticated test database on an owner-only Unix socket.
root=$(mktemp -d /tmp/cheapo-postgres-test.XXXXXX)
cleanup() {
  if [ -f "$root/data/postmaster.pid" ]; then
    pg_ctl -D "$root/data" -m immediate -w stop >/dev/null
  fi
  rm -rf "$root"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

initdb -D "$root/data" -U cheapo_test -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$root/data" -l "$root/postgres.log" -o "-c listen_addresses='' -p 5432 -k $root" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$root" -p 5432 -U cheapo_test -d postgres \
  -f migrations/001-comparison-preferences.sql \
  -f migrations/002-shopping-history.sql \
  -f migrations/003-device-credentials.sql \
  -f test/shopping-history.postgres.sql >/dev/null
CHEAPO_TEST_PG_SOCKET="$root" node --test test/preferences.postgres.ts
