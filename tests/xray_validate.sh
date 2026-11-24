#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_CFG="$(mktemp /tmp/xray_test_config.XXXXXX.json)"
trap 'rm -f "$TMP_CFG"' EXIT

export XRAY_TEST_UCI_JSON="$ROOT/tests/fixtures/uci_full.json"
export XRAY_SUBSCRIPTION_DIR="$ROOT/tests/fixtures/subscriptions"
export XRAY_LOCATION_ASSET="${XRAY_LOCATION_ASSET:-/usr/share/xray}"

(
    cd "$ROOT/core/root/usr/share/xray"
    ucode -L "$ROOT/tests/mocks" ./gen_config.uc > "$TMP_CFG"
)

xray run -test -config "$TMP_CFG"
echo "PASS: xray run -test validated generated config.json"
