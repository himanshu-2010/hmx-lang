#!/usr/bin/env bash
# Differential tests: ELF backend (-b elf, P5a Tier B: machine-code encoder +
# static ELF writer + freestanding runtime) vs the C transpile backend.
# Both must produce byte-identical stdout and equal exit codes on the
# word-only fixture subset (int/bool/char, control flow, functions).
#
# Usage: ./tests/run_elf_diff.sh
# Run suites SEQUENTIALLY: the compiler writes build_temp.* into the current
# working directory.
set -u
cd "$(dirname "$0")/.." || exit 1

HMX=./build/hmx
FIXDIR=tests/backend_diff/elf
OUT_C=$(mktemp)
OUT_E=$(mktemp)
trap 'rm -f "$OUT_C" "$OUT_E" /tmp/hmx_elf_neg_case.hmx 2>/dev/null' EXIT

pass=0; fail=0
echo "== differential (elf backend vs C backend) =="
for fx in "$FIXDIR"/*.hmx; do
    name=$(basename "$fx" .hmx)
    # explicit -b c so the oracle arm behaves identically in both repos
    if ! "$HMX" build "$fx" -b c >/dev/null 2>&1; then
        echo "FAIL $name (C backend failed to build)"
        fail=$((fail + 1)); continue
    fi
    timeout 10 "./$name" > "$OUT_C"; ec_c=$?
    rm -f -- "$name"
    if ! "$HMX" build "$fx" -b elf >/dev/null 2>&1; then
        echo "FAIL $name (elf backend failed to build)"
        fail=$((fail + 1)); continue
    fi
    timeout 10 "./$name" > "$OUT_E"; ec_e=$?
    rm -f -- "$name"
    if cmp -s "$OUT_C" "$OUT_E" && [ "$ec_c" -eq "$ec_e" ]; then
        echo "pass $name (exit $ec_e)"
        pass=$((pass + 1))
    else
        echo "FAIL $name (C: exit $ec_c, elf: exit $ec_e)"
        diff "$OUT_C" "$OUT_E" | head -5
        fail=$((fail + 1))
    fi
done

echo "== elf backend negative cases (must compile-error cleanly) =="
negpass=0; negfail=0
check_error() {
    local desc="$1"
    printf '%s\n' "$2" > /tmp/hmx_elf_neg_case.hmx
    if out=$("$HMX" build /tmp/hmx_elf_neg_case.hmx -b elf 2>&1 >/dev/null) && [ -z "$out" ]; then
        echo "FAIL neg: $desc (compilation unexpectedly succeeded)"
        negfail=$((negfail + 1))
    elif ! printf '%s' "$out" | grep -q '^Error \[line '; then
        echo "FAIL neg: $desc (no clean CompileError: $out)"
        negfail=$((negfail + 1))
    else
        negpass=$((negpass + 1))
    fi
    # if a negative case unexpectedly succeeded, remove the binary it left
    rm -f -- hmx_elf_neg_case
}
check_error "text"    'fn main() { let s = "abc"
    print(s) }'
check_error "decimal" 'fn main() { let d = 1.5
    print(d) }'
check_error "chr-panic-path" 'fn main() { print(chr(300)) }'
check_error "arrays"  'fn main() { let a: [int] = [1, 2]
    print(a[0]) }'
check_error "structs" 'struct P { x: int }
fn main() { let p = P(1)
    print(p.x) }'
check_error "switch"  'fn main() { let x = 2
    switch (x) {
    case 1:
        print(1)
    default:
        print(0)
    } }'
check_error "defer"   'fn main() { defer { print(1) }
    print(2) }'
check_error "lambda"  'fn main() {
    let f = lambda (n: int) -> int { return n + 1 }
    print(f(1)) }'
check_error "closure-free-fn" 'fn wrap(n: int) -> int {
    let f = lambda (x: int) -> int { return x * n }
    return f(2)
}
fn main() { print(wrap(3)) }'

echo
echo "differential: $pass passed, $fail failed"
echo "negatives:    $negpass passed, $negfail failed"
[ "$fail" -eq 0 ] && [ "$negfail" -eq 0 ] && exit 0
exit 1
