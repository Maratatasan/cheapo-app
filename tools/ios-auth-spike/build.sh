#!/bin/bash
set -euo pipefail

tool_dir="$(cd "$(dirname "$0")" && pwd)"
app_path="${1:?Usage: bash build.sh /path/to/MockAuth.app}"
sdk_path="$(xcrun --sdk iphonesimulator --show-sdk-path)"
mkdir -p "$app_path"
cp "$tool_dir/Info.plist" "$app_path/Info.plist"
xcrun --sdk iphonesimulator swiftc -parse-as-library -module-name MockAuth \
  -target "$(uname -m)-apple-ios26.0-simulator" -sdk "$sdk_path" \
  "$tool_dir/MockAuth.swift" -o "$app_path/MockAuth"
codesign --sign - "$app_path"
