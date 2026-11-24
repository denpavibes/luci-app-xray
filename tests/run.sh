#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---all}"

run_static() {
    echo "=== Layer 1: Static, Lint & Packaging Audit ==="
    node --test "$ROOT/tests/static.test.mjs"
    local sh_scripts=(
        "$ROOT/core/root/etc/init.d/xray_core"
        "$ROOT/core/root/etc/uci-defaults/xray_core"
        "$ROOT/core/root/usr/libexec/rpcd/xray"
        "$ROOT/core/root/etc/hotplug.d/iface/01-transparent-proxy-ipset"
    )
    local bash_scripts=(
        "$ROOT/tests/run.sh"
        "$ROOT/tests/xray_validate.sh"
    )
    for f in "${sh_scripts[@]}"; do
        sh -n "$f"
    done
    for f in "${bash_scripts[@]}"; do
        bash -n "$f"
    done
    if command -v shellcheck >/dev/null 2>&1; then
        shellcheck -S error -s sh -e SC1091 "${sh_scripts[@]}"
        shellcheck "${bash_scripts[@]}"
    else
        echo "SKIP: shellcheck not found"
    fi
}

run_luci() {
    echo "=== Layer 4: LuCI View Tests (Node) ==="
    node --test "$ROOT/tests/luci_views.test.mjs"
}

run_ucode() {
    echo "=== Layer 2: Real ucode Generator, Parser & Template Tests ==="
    if ! command -v ucode >/dev/null 2>&1; then
        echo "SKIP: ucode not found"
        return 0
    fi
    export XRAY_TEST_UCI_JSON="$ROOT/tests/fixtures/uci_full.json"
    export XRAY_SUBSCRIPTION_DIR="$ROOT/tests/fixtures/subscriptions"
    export XRAY_TEST_ROOT="$ROOT"
    (
        cd "$ROOT/core/root/usr/share/xray"
        ucode -L "$ROOT/tests/mocks" "$ROOT/tests/ucode/test_gen_config.uc"
        ucode -L "$ROOT/tests/mocks" "$ROOT/tests/ucode/test_subscription_parser.uc"
        if command -v utpl >/dev/null 2>&1; then
            ucode -L "$ROOT/tests/mocks" "$ROOT/tests/ucode/test_templates.uc"
        else
            echo "SKIP: utpl not found (skipping test_templates.uc)"
        fi
    )
}

run_xray() {
    echo "=== Layer 3: Real Xray-core Schema Validation ==="
    if ! command -v ucode >/dev/null 2>&1 || ! command -v xray >/dev/null 2>&1; then
        echo "SKIP: ucode or xray not found"
        return 0
    fi
    bash "$ROOT/tests/xray_validate.sh"
}

case "$MODE" in
    --static) run_static ;;
    --luci) run_luci ;;
    --ucode) run_ucode ;;
    --xray) run_xray ;;
    --all)
        run_static
        run_luci
        run_ucode
        run_xray
        ;;
    *)
        echo "Usage: $0 [--all|--static|--luci|--ucode|--xray]" >&2
        exit 2
        ;;
esac
