#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/hmx"
TMPDIR="/tmp/hmx_stress_tests"
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

test_output_with_input() {
    local test_name="$1"
    local code="$2"
    local stdin_data="$3"
    local expected_output="$4"

    local file="$TMPDIR/${test_name}.hmx"
    printf '%s\n' "$code" > "$file"

    local actual_output
    set +e
    actual_output=$(printf '%s' "$stdin_data" | "$BIN" run "$file" 2>&1)
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ] && [ "$actual_output" = "$expected_output" ]; then
        echo "PASS (Input/Output): $test_name"
        PASS=$((PASS+1))
    else
        echo "FAIL (Input/Output): $test_name"
        echo "   Expected output:"
        echo "$expected_output" | sed 's/^/   /'
        echo "   Got (exit $exit_code):"
        echo "$actual_output" | sed 's/^/   /'
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

test_output "array_sum_loop" \
    'fn main() {
        let a: [int] = [5, 10, 15, 20]
        let total = 0
        let i = 0
        while (i < length(a)) {
            total += a[i]
            i++
        }
        print(total)
    }' \
    "50"

test_output "array_text_elements" \
    'fn main() {
        let names: [text] = ["alpha", "beta", "gamma"]
        print(names[1])
        print(length(names[2]))
    }' \
    "$(printf 'beta\n5')"

test_output "array_return_and_param" \
    'fn make() -> [int] {
        return [1, 2, 3]
    }
    fn first(a: [int]) -> int {
        return a[0]
    }
    fn main() {
        let arr = make()
        print(length(arr))
        print(first(arr))
        arr[2] = 9
        print(arr[2])
    }' \
    "$(printf '3\n1\n9')"

test_exit_code "array_oob_high" \
    'fn main() {
        let a: [int] = [1, 2]
        print(a[2])
    }' \
    1

test_exit_code "array_oob_low" \
    'fn main() {
        let a: [int] = [1, 2]
        print(a[0 - 1])
    }' \
    1

test_output "tuple_multi_return_destructure" \
    'fn quotrem(a: int, b: int) -> (int, int) {
        return a / b, a - (a / b) * b
    }
    fn main() {
        let (q, r) = quotrem(17, 5)
        print(q)
        print(r)
    }' \
    "$(printf '3\n2')"

test_output "tuple_inference_and_index" \
    'fn quotrem(a: int, b: int) -> (int, int) {
        return a / b, a - (a / b) * b
    }
    fn main() {
        let pair = quotrem(10, 3)
        print(pair[0])
        print(pair[1])
    }' \
    "$(printf '3\n1')"

test_output "tuple_multi_assign" \
    'fn quotrem(a: int, b: int) -> (int, int) {
        return a / b, a - (a / b) * b
    }
    fn main() {
        let (q, r) = quotrem(17, 5)
        (q, r) = quotrem(20, 7)
        print(q)
        print(r)
    }' \
    "$(printf '2\n6')"

test_output "tuple_param_and_call" \
    'fn pair_it(a: int, b: int) -> (int, int) {
        return a, b
    }
    fn swap(t: (int, int)) -> (int, int) {
        return t[1], t[0]
    }
    fn main() {
        let pair = pair_it(4, 5)
        let swapped = swap(pair)
        print(swapped[0])
        print(swapped[1])
    }' \
    "$(printf '5\n4')"

test_output "tuple_text_member" \
    'fn make_pair() -> (int, text) {
        return 7, "hi"
    }
    fn main() {
        let (n, s) = make_pair()
        print(n)
        print(s)
    }' \
    "$(printf '7\nhi')"

test_output "tuple_array_member" \
    'fn best_of(scores: [int]) -> ([int], int) {
        let best = scores[0]
        let i = 0
        while (i < length(scores)) {
            if (scores[i] > best) {
                best = scores[i]
            }
            i++
        }
        return scores, best
    }
    fn main() {
        let result = best_of([3, 9, 6])
        print(result[1])
        print(length(result[0]))
    }' \
    "$(printf '9\n3')"

test_output "tuple_annotated_decl" \
    'fn quotrem(a: int, b: int) -> (int, int) {
        return a / b, a - (a / b) * b
    }
    fn main() {
        let tagged: (int, int) = quotrem(5, 2)
        print(tagged[0])
        print(tagged[1])
    }' \
    "$(printf '2\n1')"

test_output "modulo_basic" \
    'fn main() {
        print(17 % 5)
        print(10 % 3)
        print(-100 % 7)
        print(7 % 100)
    }' \
    "$(printf '2\n1\n-2\n7')"

test_output "modulo_compound" \
    'fn main() {
        let x = 17
        x %= 5
        print(x)
        let y = 10
        y %= 3
        y %= 2
        print(y)
    }' \
    "$(printf '2\n1')"

test_output "unary_minus" \
    'fn main() {
        let a = -5
        print(a)
        print(-(a))
        print(-2 + 5)
        print(-(3 * 4))
        let b = -3.5
        print(b)
    }' \
    "$(printf -- '-5\n5\n3\n-12\n-3.500000')"

test_output "break_continue" \
    'fn main() {
        let i = 0
        loop (5) {
            i = i + 1
            if (i == 2) {
                continue
            }
            print(i)
            if (i == 4) {
                break
            }
        }
        print(i)
        let count = 0
        while (true) {
            count = count + 1
            if (count == 3) {
                continue
            }
            print(count)
            if (count == 6) {
                break
            }
        }
    }' \
    "$(printf -- '1\n3\n4\n4\n1\n2\n4\n5\n6')"

test_output "break_in_switch_with_inner_loop" \
    'fn main() {
        switch (2) {
            case 1: print(1)
            case 2: loop (3) {
                let k = 0
                while (k < 2) {
                    k = k + 1
                    if (k == 2) {
                        break
                    }
                    print(k)
                }
                break
            }
        }
    }' \
    "$(printf '1')"

test_exit_code "modulo_exit_code" \
    'fn main() -> int {
        let x = 100 % 7
        if (x == 2) {
            return 42
        }
        return 1
    }' \
    42

test_output "foreach_array_sum" \
    'fn main() {
        let nums = [1, 2, 3, 4, 5]
        let total = 0
        foreach (x in nums) {
            total = total + x
        }
        print(total)
        let squares = 0
        foreach (v in nums) {
            v = v * v
            squares = squares + v
        }
        print(squares)
        print(nums[2])
    }' \
    "$(printf '15\n55\n3')"

test_output "foreach_index_form" \
    'fn main() {
        let items = [10, 20, 30]
        foreach (i, v in items) {
            print(i)
            print(i * v)
        }
        let word = "abc"
        foreach (i, ch in word) {
            print(i)
            print(ch)
        }
    }' \
    "$(printf '0\n0\n1\n20\n2\n60\n0\na\n1\nb\n2\nc')"

test_output "foreach_text_chars" \
    'fn main() {
        let msg = "hay"
        let out_len = 0
        foreach (ch in msg) {
            if (ch == '"'"'a'"'"') {
                continue
            }
            out_len = out_len + 1
        }
        print(out_len)
        let vowel_count = 0
        foreach (ch in "aeiou") {
            if (ch == '"'"'a'"'"' or ch == '"'"'e'"'"' or ch == '"'"'i'"'"' or ch == '"'"'o'"'"' or ch == '"'"'u'"'"') {
                vowel_count = vowel_count + 1
            }
        }
        print(vowel_count)
    }' \
    "$(printf '2\n5')"

test_output_with_input "input_echo_and_length" \
    'fn main() {
        let a = input()
        let b = input()
        print(a)
        print(length(b))
    }' \
    'hello
world' \
    "$(printf 'hello\n5')"

test_output_with_input "input_concat" \
    'fn main() {
        let name = input()
        let greeting = "hi " + name
        print(greeting)
    }' \
    'ada' \
    "$(printf 'hi ada')"

test_output_with_input "input_empty_lines" \
    'fn main() {
        let a = input()
        let b = input()
        print(length(a))
        print(length(b))
    }' \
    $'\n' \
    "$(printf '0\n0')"

test_exit_code "parse_int_runtime_error" \
    'fn main() {
        let n = parse_int("12abc")
        print(n)
    }' \
    1

test_output "tostr_variants" \
    'fn main() {
        print(tostr(-7))
        print(tostr(1.25))
        print(tostr(true))
        print(tostr(false))
        print(tostr('"'"'k'"'"'))
        let by: byte = 3
        print(tostr(by))
        print(tostr("x"))
        print(tostr(6) + " items")
    }' \
    "$(printf -- '-7\n1.250000\n1\n0\nk\n3\nx\n6 items')"

test_output "parse_and_use" \
    'fn main() {
        let a = parse_int("50")
        let b = parse_int("-4")
        print(a + b)
        print(parse_int("007"))
        let d = parse_decimal("2.5")
        print(parse_decimal("1.1") + d)
        let s = tostr(parse_int("9"))
        print(s + "!")
    }' \
    "$(printf '46\n7\n3.600000\n9!')"

test_output_with_input "input_parse_loop" \
    'fn main() {
        let total = 0
        let a = input()
        total = total + parse_int(a)
        let b = input()
        total = total + parse_int(b)
        print(total)
    }' \
    '3
9' \
    "$(printf '12')"

test_output "print_mixed_args" \
    'fn main() {
        print("n =", 5)
        print(1, 2, 3)
        print("a" + "b", "c")
        print(true, '"
'"'x'"'"', 0.5)
        let i = 8
        print(i, i * i, i * i * i)
    }' \
    "$(printf 'n = 5\n1 2 3\nab c\n1 x 0.500000\n8 64 512')"

test_output "print_text_concat_and_multi" \
    'fn main() {
        let name = "gh"
        let msg = "go " + name
        print(msg, name, "done")
        print(tostr(12), tostr(0.75), tostr('"'"'p'"'"'))
    }' \
    "$(printf 'go gh gh done\n12 0.750000 p')"

test_output "nested_helper_functions" \
    'fn main() {
        fn twice(v: int) -> int {
            return v * 2
        }
        fn thrice(v: int) -> int {
            return v * 3
        }
        print(twice(thrice(4)))
        fn fib(n: int) -> int {
            if (n <= 1) {
                return n
            }
            return fib(n - 1) + fib(n - 2)
        }
        print(fib(9))
    }' \
    "$(printf '24\n34')"

test_output "nested_multi_level" \
    'fn top() -> int {
        return 1
    }
    fn main() {
        fn a() -> int {
            fn b() -> int {
                fn c() -> int {
                    return top() + 2
                }
                return c() + 1
            }
            return b() + 1
        }
        print(a())
        let sum = 0
        loop (3) {
            fn addtwo(v: int) -> int {
                return v + 2
            }
            sum = sum + addtwo(sum)
        }
        print(sum)
    }' \
    "$(printf '5\n14')"

test_output "variadic_sum" \
    'fn sum(rest: ...int) -> int {
        let total = 0
        foreach (x in rest) {
            total = total + x
        }
        return total
    }
    fn main() {
        print(sum())
        print(sum(1, 2, 3, 4))
        print(sum(7))
    }' \
    "$(printf '0\n10\n7')"

test_output "default_padding" \
    'fn config(name: text, loud: bool = false, retries: int = 3) {
        print(name, loud, retries)
    }
    fn main() {
        config("a")
        config("b", true)
        config("c", false, 9)
    }' \
    "$(printf 'a 0 3\nb 1 3\nc 0 9')"

test_output "variadic_mixed_defaults" \
    'fn merge(prefix: text = "-", rest: ...int) {
        print(prefix, length(rest))
        if (length(rest) > 0) {
            print(rest[0], rest[length(rest) - 1])
        }
    }
    fn main() {
        merge()
        merge("+", 5)
        merge("+", 1, 2, 3)
    }' \
    "$(printf -- '- 0\n+ 1\n5 5\n+ 3\n1 3')"

test_exit_code "variadic_exit_recursion" \
    'fn countdown(n: int = 5) -> int {
        if (n <= 0) {
            return 0
        }
        return countdown(n - 1)
    }
    fn main() -> int {
        let c = countdown()
        if (c == 0) {
            return 42
        }
        return 1
    }' \
    42

test_output "closures_hof_fold" \
    'fn apply(f: fn(int, int) -> int, a: int, b: int) -> int {
        return f(a, b)
    }
    fn add(x: int, y: int) -> int { return x + y }
    fn mul(x: int, y: int) -> int { return x * y }
    fn main() {
        print(apply(add, 30, 12))
        print(apply(mul, 6, 7))
    }' \
    "$(printf -- '42\n42')"

test_output "closures_snapshot_env" \
    'fn counter() -> fn() -> int {
        let total = 0
        fn bump() -> int {
            return total
        }
        let f = bump
        total = 10
        return f
    }
    fn main() {
        let c = counter()
        print(c())
    }' \
    "$(printf -- '0')"

test_output "closures_nested_forwarding" \
    'fn main() {
        let outer = 5
        fn g() -> int { return outer }
        fn caller() -> int {
            let f = g
            return f()
        }
        print(caller())
    }' \
    "$(printf -- '5')"

test_exit_code "closures_exit_capture" \
    'fn main() -> int {
        let code = 100
        fn pick() -> int {
            return code
        }
        if (pick() == 100) {
            return 42
        }
        return 1
    }' \
    42

echo ""
echo "Stress & Output Tests Passed: $PASS, Failed: $FAIL"
rm -rf "$TMPDIR"
[ $FAIL -eq 0 ]
