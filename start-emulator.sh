#!/bin/bash

AVD_NAME="Pixel_9_API_36"

echo "🚀 Starting Android emulator: $AVD_NAME"

# Start emulator in background
emulator -avd "$AVD_NAME" > /dev/null 2>&1 &

# Wait for device to be visible to adb
echo "⏳ Waiting for emulator to connect..."
adb wait-for-device

# Wait for boot completion
BOOT_COMPLETED="0"
while [ "$BOOT_COMPLETED" != "1" ]; do
  BOOT_COMPLETED=$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  sleep 1
done

# Wake up device
adb -s emulator-5554 shell input keyevent 82

echo "✅ Emulator $AVD_NAME is ready!"