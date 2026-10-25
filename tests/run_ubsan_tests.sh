#!/usr/bin/env bash
#
# UndefinedBehaviorSanitizer control gate.
#
#   ./tests/run_ubsan_tests.sh
#
# HMX_UBSAN=1 (see src/main.cpp) builds the generated C with
# `-fsanitize=undefined -fno-sanitize-recover=all`, so a signed overflow or a
# bad shift aborts the program instead of silently returning a wrong answer.
# The CI `ubsan` job runs the integration and stress suites under that hook;
# this script is the control that proves the hook is actually wired up: a
# program with a known signed overflow must abort under it, and the very same
# program must run to completion without it. Without this, a hook that quietly
# stopped adding the flag would keep both suites green and tell nobody.
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/hmx"
# P4: suites pin the C emitter (-b oracle). The asm backend has its
# own differential gate (tests/run_backend_diff.sh).
export HMX_BACKEND="${HMX_BACKEND:-c}"
TMPDIR="/tmp/hmx_ubsan_tests"
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"

PASS=0
FAIL=0

ok()  { echo "PASS (UBSan): $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL (UBSan): $1"; shift; for l in "$@"; do echo "   $l"; done; FAIL=$((FAIL + 1)); }

if [ ! -x "$BIN" ]; then
    echo "FAIL (UBSan): $BIN not built; run: cmake --build build"
    exit 1
fi

# 2147483647 + 1 cannot be represented in `int`: the canonical signed overflow.
cat > "$TMPDIR/overflow.hmx" <<'EOF'
fn main() -> int {
    let x: int = 2147483647
    print(x + 1)
    return 0
}
EOF

# The same expression, one short of the boundary. Correct arithmetic; the
# sanitizer must stay silent.
cat > "$TMPDIR/clean.hmx" <<'EOF'
fn main() -> int {
    let x: int = 2147483646
    print(x + 1)
    return 0
}
EOF

# 1. Correct arithmetic passes under the hook.
set +e
out="$(HMX_UBSAN=1 "$BIN" run "$TMPDIR/clean.hmx" 2>&1)"
rc=$?
set -e
if [ "$rc" -eq 0 ] && [ "$out" = "2147483647" ]; then
    ok "a correct program passes under HMX_UBSAN"
else
    bad "a correct program passes under HMX_UBSAN" "exit $rc, output: $out"
fi

# 2. The overflow is caught: non-zero exit and a sanitizer diagnostic.
set +e
out="$(HMX_UBSAN=1 "$BIN" run "$TMPDIR/overflow.hmx" 2>&1)"
rc=$?
set -e
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "runtime error"; then
    ok "HMX_UBSAN catches a signed overflow (exit $rc)"
else
    bad "HMX_UBSAN catches a signed overflow" "exit $rc, output: $out"
fi

# 3. ... and the catch is the sanitizer, not the program: without the hook the
#    overflow wraps and the run succeeds. This is the assertion that would have
#    passed even if step 2 were broken by an unrelated abort.
set +e
out="$("$BIN" run "$TMPDIR/overflow.hmx" 2>&1)"
rc=$?
set -e
if [ "$rc" -eq 0 ]; then
    ok "the same overflow only aborts under HMX_UBSAN"
else
    bad "the same overflow only aborts under HMX_UBSAN" "without the hook: exit $rc, output: $out"
fi

echo
echo "UBSan Tests Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]
