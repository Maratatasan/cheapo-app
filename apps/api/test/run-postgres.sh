#!/bin/sh
set -eu

# Keep local fixtures on a private socket. The TLS exercise uses a password-protected loopback port.
umask 077
root=$(mktemp -d /tmp/cheapo-postgres-test.XXXXXX)
cleanup() {
  if [ -f "$root/data/postmaster.pid" ]; then
    pg_ctl -D "$root/data" -m immediate -w stop >/dev/null
  fi
  rm -rf "$root"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

port=$(node -e 'const s = require("node:net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')
openssl rand -hex 32 > "$root/password"
initdb -D "$root/data" -U cheapo_test --auth-local=trust --auth-host=scram-sha-256 \
  --pwfile="$root/password" --no-locale --encoding=UTF8 >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=db.cheapo.test' \
  -addext 'subjectAltName=DNS:db.cheapo.test' -keyout "$root/data/server.key" \
  -out "$root/data/server.crt" >/dev/null 2>&1
chmod 600 "$root/data/server.key"
pg_ctl -D "$root/data" -l "$root/postgres.log" \
  -o "-c listen_addresses=127.0.0.1 -c ssl=on -p $port -k $root" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$root" -p "$port" -U cheapo_test -d postgres \
  -f migrations/001-comparison-preferences.sql \
  -f migrations/002-shopping-history.sql \
  -f migrations/003-device-credentials.sql \
  -f migrations/004-shopping-import-receipt.sql \
  -f migrations/005-price-observation-resource-id.sql \
  -f migrations/006-price-append-receipts.sql \
  -f migrations/007-shopping-membership-function.sql \
  -f migrations/008-price-observation-audit.sql \
  -f migrations/009-price-photo-uploads.sql \
  -f migrations/010-product-revisions.sql \
  -f operator/runtime-role.sql \
  -f test/shopping-history.postgres.sql >/dev/null
CHEAPO_TEST_PG_SOCKET="$root" CHEAPO_TEST_PG_PORT="$port" node --test test/preferences.postgres.ts test/shopping-import.postgres.ts test/hosted-import.postgres.ts test/price-history.postgres.ts test/runtime-role.postgres.ts test/price-photo.postgres.ts
