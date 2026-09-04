#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/stardance"
TMPDIR="/tmp/stardance_stress_tests"
mkdir -p "$TMPDIR"

PASS=0
FAIL=0

test_output() {
    local test_name="$1"
    local code="$2"
    local expected_output="$3"

    local file="$TMPDIR/${test_name}.hmx"
    printf '%s\n' "$code" > "$file"

    local actual_output
    set +e
    actual_output=$("$BIN" run "$file" 2>&1)
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ] && [ "$actual_output" = "$expected_output" ]; then
        echo "PASS (Output): $test_name"
        PASS=$((PASS+1))
    else
        echo "FAIL (Output): $test_name"
        echo "   Expected output:"
        echo "$expected_output" | sed 's/^/   /'
        echo "   Got (exit $exit_code):"
        echo "$actual_output" | sed 's/^/   /'
        FAIL=$((FAIL+1))
    fi
}

test_exit_code() {
    local test_name="$1"
    local code="$2"
    local expected_code="$3"

    local file="$TMPDIR/${test_name}.hmx"
    printf '%s\n' "$code" > "$file"

    set +e
    "$BIN" run "$file" > /dev/null 2>&1
    local exit_code=$?
    set -e

    if [ $exit_code -eq $expected_code ]; then
        echo "PASS (Exit Code $expected_code): $test_name"
        PASS=$((PASS+1))
    else
        echo "FAIL (Exit Code): $test_name"
        echo "   Expected exit code: $expected_code"
        echo "   Got exit code: $exit_code"
        FAIL=$((FAIL+1))
    fi
}

echo "=== Running Output Verification & Stress Tests ==="

test_exit_code "exit_code_zero" \
    'fn main() -> int {
        return 0
    }' \
    0

test_exit_code "exit_code_custom_42" \
    'fn main() -> int {
        return 42
    }' \
    42

test_exit_code "exit_code_custom_100" \
    'fn main() -> int {
        return 100
    }' \
    100

test_output "factorial_recursion" \
    'fn fact(n: int) -> int {
        if (n <= 1) {
            return 1
        }
        return n * fact(n - 1)
    }
    fn main() {
        print(fact(6))
    }' \
    "720"

test_output "ackermann_recursion" \
    'fn ack(m: int, n: int) -> int {
        if (m == 0) {
            return n + 1
        }
        if (n == 0) {
            return ack(m - 1, 1)
        }
        return ack(m - 1, ack(m, n - 1))
    }
    fn main() {
        print(ack(2, 4))
    }' \
    "11"

test_output "large_loop_stress" \
    'fn main() {
        let count = 0
        loop(1000) {
            count += 1
        }
        print(count)
    }' \
    "1000"

test_output "while_loop_counter" \
    'fn main() {
        let i = 0
        let sum = 0
        while (i < 100) {
            sum += i
            i += 1
        }
        print(sum)
    }' \
    "4950"

test_output "nested_while_loops" \
    'fn main() {
        let i = 0
        let total = 0
        while (i < 5) {
            let j = 0
            while (j < 5) {
                total += 1
                j += 1
            }
            i += 1
        }
        print(total)
    }' \
    "25"

test_output "string_concat_chain" \
    'fn main() {
        let s = "A" + "B" + "C" + "D" + "E"
        print(s)
    }' \
    "ABCDE"

test_output "boolean_logic_truth_table" \
    'fn main() {
        print(true and true)
        print(true and false)
        print(false or true)
        print(false or false)
        print(not false)
        print(!true)
    }' \
    "$(printf '1\n0\n1\n0\n1\n0')"

test_output "collatz_steps" \
    'fn main() {
        let x = 10
        let steps = 0
        while (x != 1) {
            let half = x / 2
            if (half * 2 == x) {
                x /= 2
            } else {
                x = x * 3 + 1
            }
            steps += 1
        }
        print(steps)
        print(x)
    }' \
    "$(printf '6\n1')"

test_output "for_loop_factorial" \
    'fn main() {
        let result = 1
        for (let i = 1; i <= 6; i++) {
            result *= i
        }
        print(result)
    }' \
    "720"

test_output "do_while_countdown" \
    'fn main() {
        let i = 3
        do {
            print(i)
            i--
        } while (i > 0)
    }' \
    "$(printf '3\n2\n1')"

test_output "all_loop_forms_nested" \
    'fn main() {
        let total = 0
        loop(2) {
            for (let i = 0; i < 3; i++) {
                let j = 0
                while (j < 2) {
                    let run = true
                    do {
                        total += 1
                        run = false
                    } while (run)
                    j++
                }
            }
        }
        print(total)
    }' \
    "12"

test_output "ternary_cast_const" \
    'fn main() {
        const base = 7
        let value = true ? base as decimal : 0.0
        print(value as int)
    }' \
    "7"

test_output "char_byte_values" \
    'fn main() {
        let letter: char = '"'"'A'"'"'
        let value: byte = 255
        print(letter)
        print(value)
    }' \
    "$(printf 'A\n255')"

test_output "switch_automatic_break" \
    'fn main() {
        switch (2) {
            case 1:
                print(1)
            case 2:
                print(2)
            default:
                print(3)
        }
    }' \
    "2"

test_output "string_methods" \
    'fn main() {
        let message = "hello world"
        print(length(message))
        print(substring(message, 0, 5))
    }' \
    "$(printf '11\nhello')"

echo ""
echo "Stress & Output Tests Passed: $PASS, Failed: $FAIL"
rm -rf "$TMPDIR"
[ $FAIL -eq 0 ]
