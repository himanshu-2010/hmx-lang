#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/hmx"
TMPDIR="/tmp/hmx_stress_tests"
mkdir -p "$TMPDIR"

PASS=0
FAIL=0

# Name, entry path (relative to temp dir), expected output, then "path|content" pairs.
test_module_output() {
    local test_name="$1"
    local entry="$2"
    local expected_output="$3"
    shift 3
    local d="$TMPDIR/_mod/${test_name}"
    rm -rf "$d"
    while [ $# -gt 0 ]; do
        local rel="$1"
        local content="$2"
        shift 2
        mkdir -p "$d/$(dirname "$rel")"
        printf '%s\n' "$content" > "$d/$rel"
    done
    local file="$d/$entry"
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
        echo "   Got exit code $exit_code with output:"
        echo "$actual_output" | sed 's/^/   /'
        FAIL=$((FAIL+1))
    fi
}

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

test_module_exit_code() {
    local test_name="$1"
    local entry="$2"
    local expected_code="$3"
    shift 3
    local d="$TMPDIR/_mod/${test_name}"
    rm -rf "$d"
    while [ $# -gt 0 ]; do
        local rel="$1"
        local content="$2"
        shift 2
        mkdir -p "$d/$(dirname "$rel")"
        printf '%s\n' "$content" > "$d/$rel"
    done
    local file="$d/$entry"

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

test_output "array_builtins" \
    'fn main() {
        let a: [int] = [3, 1, 2]
        push(a, 9)
        sort(a)
        print(length(a))
        print(a[3])
        print(pop(a))
        print(length(a))
        let b: [int] = slice(a, 1, 3)
        print(length(b))
        print(b[0])
        let c: [int] = concat(a, b)
        print(length(c))
        print(index_of(c, 9))
        print(index_of(c, 3))
        print(contains(c, 3))
        print(contains(c, 9))
        let t: [text] = ["banana", "apple"]
        sort(t)
        print(t[0])
    }' \
    "$(printf '4\n9\n9\n3\n2\n2\n5\n-1\n2\n1\n0\napple')"

test_output "text_indexing" \
    'fn main() {
        let s = "hello"
        print(s[0])
        print(s[4])
        print(s[length(s) - 1])
        let names: [text] = ["abc", "de"]
        print(names[1][0])
        print(ord('\''A'\''))
        print(ord(names[0][0]))
        print(chr(65))
        print(chr(ord('\''b'\'') + 1))
    }' \
    "$(printf 'h\no\no\nd\n65\n97\nA\nc')"

test_output "split_basic" \
    'fn main() {
        let parts: [text] = split("a,b,,c", ",")
        print(length(parts))
        print(parts[0])
        print(parts[1])
        print(parts[2])
        print(parts[3])
        print(index_of(parts, "c"))
        print(parts[0] + "!")
        let empty: [text] = split("", ";")
        print(length(empty))
        print(empty[0])
        let nums: [text] = split("1 2 3", " ")
        foreach (n in nums) {
            print(n)
        }
    }' \
    "$(printf '4\na\nb\n\nc\n3\na!\n1\n\n1\n2\n3')"

test_exit_code "text_index_oob" \
    'fn main() {
        let s = "hi"
        print(s[5])
    }' \
    1

test_exit_code "chr_out_of_range" \
    'fn main() {
        print(chr(300))
    }' \
    1

test_exit_code "split_empty_separator" \
    'fn main() {
        let p: [text] = split("abc", "")
    }' \
    1

test_output "destructure_array_rest" \
    'fn main() {
        let a: [int] = [1, 2, 3, 4]
        let (x, y, ...rest) = a
        print(x)
        print(y)
        print(length(rest))
        print(rest[0], rest[1])
        let (m, n) = a
        print(m, n)
        let one: [int] = [42]
        let (e, ...es) = one
        print(e, length(es))
    }' \
    "$(printf '1\n2\n2\n3 4\n1 2\n42 0')"

test_output "destructure_text_rest" \
    'fn main() {
        let s = "hello"
        let (c1, c2, ...cs) = s
        print(c1)
        print(c2)
        print(cs)
        print(length(cs), cs[0], cs[1])
        let grid: [[int]] = [[1, 2, 3], [4, 5, 6]]
        let (row0, row1) = grid
        print(length(row0), row0[2])
        let (t, ...tt) = grid[1]
        print(t)
        print(length(tt), tt[0], tt[1])
    }' \
    "$(printf 'h\ne\nllo\n3 l l\n3 3\n4\n2 5 6')"

test_exit_code "destructure_array_oob" \
    'fn main() {
        let a: [int] = [1, 2]
        let (x, y, z) = a
    }' \
    1

test_output "destructure_nested_tuple_deep" \
    'fn mk_pair(x: int) -> (int, int) {
        return x, x * 10
    }
    fn mk_nested() -> ((int, int), int) {
        return mk_pair(1), 2
    }
    fn mk_deep() -> (((int, int), int), int) {
        return mk_nested(), 4
    }
    fn main() {
        let (((a, b), c), d) = mk_deep()
        print(a, b, c, d)
    }' \
    "1 10 2 4"

test_output "destructure_nested_array_group_rest" \
    'fn main() {
        let grid: [[int]] = [[1, 2, 3], [4, 5]]
        let ((x, y, ...zs), row1) = grid
        print(x, y)
        print(length(zs), zs[0])
        print(length(row1), row1[0], row1[1])
    }' \
    "$(printf '1 2\n1 3\n2 4 5')"

test_output "destructure_array_of_tuples_rest" \
    'fn mk_pair(x: int) -> (int, int) {
        return x, x * 10
    }
    fn main() {
        let pairs: [(int, int)] = [mk_pair(1), mk_pair(2), mk_pair(3)]
        let ((p, q), r, ...tail) = pairs
        print(p, q)
        print(r[0], r[1])
        print(length(tail), tail[0][0], tail[0][1])
    }' \
    "$(printf '1 10\n2 20\n1 3 30')"

test_output "destructure_nested_text_elem" \
    'fn main() {
        let words: [text] = ["hi", "ok"]
        let (w0, (c1, c2)) = words
        print(w0)
        print(c1, c2)
    }' \
    "$(printf 'hi\no k')"

test_output "destructure_nested_multi_assign" \
    'fn mk_pair(x: int) -> (int, int) {
        return x, x * 10
    }
    fn mk_nested() -> ((int, int), int) {
        return mk_pair(1), 2
    }
    fn main() {
        let one = 0
        let two = 0
        let three = 0
        ((one, two), three) = mk_nested()
        print(one, two, three)
    }' \
    "1 10 2"

test_exit_code "destructure_nested_array_oob" \
    'fn main() {
        let grid: [[int]] = [[1], [2, 3]]
        let ((a, b), r) = grid
    }' \
    1

test_exit_code "destructure_array_of_tuples_oob" \
    'fn mk_pair(x: int) -> (int, int) {
        return x, x * 10
    }
    fn main() {
        let pairs: [(int, int)] = [mk_pair(1)]
        let (a, b) = pairs
    }' \
    1

test_exit_code "destructure_nested_text_member" \
    'fn f() -> (int, text) {
        return 1, "x"
    }
    fn main() {
        let (a, (b, c)) = f()
        print(a, b, c)
    }' \
    1

test_exit_code "destructure_text_oob" \
    'fn main() {
        let s = "h"
        let (c1, c2) = s
    }' \
    1

test_exit_code "array_pop_empty" \
    'fn main() {
        let a: [int] = []
        pop(a)
    }' \
    1

test_exit_code "array_slice_oob" \
    'fn main() {
        let a: [int] = [1, 2]
        let b: [int] = slice(a, 0, 5)
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

test_output "tuple_dynamic_index_homogeneous" \
    'fn triple(a: int, b: int, c: int) -> (int, int, int) {
        return a, b, c
    }
    fn main() {
        let t = triple(10, 20, 30)
        let i = 1
        print(t[i])
        print(t[0])
        print(t[i + 1])
    }' \
    "$(printf '20\n10\n30')"

test_output "tuple_dynamic_index_loop" \
    'fn triple(a: int, b: int, c: int) -> (int, int, int) {
        return a, b, c
    }
    fn main() {
        let t = triple(4, 5, 6)
        for (let i = 0; i < 3; i++) {
            print(t[i])
        }
    }' \
    "$(printf '4\n5\n6')"

test_exit_code "tuple_dynamic_index_oob" \
    'fn triple(a: int, b: int, c: int) -> (int, int, int) {
        return a, b, c
    }
    fn main() {
        let t = triple(1, 2, 3)
        let i = 3
        print(t[i])
    }' \
    1

test_exit_code "tuple_dynamic_index_negative" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let t = f()
        let i = -1
        print(t[i])
    }' \
    1

test_output "tuple_dynamic_index_chained" \
    'fn mk(a: int) -> (int, int) {
        return a, a * 10
    }
    fn main() {
        let grid: [(int, int)] = [mk(1), mk(2), mk(3)]
        let i = 1
        let j = 0
        print(grid[i][j])
        print(grid[i][j + 1])
    }' \
    "$(printf '2\n20')"

test_output "tuple_dynamic_index_nested_tuple" \
    'fn mk_pair(a: int) -> (int, int) {
        return a, a + 1
    }
    fn f() -> ((int, int), (int, int)) {
        return mk_pair(1), mk_pair(5)
    }
    fn main() {
        let t = f()
        let i = 0
        print(t[i][0])
        print(t[i][1])
        print(t[1][i + 1])
    }' \
    "$(printf '1\n2\n6')"

test_output "tuple_dynamic_index_destructure" \
    'fn mk_pair(a: int) -> (int, int) {
        return a, a + 1
    }
    fn f() -> ((int, int), (int, int)) {
        return mk_pair(1), mk_pair(5)
    }
    fn main() {
        let t = f()
        let i = 1
        let (x, y) = t[i]
        print(x, y)
    }' \
    "$(printf '5 6')"

test_output "tuple_dynamic_index_capture" \
    'fn mk() -> (int, int) {
        return 1, 2
    }
    fn make() -> fn() -> int {
        let t = mk()
        fn inner() -> int {
            let i = 0
            return t[i]
        }
        return inner
    }
    fn main() {
        let f = make()
        print(f())
    }' \
    "$(printf '1')"

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

test_output "nonlocal_break_loop" \
    'fn main() {
        let total = 0
        loop (5) {
            fn bail() {
                break
            }
            total = total + 1
            if (total == 2) {
                bail()
            }
        }
        print(total)
    }' \
    '2'

test_output "nonlocal_continue_for" \
    'fn main() {
        let total = 0
        for (let i = 0; i < 10; i++) {
            fn skip() {
                continue
            }
            if (i == 5) {
                skip()
            }
            total = total + 1
        }
        print(total)
    }' \
    '9'

test_output "nonlocal_continue_foreach" \
    'fn main() {
        let total = 0
        foreach (i, x in ["a", "b", "c", "d"]) {
            fn skip() {
                continue
            }
            if (x == "c") {
                skip()
            }
            total = total + 1
        }
        print(total)
    }' \
    '3'

test_output "nonlocal_break_while" \
    'fn main() {
        let i = 0
        while (i < 100) {
            fn stop() {
                break
            }
            i = i + 1
            if (i == 7) {
                stop()
            }
        }
        print(i)
    }' \
    '7'

test_output "nonlocal_break_dowhile" \
    'fn main() {
        let j = 0
        do {
            fn halt() {
                break
            }
            j = j + 1
            if (j == 4) {
                halt()
            }
        } while (j < 50)
        print(j)
    }' \
    '4'

test_output "nonlocal_nested_targets" \
    'fn main() {
        let j = 0
        loop (3) {
            fn bail() {
                break
            }
            let k = 0
            while (k < 100) {
                fn inner() {
                    continue
                }
                k = k + 1
                if (k == 7) {
                    inner()
                }
            }
            print("inner", k)
            j = j + 1
            if (j == 2) {
                bail()
            }
        }
        print("after", j)
    }' \
    "$(printf 'inner 100\ninner 100\nafter 2')"

test_output "nonlocal_non_main_owner" \
    'fn outer() {
        loop (2) {
            fn bail() {
                break
            }
            print("iter")
            bail()
        }
        print("after")
    }
    fn main() {
        outer()
    }' \
    "$(printf 'iter\nafter')"

test_output "unicode_identifiers" \
    'fn añadir(a: int, b: int) -> int {
        return a + b
    }
    fn main() {
        let número = 4
        print(añadir(número, 6), "ñ", número)
    }' \
    '10 ñ 4'

test_module_output "mod_output_basic" "main.hmx" \
    '3
42' \
    "lib/math.hmx" 'fn sum(a: int, b: int) -> int {
        return a + b
    }
    fn twice(x: int) -> int {
        return x * 2
    }' \
    "main.hmx" 'use "lib/math.hmx"
    fn main() {
        print(sum(1, 2))
        print(twice(21))
    }'

test_module_output "mod_diamond_dedupe" "main.hmx" \
    '10 18' \
    "lib/d.hmx" 'fn dvalue() -> int {
        return 9
    }' \
    "lib/e1.hmx" 'use "d.hmx"
    fn e1() -> int {
        return dvalue() + 1
    }' \
    "lib/e2.hmx" 'use "d.hmx"
    fn e2() -> int {
        return dvalue() * 2
    }' \
    "main.hmx" 'use "lib/e1.hmx"
    use "lib/e2.hmx"
    fn main() {
        print(e1(), e2())
    }'

test_module_exit_code "mod_exit_code" "main.hmx" 42 \
    "lib/code.hmx" 'fn pick() -> int {
        return 42
    }' \
    "main.hmx" 'use "lib/code.hmx"
    fn main() -> int {
        return pick()
    }'

test_output "curry_partial_named" \
    'fn add(a: int, b: int, c: int) -> int {
        return a + b + c
    }
    fn main() {
        let f = add(1)
        print(f(2, 39))
    }' \
    "42"

test_output "curry_partial_value" \
    'fn twice(a: int, b: int) -> int {
        return a * b
    }
    fn main() {
        let f = twice
        let ten = f(10)
        print(ten(4))
    }' \
    "40"

test_output "curry_lambda_capture" \
    'fn scale(c: int) -> fn(int) -> int {
        return lambda(x: int) -> int {
            return x * c
        }
    }
    fn main() {
        let by3 = scale(3)
        print(by3(14))
    }' \
    "42"

test_output "curry_nested_lambda" \
    'fn main() {
        let outer = lambda(a: int) -> fn(int) -> int {
            return lambda(b: int) -> int {
                return a - b
            }
        }
        let sub10 = outer(20)
        print(sub10(1))
    }' \
    "19"

test_output "curry_void_lambda_statement" \
    'fn main() {
        let tick = lambda() {
            print(9)
        }
        tick()
    }' \
    "9"

test_output "curry_hof_partial" \
    'fn apply(f: fn(int) -> int, x: int) -> int {
        return f(x)
    }
    fn add(a: int, b: int) -> int {
        return a + b
    }
    fn main() {
        print(apply(add(40), 2))
    }' \
    "42"

test_exit_code "curry_exit_chain" \
    'fn add(a: int, b: int) -> int {
        return a + b
    }
    fn main() -> int {
        let inc = add(1)
        return inc(41)
    }' \
    42

test_output "tuple_literal_basic" \
    'fn main() {
        let t = (1, 2)
        print(t[0], t[1])
    }' \
    "1 2"

test_output "tuple_literal_nested" \
    'fn main() {
        let n = (4, (5, 6))
        print(n[0], n[1][0], n[1][1])
    }' \
    "4 5 6"

test_output "tuple_literal_as_arg" \
    'fn swap(t: (int, int)) -> (int, int) {
        return (t[1], t[0])
    }
    fn main() {
        let s = swap((3, 4))
        print(s[0], s[1])
    }' \
    "4 3"

test_output "tuple_literal_fn_value_ret" \
    'fn main() {
        let mk = lambda(b: int) -> (int, int) {
            return (b, b + 1)
        }
        let r = mk(41)
        print(r[0], r[1])
    }' \
    "41 42"

test_output "tuple_literal_heterogeneous" \
    'fn main() {
        let mix = (42, "hi", true)
        print(mix[0], mix[1], mix[2])
    }' \
    "42 hi 1"

test_output "tuple_literal_array_of" \
    'fn main() {
        let grid = [(3, 4), (5, 6)]
        print(grid[0][0], grid[0][1], grid[1][1])
    }' \
    "3 4 6"

test_output "tuple_literal_foreach" \
    'fn main() {
        let pts = [(2, 3), (7, 8)]
        foreach (pt in pts) {
            print(pt[0] + pt[1])
        }
    }' \
    "$(printf '5\n15')"

test_output "tuple_literal_const" \
    'const ORIGIN = (0, 0)
    fn main() {
        let p = ORIGIN
        print(p[0] + p[1])
    }' \
    "0"

test_output "tuple_literal_destructure" \
    'fn main() {
        let (a, b) = (10, 20)
        print(a, b)
    }' \
    "10 20"

test_output "tuple_literal_single_value_return" \
    'fn pair() -> (int, int) {
        return (7, 9)
    }
    fn main() {
        let p = pair()
        print(p[0], p[1])
    }' \
    "7 9"

test_output "grouping_precedence" \
    'fn main() {
        print((2 + 3) * 4)
        print(2 * (3 + 4))
        print(10 - (3 + 4) * 2)
        print(1 + 2 * 3)
    }' \
    "$(printf '20\n14\n-4\n7')"

test_output "tuple_literal_of_arrays" \
    'fn main() {
        let duo = ([1, 2], [3, 4])
        print(duo[0][1], duo[1][0])
    }' \
    "2 3"

test_output "byte_arithmetic_promotion" \
    'fn main() {
        let b: byte = 200
        print(b + 1)
        print(b * 2)
        print(b - 50)
        print(b / 4)
        print(b % 7)
        print(b + 0.5)
        print(-b)
        print(b > 100)
        print(b == 200)
    }' \
    "$(printf '201\n400\n150\n50\n4\n200.500000\n-200\n1\n1')"

test_output "byte_wrap_incr" \
    'fn main() {
        let b: byte = 255
        b++
        print(b)
        b += 2
        print(b)
        b -= 3
        print(b)
        b *= 128
        print(b)
    }' \
    "$(printf '0\n2\n255\n128')"

test_output "byte_casts_and_chars" \
    'fn main() {
        print(65 as byte)
        print(255 as byte)
        print(65 as char)
        let from_int = 70 as int as byte
        let from_char = '\''B'\'' as byte
        print(from_int + from_char)
    }' \
    "$(printf '65\n255\nA\n136')"

test_exit_code "byte_cast_out_of_range_high" \
    'fn main() {
        print(300 as byte)
    }' \
    1

test_exit_code "byte_cast_out_of_range_low" \
    'fn main() {
        print((-1) as byte)
    }' \
    1

test_exit_code "byte_cast_out_of_range_var" \
    'fn main() {
        let x = 400
        print(x as byte)
    }' \
    1

test_output "keyword_var_and_fn_names" \
    'fn double(x: int) -> int { return x * 2 }
     fn main() {
         let static = 5
         let class = 7
         print(static + class)
         print(double(static))
         let unsigned = 3
         let volatile = 4
         print(unsigned * volatile)
         fn inner(struct: int) -> int { return struct + 1 }
         print(inner(unsigned))
     }' \
    "$(printf '12\n10\n12\n4')"

test_output "keyword_closure_loop_destruct" \
    'fn main() {
         let register = 10
         fn uses_capture() -> int { return register * 2 }
         print(uses_capture())
         let typedef: [int] = [1, 2, 3]
         typedef[1] = 9
         print(typedef[1])
         foreach (double, x in typedef) { print(x) }
         for (let goto = 0; goto < 3; goto++) { print(goto) }
         let (extern, union) = (30, 40)
         print(extern + union)
         let (rest_head, ...rest_tail) = [5, 6, 7]
         print(rest_head)
         print(rest_tail[0] + rest_tail[1])
     }' \
    "$(printf '20\n9\n1\n9\n3\n0\n1\n2\n70\n5\n13')"

test_output "transitive_capture_lambda" \
    'fn outer() -> int {
         let a = 5
         fn middle() -> fn() -> int {
             return lambda () -> int { return a * 2 }
         }
         let f = middle()
         return f()
     }
     fn main() {
         print(outer())
     }' \
    "$(printf '10')"

test_output "transitive_capture_three_level" \
    'fn outer() -> int {
         let x = 10
         fn mid() -> fn() -> int {
             return lambda () -> int { return x * 3 }
         }
         let f = mid()
         return f()
     }
     fn main() {
         print(outer())
     }' \
    "$(printf '30')"

test_output "transitive_capture_function_value" \
    'fn outer() -> int {
         let y = 7
         fn l1() -> fn() -> int {
             fn l2() -> fn() -> int {
                 fn l3() -> int { return y + 100 }
                 return l3
             }
             return l2()
         }
         let f = l1()
         return f()
     }
     fn main() {
         print(outer())
     }' \
    "$(printf '107')"

test_output "transitive_capture_param_and_text" \
    'fn param_chain(base: int) -> fn() -> int {
         fn midp() -> fn() -> int {
             return lambda () -> int { return base + 5 }
         }
         return midp()
     }
     fn text_chain() -> text {
         let msg = "hi"
         fn midt() -> fn() -> text {
             return lambda () -> text { return msg + "!" }
         }
         let f = midt()
         return f()
     }
     fn main() {
         let p = param_chain(40)
         print(p())
         print(text_chain())
     }' \
    "$(printf '45\nhi!')"

test_output "array_push_heap_regression" \
    'fn main() {
        let arr: [int] = []
        for (let i = 0; i < 1000; i++) {
            push(arr, i * 2)
        }
        print(length(arr))
        print(arr[999])
        print(arr[0])
    }' \
    "$(printf '1000\n1998\n0')"

echo ""
echo "Stress & Output Tests Passed: $PASS, Failed: $FAIL"
rm -rf "$TMPDIR"
[ $FAIL -eq 0 ]
