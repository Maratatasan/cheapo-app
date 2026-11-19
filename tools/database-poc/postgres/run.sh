#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -r "$1" ]]; then
  printf 'Usage: %s /path/to/frozen-fixture.json\n' "$0" >&2
  exit 2
fi

spike=$(cd "$(dirname "$0")" && pwd)
cluster=$(mktemp -d /tmp/cheapo-pg.XXXXXXXX)
cleanup() {
  pg_ctl -D "$cluster/data" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

initdb -D "$cluster/data" --auth=trust --locale=C --encoding=UTF8 >"$cluster/init.log" ||
  { cat "$cluster/init.log" >&2; exit 1; }
pg_ctl -D "$cluster/data" -l "$cluster/server.log" -w start \
  -o "-c listen_addresses='' -c unix_socket_directories=$cluster -p 18765 -c shared_buffers=32MB -c max_connections=12" >/dev/null ||
  { cat "$cluster/server.log" >&2; exit 1; }

CHEAPO_POSTGRES_FIXTURE="$1" CHEAPO_POSTGRES_SOCKET="$cluster" CHEAPO_POSTGRES_USER="$(id -un)" \
  node --test --test-reporter=tap "$spike/verify.test.mjs"
