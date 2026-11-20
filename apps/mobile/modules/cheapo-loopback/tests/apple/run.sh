#!/bin/sh
set -eu

tests=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
native="$tests/../../ios"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

xcrun swiftc -module-cache-path "$work/module-cache" \
  "$native/LoopbackReceiver.swift" "$native/PhoneIdentity.swift" "$native/LoopbackSelfTest.swift" \
  "$tests/main.swift" -o "$work/check"
"$work/check"
