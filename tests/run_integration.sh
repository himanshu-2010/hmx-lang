#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="build/hmx"
PASS=0
FAIL=0

for f in tests/fixtures/*.hmx; do
    name=$(basename "$f" .hmx)
    "$BIN" run "$f" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "PASS: $name"
        PASS=$((PASS+1))
    else
        echo "FAIL: $name"
        FAIL=$((FAIL+1))
    fi
done

echo ""

MODTMP="/tmp/hmx_mod_tests"

# Name, entry path (relative to temp dir), then repeated "path|content" pairs.
test_module() {
    local test_name="$1"
    local entry="$2"
    shift 2
    local d="$MODTMP/$test_name"
    rm -rf "$d"
    while [ $# -gt 0 ]; do
        local rel="$1"
        local content="$2"
        shift 2
        mkdir -p "$d/$(dirname "$rel")"
        printf '%s\n' "$content" > "$d/$rel"
    done
    "$BIN" run "$d/$entry" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "PASS: $test_name"
        PASS=$((PASS+1))
    else
        echo "FAIL: $test_name"
        FAIL=$((FAIL+1))
    fi
}

test_module "mod_basic" "main.hmx" \
    "lib/math.hmx" 'fn sum(a: int, b: int) -> int {
        return a + b
    }
    fn twice(x: int) -> int {
        return x * 2
    }' \
    "main.hmx" 'use "lib/math.hmx"
    fn main() {
        print(sum(1, 2), twice(21))
    }'

test_module "mod_chain" "main.hmx" \
    "lib/b.hmx" 'fn fb(x: int) -> int {
        return x * 10
    }' \
    "lib/a.hmx" 'use "b.hmx"
    fn fa(x: int) -> int {
        return fb(x) + 1
    }' \
    "main.hmx" 'use "lib/a.hmx"
    fn main() {
        print(fa(3))
    }'

test_module "mod_closures" "main.hmx" \
    "lib/caps.hmx" 'fn make_adder(base: int) -> fn(int) -> int {
        let b = base
        fn add(x: int) -> int {
            return x + b
        }
        return add
    }' \
    "main.hmx" 'use "lib/caps.hmx"
    fn main() {
        let f: fn(int) -> int = make_adder(100)
        print(f(1), f(f(1)))
    }'

test_module "mod_nonlocal" "main.hmx" \
    "lib/scan.hmx" 'fn first_multiples(n: int) -> int {
        let count = 0
        loop (n) {
            fn bail() {
                break
            }
            count = count + 1
            if (count == 3) {
                bail()
            }
        }
        return count
    }' \
    "main.hmx" 'use "lib/scan.hmx"
    fn main() {
        print(first_multiples(50), first_multiples(2))
    }'

test_module "mod_unicode" "main.hmx" \
    "lib/saludar.hmx" 'fn saludar(nombre: text) {
        print("hola", nombre)
    }' \
    "main.hmx" 'use "lib/saludar.hmx"
    fn main() {
        let ö = "mundo"
        saludar(ö)
    }'

test_module "mod_state" "main.hmx" \
    "lib/math.hmx" 'const PI = 3.14
    let base = 2.0
    fn area(r: decimal) -> decimal {
        return PI * r * r
    }
    fn scaled(n: decimal) -> decimal {
        return n * base
    }
    fn get_base() -> decimal {
        return base
    }' \
    "main.hmx" 'use "lib/math.hmx"
    fn main() {
        print(area(2.0), scaled(21.0), get_base())
    }'

# Module top-level state initializes dependencies-first (post-order merge):
# calc.hmx's `let OFFSET = RATE + 5.0` reads base.hmx's `let RATE`.
test_module "mod_state_dep" "main.hmx" \
    "lib/base.hmx" 'let RATE = 10.0
    fn rate() -> decimal {
        return RATE
    }' \
    "lib/calc.hmx" 'use "base.hmx"
    let OFFSET = RATE + 5.0
    fn compute(x: decimal) -> decimal {
        return x * OFFSET
    }' \
    "main.hmx" 'use "lib/calc.hmx"
    fn main() {
        print(rate(), compute(2.0))
    }'

# Two-phase registration: a module function can read entry-file top-level state
# even though module statements are merged before the entry file's.
test_module "mod_state_entry_to_module" "main.hmx" \
    "lib/tool.hmx" 'fn get_count() -> int {
        return COUNT
    }' \
    "main.hmx" 'use "lib/tool.hmx"
    let COUNT = 7
    fn main() {
        print(get_count())
    }'

echo ""
echo "Passed: $PASS, Failed: $FAIL"
[ $FAIL -eq 0 ]
