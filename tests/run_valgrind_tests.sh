#!/usr/bin/env bash
# Valgrind-clean checks for the reference-counted runtime (M15).
#
# `hmx build` transpiles+compiles each program natively, then valgrind runs
# DIRECTLY on the generated binary (never on the compiler, so compiler leaks
# cannot cause false negatives). A clean program must exit 0 with no report
# (--quiet); any memory error OR definite/indirect/possible leak makes
# valgrind exit 99 via --error-exitcode, which fails the test.
#
# Usage:
#   ./tests/run_valgrind_tests.sh            # ownership matrix below
#   ./tests/run_valgrind_tests.sh --fixtures # also all tests/fixtures/*.hmx
#
# Set VALGRIND=/path/to/valgrind to override the valgrind binary.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BIN="$ROOT/build/hmx"
VALGRIND="${VALGRIND:-valgrind}"
TMP="/tmp/hmx_valgrind_tests"
rm -rf "$TMP"
mkdir -p "$TMP"

PASS=0
FAIL=0

test_clean() {
    local name="$1"
    local code="$2"
    local file="$TMP/$name.hmx"
    printf '%s\n' "$code" > "$file"
    if ! (cd "$TMP" && "$BIN" build "$name.hmx" >/dev/null 2>&1); then
        echo "FAIL (compile): $name"
        FAIL=$((FAIL+1))
        return
    fi
    set +e
    "$VALGRIND" --quiet --error-exitcode=99 --leak-check=full \
        --errors-for-leak-kinds=definite,indirect,possible \
        --track-origins=yes "$TMP/$name" >"$TMP/$name.out" 2>"$TMP/$name.err"
    local rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
        echo "PASS: $name"
        PASS=$((PASS+1))
    else
        echo "FAIL: $name (valgrind exit $rc)"
        sed 's/^/   /' "$TMP/$name.err" | head -15
        FAIL=$((FAIL+1))
    fi
}

# ── Reference-count ownership matrix ────────────────────────────────────────

test_clean "text_lifetimes" '
fn main() {
    let a = "hello"
    let b = a                   // alias share
    print(a == b, length(a), length(b))
    let c = a + " world"        // concat
    print(c)
    let v = substring(a, 1, 4)  // view into a
    print(v, a == v)
    let p = parse_int(substring("42xx", 0, 2))
    print(p)
}
'

test_clean "array_alias_cow" '
fn main() {
    let a: [int] = [1, 2, 3]
    let b = a
    b[0] = 9                    // struct-identity alias: in-place, visible
    print(a[0], b[0])
    let c: [int] = [4, 5]
    let s = slice(a, 0, 2)      // view struct
    s[1] = 7                    // COW fork
    print(a[1], s[1])
    push(a, 10)
    print(length(a), a[3])
    let popped = pop(a)
    print(popped, length(a))
}
'

test_clean "array_text_elements" '
fn main() {
    let t: [text] = ["banana", "apple", "cherry"]
    sort(t)
    print(t[0], t[1], t[2])
    t[1] = "B"
    print(t[0], t[1], t[2])
    print(index_of(t, "B"), contains(t, "cherry"))
    push(t, "date")
    print(length(t), pop(t))
    let u = concat(t, ["z", "y"])
    print(length(u), u[0])
    let v = slice(t, 0, 2)
    v[1] = "X"
    print(t[1], v[1])
}
'

test_clean "array_of_arrays" '
fn main() {
    let grid: [[int]] = [[1, 2], [3, 4]]
    push(grid, [5, 6])
    print(length(grid), grid[2][1])
    let row = pop(grid)
    print(row[0], row[1], length(grid))
    let alias = grid
    alias[0][0] = 99
    print(grid[0][0], alias[0][0])
    let slice1 = slice(grid, 0, 1)
    slice1[0][1] = 42
    print(grid[0][1], slice1[0][1])
}
'

test_clean "destructure_heap" '
fn main() {
    let parts: [text] = split("a,b,c", ",")
    let (first, ...tail) = parts
    print(first, length(tail), tail[0], tail[1])
    let grid: [[int]] = [[1, 2, 3], [4, 5, 6]]
    let (row0, row1) = grid
    print(length(row0), row0[2], row1[1])
    tail[0] = "z"
    print(tail[0], parts[1])
}
'

test_clean "closures_capture_heap" '
fn main() {
    let msg = "hi"
    let arr: [int] = [1, 2]
    let f = lambda() -> int { return length(msg) + arr[0] }
    print(f())
    let make = lambda() -> fn() -> text {
        return lambda() -> text { return msg + "!" }
    }
    let g = make()
    print(g())
}
'

test_clean "param_ownership" '
fn echo(s: text) -> text { return s }
fn rebind(s: text, ss: text) -> text {
    s = ss                      // param reassignment
    return s
}
fn main() {
    let a = "one"
    let b = echo(a)             // borrowed-param return
    let c = rebind(a, "two")
    print(a, b, c)
    let arr: [int] = [5, 6]
    let d = arr
    d[0] = 55
    print(arr[0], d[0])
}
'

test_clean "loops_and_returns" '
fn nested(limit: int) -> int {
    let total = 0
    for (let i = 0; i < limit; i++) {
        if (i == 2) { break }
        let arr: [text] = ["loop"]
        push(arr, "x")
        total = total + i + length(arr)
    }
    return total
}
fn main() {
    print(nested(5))
}
'

test_clean "tuple_heap" '
fn pair() -> (text, [int]) {
    let t = ("hello", [1, 2, 3])
    return t
}
fn main() {
    let (s, arr) = pair()
    print(s, arr[2])
    arr[0] = 7
    print(arr[0], arr[1])
}
'

test_clean "switch_destruct" '
fn main() {
    let words: [text] = ["a", "b"]
    let (x, y) = words
    print(x, y)
    let m = 3
    switch (m) {
        case 1: print(1)
        case 3: print(3)
        default: print(9)
    }
}
'

test_clean "string_methods_views" '
fn main() {
    let s = "hello world"
    let v = substring(s, 6, 11)     // "world" — a view
    print(v)
    let parts = split(v, "r")
    print(length(parts), parts[0], parts[1])
    let joined = tostr(parse_int("42")) + tostr(3.5)
    print(joined)
    print(substring(s, 0, 5) == "hello")
    let first = substring(s, 0, 1)
    print(ord(first[0]))
}
'

test_clean "foreach_iterables" '
fn main() {
    let nums: [int] = [1, 2, 3, 4]
    let total = 0
    foreach (n in nums) { total = total + n }
    foreach (v in slice(nums, 1, 4)) { print(v) }
    let names: [text] = split("x,y,z", ",")
    foreach (nm in names) { print(nm) }
    print(total)
}
'

# ── Optional: run every integration fixture under valgrind ──────────────────

if [ "${1:-}" = "--fixtures" ]; then
    for f in tests/fixtures/*.hmx; do
        name=$(basename "$f" .hmx)
        file="$TMP/fix_${name}.hmx"
        cp "$f" "$file"
        if (cd "$TMP" && "$BIN" build "fix_${name}.hmx" >/dev/null 2>&1); then
            set +e
            "$VALGRIND" --quiet --error-exitcode=99 --leak-check=full \
                --errors-for-leak-kinds=definite,indirect,possible \
                "$TMP/fix_${name}" >/dev/null 2>"$TMP/fix_${name}.err"
            local_rc=$?
            set -e
            if [ "$local_rc" -eq 0 ]; then
                echo "PASS: fixture/$name"
                PASS=$((PASS+1))
            else
                echo "FAIL: fixture/$name (valgrind exit $local_rc)"
                sed 's/^/   /' "$TMP/fix_${name}.err" | head -12
                FAIL=$((FAIL+1))
            fi
        else
            echo "FAIL (compile): fixture/$name"
            FAIL=$((FAIL+1))
        fi
    done
fi

echo ""
echo "Valgrind Tests Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]