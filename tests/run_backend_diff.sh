#!/usr/bin/env bash
# Differential tests: x86-64 asm backend (-b asm) vs the default C transpile
# backend. Both must produce byte-identical stdout and equal exit codes.
#
# Usage: ./tests/run_backend_diff.sh [--valgrind]
# --valgrind additionally checks the asm-produced binary under valgrind
# (leak/error gate for the refcount schedule). Run suites SEQUENTIALLY: the
# compiler writes build_temp.* into the current working directory.
set -u
cd "$(dirname "$0")/.." || exit 1

HMX=./build/hmx
FIXDIR=tests/backend_diff
OUT_C=$(mktemp)
OUT_A=$(mktemp)
trap 'rm -f "$OUT_C" "$OUT_A" /tmp/hmx_neg_case.hmx 2>/dev/null' EXIT

pass=0; fail=0; vgpass=0; vgfail=0
valgrind_on=0
[ "${1:-}" = "--valgrind" ] && valgrind_on=1

echo "== differential (asm backend vs C backend) =="
for fx in "$FIXDIR"/*.hmx; do
    name=$(basename "$fx" .hmx)
    # default backend (C transpile)
    if ! "$HMX" build "$fx" >/dev/null 2>&1; then
        echo "FAIL $name (C backend failed to build)"
        fail=$((fail + 1)); continue
    fi
    timeout 10 "./$name" > "$OUT_C"; ec_c=$?
    rm -f -- "$name"
    # asm backend
    if ! "$HMX" build "$fx" -b asm >/dev/null 2>&1; then
        echo "FAIL $name (asm backend failed to build)"
        fail=$((fail + 1)); continue
    fi
    timeout 10 "./$name" > "$OUT_A"; ec_a=$?
    rm -f -- "$name"
    if cmp -s "$OUT_C" "$OUT_A" && [ "$ec_c" -eq "$ec_a" ]; then
        echo "pass $name (exit $ec_a)"
        pass=$((pass + 1))
    else
        echo "FAIL $name (C: exit $ec_c, asm: exit $ec_a)"
        diff "$OUT_C" "$OUT_A" | head -5
        fail=$((fail + 1))
    fi
    if [ "$valgrind_on" -eq 1 ]; then
        # --error-exitcode=9 overrides the program's own exit code only when
        # valgrind finds an error; a clean run passes the program's code through
        vgc=10
        if "$HMX" build "$fx" -b asm >/dev/null 2>&1; then
            valgrind --error-exitcode=9 --leak-check=full \
                     --errors-for-leak-kinds=definite,indirect \
                     "./$name" >/dev/null 2>&1; vgc=$?
        fi
        if [ "$vgc" -ne 9 ]; then
            vgpass=$((vgpass + 1))
        else
            echo "FAIL $name (valgrind)"
            vgfail=$((vgfail + 1))
        fi
        rm -f -- "$name"
    fi
done

echo "== asm backend negative cases (must compile-error cleanly) =="
negpass=0; negfail=0
check_error() {
    local desc="$1"
    printf '%s\n' "$2" > /tmp/hmx_neg_case.hmx
    if out=$("$HMX" build /tmp/hmx_neg_case.hmx -b asm 2>&1 >/dev/null) && [ -z "$out" ]; then
        echo "FAIL neg: $desc (compilation unexpectedly succeeded)"
        negfail=$((negfail + 1))
    elif ! printf '%s' "$out" | grep -q '^Error \[line '; then
        echo "FAIL neg: $desc (no clean CompileError: $out)"
        negfail=$((negfail + 1))
    else
        negpass=$((negpass + 1))
    fi
    # if a negative case unexpectedly succeeded, remove the binary it left
    rm -f -- hmx_neg_case
}
check_error "arrays"      'fn main() { let a: [int] = [1, 2]
    print(a[0]) }'
check_error "structs"     'struct P { x: int }
fn main() { let p = P(1)
    print(p.x) }'
check_error "foreach"     'fn main() { let s = "abc"
    foreach (ch in s) { print(ch) } }'
check_error "switch"      'fn main() { let x = 2
    switch (x) {
    case 1:
        print("one")
    default:
        print("other")
    } }'
check_error "defer"       'fn main() { defer { print("bye") }
    print("hi") }'
check_error "lambda"      'fn main() {
    let f = lambda (n: int) -> int { return n + 1 }
    print(f(1)) }'
check_error "multi-ret"   'fn f() -> (int, int) { return 1, 2 }
fn main() { print(f()) }'

echo
echo "differential: $pass passed, $fail failed"
echo "negatives:    $negpass passed, $negfail failed"
[ "$valgrind_on" -eq 1 ] && echo "valgrind:     $vgpass passed, $vgfail failed"
[ "$fail" -eq 0 ] && [ "$negfail" -eq 0 ] && { [ "$valgrind_on" -eq 0 ] || [ "$vgfail" -eq 0 ]; } && exit 0
exit 1
