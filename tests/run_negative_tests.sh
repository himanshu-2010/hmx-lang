#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/stardance"
TMPDIR="/tmp/stardance_neg_tests"
mkdir -p "$TMPDIR"

PASS=0
FAIL=0

test_error() {
    local test_name="$1"
    local code="$2"
    local expected_pattern="$3"

    local file="$TMPDIR/${test_name}.hmx"
    printf '%s\n' "$code" > "$file"

    local output
    set +e
    output=$("$BIN" run "$file" 2>&1)
    local exit_code=$?
    set -e

    if [ $exit_code -ne 0 ] && echo "$output" | grep -qiE "$expected_pattern"; then
        echo "PASS (Negative): $test_name"
        PASS=$((PASS+1))
    else
        echo "FAIL (Negative): $test_name"
        echo "   Expected pattern: $expected_pattern"
        echo "   Got exit code $exit_code with output:"
        echo "$output" | sed 's/^/   /'
        FAIL=$((FAIL+1))
    fi
}

echo "=== Running Negative / Error Handling Tests ==="

test_error "decl_type_mismatch" \
    'fn main() {
        let x: int = "text"
    }' \
    "type mismatch"

test_error "duplicate_variable" \
    'fn main() {
        let x = 1
        let x = 2
    }' \
    "duplicate declaration of variable"

test_error "duplicate_function" \
    'fn helper() {
        print(1)
    }
    fn helper() {
        print(2)
    }
    fn main() {
        print(0)
    }' \
    "duplicate declaration of function"

test_error "missing_return" \
    'fn value(flag: bool) -> int {
        if (flag) {
            return 1
        }
    }
    fn main() {
        print(value(true))
    }' \
    "may exit without returning int"

test_error "assign_type_mismatch" \
    'fn main() {
        let x = 5
        x = "hello"
    }' \
    "type mismatch"

test_error "binary_type_mismatch" \
    'fn main() {
        let x = 5 + "text"
    }' \
    "type mismatch"

test_error "binary_bool_addition" \
    'fn main() {
        let x = true + false
    }' \
    "operator.*not defined"

test_error "binary_mixed_int_decimal" \
    'fn main() {
        let x = 5 + 3.14
    }' \
    "type mismatch"

test_error "text_ordering" \
    'fn main() {
        let b = "a" < "b"
    }' \
    "operator.*not defined for type text"

test_error "logical_non_bool" \
    'fn main() {
        let b = 5 and 3
    }' \
    "requires bool"

test_error "not_non_bool" \
    'fn main() {
        let b = not 5
    }' \
    "requires bool"

test_error "loop_count_non_int" \
    'fn main() {
        loop("5") {
            print(1)
        }
    }' \
    "loop count must be int"

test_error "while_cond_non_bool" \
    'fn main() {
        while (5) {
            print(1)
        }
    }' \
    "while condition must be bool"

test_error "for_cond_non_bool" \
    'fn main() {
        for (let i = 0; 5; i++) {
            print(i)
        }
    }' \
    "for condition must be bool"

test_error "for_update_text_increment" \
    'fn main() {
        for (let s = "x"; true; s++) {
            print(s)
        }
    }' \
    "requires int or decimal"

test_error "do_while_cond_non_bool" \
    'fn main() {
        do {
            print(1)
        } while (5)
    }' \
    "do-while condition must be bool"

test_error "semicolon_outside_for" \
    'fn main() {
        let x = 1;
    }' \
    "Parse error"

test_error "if_cond_non_bool" \
    'fn main() {
        if (5) {
            print(1)
        }
    }' \
    "if condition must be bool"

test_error "else_if_cond_non_bool" \
    'fn main() {
        if (true) {
            print(1)
        } else if (5) {
            print(2)
        }
    }' \
    "if condition must be bool"

test_error "ternary_cond_non_bool" \
    'fn main() {
        let value = 1 ? 2 : 3
    }' \
    "ternary condition must be bool"

test_error "ternary_branch_type_mismatch" \
    'fn main() {
        let value = true ? 1 : 2.0
    }' \
    "ternary branches must have the same type"

test_error "invalid_cast" \
    'fn main() {
        let value = "text" as int
    }' \
    "casts are only supported between int and decimal"

test_error "const_assignment" \
    'fn main() {
        const value = 1
        value = 2
    }' \
    "cannot modify immutable variable"

test_error "const_compound_assignment" \
    'fn main() {
        const value = 1
        value += 2
    }' \
    "cannot modify immutable variable"

test_error "const_increment" \
    'fn main() {
        const value = 1
        value++
    }' \
    "cannot modify immutable variable"

test_error "undef_var_read" \
    'fn main() {
        print(nope)
    }' \
    "undefined variable"

test_error "undef_var_assign" \
    'fn main() {
        nope = 5
    }' \
    "undefined variable"

test_error "compound_assign_type_mismatch" \
    'fn main() {
        let x = 5
        x += "str"
    }' \
    "type mismatch"

test_error "compound_assign_text" \
    'fn main() {
        let s = "hello"
        s += 1
    }' \
    "requires int or decimal"

test_error "incr_text" \
    'fn main() {
        let s = "hello"
        s++
    }' \
    "requires int or decimal"

test_error "string_concat_mixed" \
    'fn main() {
        let s = "hello" + 5
    }' \
    "type mismatch"

test_error "string_subtraction" \
    'fn main() {
        let s = "hello" - "world"
    }' \
    "operator '-' not defined for type text"

test_error "undef_fn_call" \
    'fn main() {
        no_such_func()
    }' \
    "undefined function"

test_error "call_main" \
    'fn foo() {
        main()
    }
    fn main() {
        foo()
    }' \
    "cannot call function 'main'"

test_error "call_arg_count_mismatch" \
    'fn add(a: int, b: int) -> int {
        return a + b
    }
    fn main() {
        add(1)
    }' \
    "expects 2 arguments, got 1"

test_error "call_arg_type_mismatch" \
    'fn add(a: int, b: int) -> int {
        return a + b
    }
    fn main() {
        add(1, "two")
    }' \
    "type mismatch: argument 2"

test_error "void_fn_as_value" \
    'fn greet() {
        print("hi")
    }
    fn main() {
        let x = greet()
    }' \
    "returns nothing and cannot be used as a value"

test_error "return_val_in_void_fn" \
    'fn greet() {
        return 42
    }
    fn main() {
        greet()
    }' \
    "return value in void function"

test_error "bare_return_in_typed_fn" \
    'fn calc() -> int {
        return
    }
    fn main() {
        calc()
    }' \
    "bare return used"

test_error "return_type_mismatch" \
    'fn calc() -> int {
        return "hello"
    }
    fn main() {
        calc()
    }' \
    "type mismatch: return text but function returns int"

test_error "return_outside_fn" \
    'let x = 10
    return 5' \
    "return outside of function"

test_error "syntax_unclosed_brace" \
    'fn main() {
        let x = 5' \
    "Parse error"

test_error "syntax_unclosed_paren" \
    'fn main() {
        print(5
    }' \
    "Parse error"

test_error "unterminated_block_comment" \
    '/* unclosed comment
    fn main() {}' \
    "unterminated block comment"

test_error "unary_minus_not_in_spec" \
    'fn main() {
        let x = -5
    }' \
    "Parse error"

echo ""
echo "Negative Tests Passed: $PASS, Failed: $FAIL"
rm -rf "$TMPDIR"
[ $FAIL -eq 0 ]
