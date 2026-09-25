#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./build/hmx"
TMPDIR="/tmp/hmx_neg_tests"
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

# Name, entry path (relative to temp dir), then repeated "path|content" pairs.
# The entry is compiled and the combined output must match expected_pattern.
test_error_module() {
    local test_name="$1"
    local entry="$2"
    local expected_pattern="$3"
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

test_error "byte_out_of_range" \
    'fn main() {
        let value: byte = 256
    }' \
    "byte value must be between 0 and 255"

test_error "char_arithmetic" \
    'fn main() {
        let value: char = '"'"'a'"'"'
        value += 1
    }' \
    "requires int or decimal"

test_error "switch_non_scalar" \
    'fn main() {
        switch ("value") {
            case "value":
                print(1)
        }
    }' \
    "switch value must be int, byte, or char"

test_error "switch_duplicate_case" \
    'fn main() {
        switch (1) {
            case 1:
                print(1)
            case 1:
                print(2)
        }
    }' \
    "duplicate switch case value"

test_error "switch_multiple_default" \
    'fn main() {
        switch (1) {
            default:
                print(1)
            default:
                print(2)
        }
    }' \
    "multiple default"

test_error "substring_index_type" \
    'fn main() {
        print(substring("hello", 1.0, 2))
    }' \
    "expects int indexes"

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

test_error "array_element_type_mismatch" \
    'fn main() {
        let a: [int] = ["x", "y"]
    }' \
    "type mismatch: variable 'a' declared as array of int"

test_error "array_mixed_element_types" \
    'fn main() {
        let a = [1, 2, "three"]
    }' \
    "array elements must all be the same type"

test_error "array_untyped_empty" \
    'fn main() {
        let a = []
        print(a[0])
    }' \
    "cannot infer array element type"

test_error "array_nested_mismatch" \
    'fn main() {
        let a: [int] = [[1], [2]]
    }' \
    "declared as array of int but initialized with array of array of int"

test_error "array_nested_element_mismatch" \
    'fn main() {
        let a: [[int]] = [[1], ["x"]]
    }' \
    "array elements must all be the same type"

test_error "array_index_on_non_array" \
    'fn main() {
        let n = 5
        print(n[0])
    }' \
    "is not an array"

test_error "array_index_non_int" \
    'fn main() {
        let a: [int] = [1]
        print(a["x"])
    }' \
    "array index must be int"

test_error "array_assign_type_mismatch" \
    'fn main() {
        let a: [int] = [1]
        a[0] = "x"
    }' \
    "cannot assign text to array element of int"

test_error "array_assign_immutable" \
    'fn main() {
        const a: [int] = [1]
        a[0] = 5
    }' \
    "cannot modify immutable variable"

test_error "array_binary_op" \
    'fn main() {
        let a: [int] = [1]
        print(a + a)
    }' \
    "not defined for type array"

test_error "print_array" \
    'fn main() {
        let a: [int] = [1]
        print(a)
    }' \
    "cannot print an array"

test_error "array_param_element_mismatch" \
    'fn f(a: [int]) {
        print(1)
    }
    fn main() {
        f(["x"])
    }' \
    "expects array of int, got array of text"

test_error "array_builtin_push_non_array" \
    'fn main() {
        push(3, 1)
    }' \
    "builtin 'push' expects an array as argument 1"

test_error "array_builtin_push_type_mismatch" \
    'fn main() {
        let a: [int] = [1]
        push(a, "x")
    }' \
    "cannot push text to array of int"

test_error "array_builtin_push_immutable" \
    'fn main() {
        const a: [int] = [1]
        push(a, 2)
    }' \
    "cannot modify immutable array 'a'"

test_error "array_builtin_push_as_value" \
    'fn main() {
        let a: [int] = [1]
        let x = push(a, 2)
    }' \
    "returns nothing and cannot be used as a value"

test_error "array_builtin_sort_bool" \
    'fn main() {
        let a: [bool] = [true, false]
        sort(a)
    }' \
    "requires an array of int, decimal, byte, char, or text"

test_error "array_builtin_slice_non_int" \
    'fn main() {
        let a: [int] = [1]
        let b = slice(a, 0, "x")
    }' \
    "builtin 'slice' expects int indexes"

test_error "array_builtin_concat_mismatch" \
    'fn main() {
        concat([1], ["x"])
    }' \
    "cannot concatenate array of text with array of int"

test_error "array_builtin_index_of_type_mismatch" \
    'fn main() {
        index_of(["a", "b"], 2)
    }' \
    "index_of value of int does not match array of text"

test_error "array_builtin_index_of_nested" \
    'fn main() {
        index_of([[1]], [1])
    }' \
    "requires an array of scalar or text elements"

test_error "array_builtin_pop_on_const" \
    'fn main() {
        const a: [int] = [1]
        pop(a)
    }' \
    "cannot modify immutable array 'a'"

test_error "text_index_assign" \
    'fn main() {
        let s = "hi"
        s[0] = '\''x'\''
    }' \
    "cannot assign to a character of a text value"

test_error "text_index_non_int" \
    'fn main() {
        let s = "hi"
        let c = s[1.5]
    }' \
    "text index must be int, got decimal"

test_error "ord_expects_char_int" \
    'fn main() {
        let n = ord(5)
    }' \
    "builtin 'ord' expects char, got int"

test_error "ord_expects_char_text" \
    'fn main() {
        let n = ord("a")
    }' \
    "builtin 'ord' expects char, got text"

test_error "ord_arity" \
    'fn main() {
        let n = ord('\''a'\'', '\''b'\'')
    }' \
    "builtin 'ord' expects 1 arguments, got 2"

test_error "chr_expects_int" \
    'fn main() {
        let c = chr("a")
    }' \
    "builtin 'chr' expects int, got text"

test_error "split_expects_text1" \
    'fn main() {
        let p = split(3, ",")
    }' \
    "builtin 'split' expects text as argument 1, got int"

test_error "split_expects_text2" \
    'fn main() {
        let p = split("a", 3)
    }' \
    "builtin 'split' expects text as argument 2, got int"

test_error "split_arity" \
    'fn main() {
        let p = split("a")
    }' \
    "builtin 'split' expects 2 arguments, got 1"

test_error "tuple_print" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        print(f())
    }' \
    "cannot print a tuple"

test_error "tuple_binary_op" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let t = f()
        print(t + t)
    }' \
    "not defined for type tuple"

test_error "tuple_ternary" \
    'fn f(flag: bool) -> (int, int) {
        if (flag) {
            return 1, 2
        }
        return 3, 4
    }
    fn main() {
        let t = true ? f(true) : f(false)
    }' \
    "ternary branches cannot be tuples"

test_error "tuple_index_non_constant" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let t = f()
        let i = 0
        print(t[i])
    }' \
    "tuple index must be an integer constant"

test_error "tuple_index_out_of_range" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let t = f()
        print(t[2])
    }' \
    "tuple index 2 out of range"

test_error "tuple_index_on_int" \
    'fn main() {
        let n = 5
        print(n[0])
    }' \
    "is not an array"

test_error "tuple_destruct_count_mismatch" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let (a, b, c) = f()
    }' \
    "cannot destructure tuple of 2 members into 3 variables"

test_error "tuple_destruct_non_tuple" \
    'fn main() {
        let (a, b) = 5
    }' \
    "right side of destructuring must be a tuple, array, or text, got int"

test_error "destruct_tuple_rest" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let (a, ...rest) = f()
    }' \
    "cannot use '...rest' when destructuring a tuple"

test_error "destruct_array_unknown_elem" \
    'fn main() {
        let (a, b) = []
    }' \
    "cannot infer element type for this array destructuring"

test_error "destruct_array_multiassign_mismatch" \
    'fn main() {
        let a = "x"
        let b = "y"
        (a, b) = [1, 2]
    }' \
    "cannot assign int to text"

test_error "destruct_array_rest_target_mismatch" \
    'fn main() {
        let x = 1
        let r = 5
        (x, ...r) = [1, 2, 3]
    }' \
    "cannot assign array of int to int"

test_error "destruct_array_immutable_target" \
    'fn main() {
        const c: int = 1
        let a: int = 0
        (c, a) = [5, 6]
    }' \
    "cannot modify immutable variable 'c'"

test_error "destruct_text_multiassign_mismatch" \
    'fn main() {
        let x = 1
        let y = 2
        (x, y) = "ab"
    }' \
    "cannot assign char to int"

test_error "destruct_text_rest_target_mismatch" \
    'fn main() {
        let a = '\''a'\''
        let r: [int] = [1]
        (a, ...r) = "hi there"
    }' \
    "cannot assign text to array of int"

test_error "tuple_destruct_target_type_mismatch" \
    'fn f() -> (int, text) {
        return 1, "x"
    }
    fn main() {
        let x = 5
        let y = 6
        (x, y) = f()
    }' \
    "type mismatch"

test_error "tuple_destruct_undefined_target" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        (a, b) = f()
    }' \
    "undefined variable"

test_error "tuple_return_count_mismatch" \
    'fn f() -> (int, int) {
        return 1, 2, 3
    }
    fn main() {
        print(0)
    }' \
    "returns 2 values but return statement provides 3"

test_error "tuple_return_member_type_mismatch" \
    'fn f() -> (int, int) {
        return 1, "x"
    }
    fn main() {
        print(0)
    }' \
    "return value 2 has type text"

test_error "tuple_return_single_whole_scalar" \
    'fn f() -> (int, int) {
        return 5
    }
    fn main() {
        print(0)
    }' \
    "type mismatch: return int but function returns"

test_error "tuple_nested_pattern_on_char" \
    'fn main() {
        let s: text = "hi"
        let (a, (b, c)) = s
        print(a, b, c)
    }' \
    "cannot destructure a character into a nested pattern"

test_error "tuple_nested_pattern_on_scalar_elem" \
    'fn main() {
        let a: [int] = [1, 2, 3]
        let ((x, y), z) = a
        print(x)
    }' \
    "cannot destructure a value of type int into a nested pattern"

test_error "tuple_nested_count_mismatch" \
    'fn mk3() -> (int, int, int) {
        return 1, 2, 3
    }
    fn mk() -> ((int, int, int), int) {
        return mk3(), 4
    }
    fn main() {
        let ((a, b), c) = mk()
        print(a)
    }' \
    "cannot destructure tuple of 3 members into 2 variables"

test_error "tuple_nested_rest_in_group" \
    'fn mk() -> (int, int) {
        return 1, 2
    }
    fn f() -> ((int, int), int) {
        return mk(), 3
    }
    fn main() {
        let ((a, ...r), b) = f()
        print(a)
    }' \
    "cannot use '...rest' when destructuring a tuple"

test_error "destruct_rest_not_last_array" \
    'fn main() {
        let a: [int] = [1, 2, 3]
        let (...r, x) = a
        print(x)
    }' \
    "cannot use '...rest' before another destructuring target"

test_error "destruct_rest_not_last_text" \
    'fn main() {
        let s = "hello"
        let (...r, x) = s
        print(x)
    }' \
    "cannot use '...rest' before another destructuring target"

test_error "tuple_nested_multiassign_undefined" \
    'fn mk_pair(x: int) -> (int, int) {
        return x, x * 10
    }
    fn mk_nested() -> ((int, int), int) {
        return mk_pair(1), 2
    }
    fn main() {
        let one = 0
        ((one, two), three) = mk_nested()
        print(one)
    }' \
    "undefined variable 'two'"

test_error "tuple_annotated_mismatch" \
    'fn f() -> (int, text) {
        return 1, "x"
    }
    fn main() {
        let t: (int, int) = f()
    }' \
    "but initialized with"

test_error "tuple_length" \
    'fn f() -> (int, int) {
        return 1, 2
    }
    fn main() {
        let t = f()
        print(length(t))
    }' \
    "builtin .length. expects text or array, got tuple"

test_error "tuple_bare_return" \
    'fn f() -> (int, int) {
        return
    }
    fn main() {
        print(0)
    }' \
    "bare return used"

test_error "tuple_call_arg_shape_mismatch" \
    'fn pair_txt() -> (int, text) {
        return 1, "x"
    }
    fn g(t: (int, int)) -> int {
        return t[0]
    }
    fn main() {
        let p = pair_txt()
        print(g(p))
    }' \
    "expects tuple \\(int, int\\), got tuple \\(int, text\\)"

test_error "mod_on_decimal" \
    'fn main() {
        let x = 5.5 % 2.5
        print(x)
    }' \
    "operator '%' not defined for type decimal"

test_error "mod_on_text" \
    'fn main() {
        let x = "abc" % "def"
        print(x)
    }' \
    "operator '%' not defined for type text"

test_error "mod_type_mismatch" \
    'fn main() {
        let x = 5 % 2.5
        print(x)
    }' \
    "type mismatch in binary expression"

test_error "mod_eq_on_decimal" \
    'fn main() {
        let x = 5.5
        x %= 2
        print(x)
    }' \
    "operator '%=' requires int"

test_error "unary_minus_on_text" \
    'fn main() {
        let x = -"abc"
        print(x)
    }' \
    "operator '-' not defined for type text"

test_error "break_outside_loop" \
    'fn main() {
        break
    }' \
    "break outside of a loop"

test_error "continue_outside_loop" \
    'fn main() {
        continue
    }' \
    "continue outside of a loop"

test_error "break_in_switch_no_loop" \
    'fn main() {
        loop (1) {
            switch (1) {
                case 1: break
            }
        }
    }' \
    "break inside a switch case requires an enclosing loop"

test_error "continue_in_switch_no_loop" \
    'fn main() {
        loop (1) {
            switch (1) {
                case 1: continue
            }
        }
    }' \
    "continue inside a switch case requires an enclosing loop"

test_error "foreach_on_int" \
    'fn main() {
        foreach (x in 5) {
            print(x)
        }
    }' \
    "foreach iterable must be an array or text, got int"

test_error "foreach_on_tuple" \
    'fn pair() -> (int, int) {
        return 1, 2
    }
    fn main() {
        foreach (x in pair()) {
            print(x)
        }
    }' \
    "foreach iterable must be an array or text, got tuple"

test_error "foreach_var_out_of_scope" \
    'fn main() {
        let a = [1, 2]
        foreach (x in a) {
            print(x)
        }
        print(x)
    }' \
    "undefined variable"

test_error "input_with_args" \
    'fn main() {
        print(input(5))
    }' \
    "builtin 'input' expects 0 arguments, got 1"

test_error "tostr_on_array" \
    'fn main() {
        print(tostr([1, 2]))
    }' \
    "builtin 'tostr' expects int, decimal, bool, byte, char, or text"

test_error "tostr_wrong_arity" \
    'fn main() {
        print(tostr())
    }' \
    "builtin 'tostr' expects 1 arguments, got 0"

test_error "parse_int_on_int" \
    'fn main() {
        print(parse_int(42))
    }' \
    "builtin 'parse_int' expects text, got int"

test_error "parse_decimal_on_bool" \
    'fn main() {
        print(parse_decimal(true))
    }' \
    "builtin 'parse_decimal' expects text, got bool"

test_error "print_zero_args" \
    'fn main() {
        print()
    }' \
    "syntax error near"

test_error "print_array_arg" \
    'fn main() {
        let a = [1, 2]
        print(a, 5)
    }' \
    "cannot print an array"

test_error "print_tuple_arg" \
    'fn pair() -> (int, int) {
        return 1, 2
    }
    fn main() {
        print(pair())
    }' \
    "cannot print a tuple"

test_error "nested_fn_assigns_captured" \
    'fn main() {
        let outer = 5
        fn helper() {
            outer = 7
        }
        helper()
    }' \
    "cannot assign to captured variable"

test_error "closures_capture_not_in_scope" \
    'fn other() {
        let local = 5
        fn g() -> int { return local }
    }
    fn main() {
        print(g())
    }' \
    "captured variable 'local' is not in scope"

test_error "closures_forward_ref_value" \
    'fn main() {
        let f: fn(int) -> int = g
        fn g(n: int) -> int { return n }
    }' \
    "must be declared before it is used as a value"

test_error "closures_use_main_value" \
    'fn apply(f: fn(int) -> int, x: int) -> int { return f(x) }
    fn main() {
        print(apply(main, 3))
    }' \
    "cannot use function 'main' as a value"

test_error "closures_print_function" \
    'fn twice(a: int) -> int { return a + a }
    fn main() {
        let f: fn(int) -> int = twice
        print(f)
    }' \
    "cannot print a function"

test_error "closures_ternary_function" \
    'fn twice(a: int) -> int { return a + a }
    fn main() {
        let f: fn(int) -> int = twice
        let t = true
        print(t ? f : f)
    }' \
    "ternary branches cannot be functions"

test_error "closures_arg_fn_mismatch" \
    'fn twice(a: int) -> int { return a + a }
    fn concat(a: int, b: int) -> int { return a + b }
    fn choose(b: bool, f: fn(int) -> int, g: fn(int) -> int) -> int {
        if (b) { return f(1) }
        return g(1)
    }
    fn main() {
        let f: fn(int) -> int = twice
        let g: fn(int, int) -> int = concat
        print(choose(true, f, g))
    }' \
    "argument 3 of 'choose' expects"

test_error "closures_var_mismatch" \
    'fn twice(a: int) -> int { return a + a }
    fn concat(a: int, b: int) -> int { return a + b }
    fn main() {
        let f: fn(int, int) -> int = twice
    }' \
    "but initialized with"

test_error "closures_assign_mismatch" \
    'fn twice(a: int) -> int { return a + a }
    fn concat(a: int, b: int) -> int { return a + b }
    fn main() {
        let f: fn(int) -> int = twice
        f = concat
    }' \
    "cannot assign"

test_error "closures_return_mismatch" \
    'fn make() -> fn(int) -> int {
        let g = 1
        fn h(n: int) -> int { return n + g }
        return 5
    }
    fn main() {
        let f = make()
        print(f(3))
    }' \
    "but function returns function"

test_error "closures_return_fn_mismatch" \
    'fn make() -> fn(int) -> int {
        let g = 1
        fn h(n: int, k: int) -> int { return n + k + g }
        return h
    }
    fn main() {
        let f = make()
        print(f(3))
    }' \
    "but function returns fn"

test_error "closures_call_arity" \
    'fn apply(f: fn(int) -> int, x: int) -> int { return f(x) }
    fn twice(a: int) -> int { return a + a }
    fn main() {
        let f: fn(int) -> int = twice
        print(f(1, 2))
    }' \
    "expects 1 arguments, got 2"

test_error "nested_fn_duplicate_global" \
    'fn add() {
        print(0)
    }
    fn main() {
        fn add() {
            print(0)
        }
    }' \
    "duplicate declaration of function"

test_error "nested_fn_duplicate_sibling" \
    'fn main() {
        fn first() {
            print(0)
        }
        fn first() {
            print(0)
        }
    }' \
    "duplicate declaration of function"

test_error "nested_fn_named_main" \
    'fn main() {
        fn main() {
            print(0)
        }
    }' \
    "duplicate declaration of function"

test_error "nested_fn_break_outside_loop" \
    'fn main() {
        let x = 1
        fn helper() {
            break
        }
        print(x)
    }' \
    "break outside of a loop"

test_error "nl_reject_call_outside_loop" \
    'fn main() {
        loop (3) {
            fn bail() {
                break
            }
        }
        bail()
    }' \
    "its non-local break/continue target loop is not active here"

test_error "nl_reject_call_from_other_fn" \
    'fn owner() {
        loop (3) {
            fn bail() {
                break
            }
            bail()
        }
    }
    fn main() {
        bail()
    }' \
    "its non-local break/continue target loop is not active here"

test_error "nl_reject_forwarded_via_wrapper" \
    'fn main() {
        loop (3) {
            fn bail() {
                break
            }
            fn wrapper() {
                bail()
            }
            wrapper()
        }
    }' \
    "its non-local break/continue target loop is not active here"

test_error "nl_reject_cross_loop_call" \
    'fn main() {
        loop (3) {
            fn bail() {
                break
            }
            fn swipe() {
                continue
            }
        }
        loop (3) {
            bail()
            swipe()
        }
    }' \
    "its non-local break/continue target loop is not active here"

test_error "nl_reject_token_as_value" \
    'fn main() {
        loop (3) {
            fn bail() {
                break
            }
            let f = bail
        }
    }' \
    "cannot use function 'bail' as a value because it has a non-local break/continue target"

test_error "nl_reject_token_as_arg" \
    'fn apply(f: fn(int) -> int, x: int) -> int {
        return f(x)
    }
    fn main() {
        loop (3) {
            fn bail(n: int) -> int {
                break
            }
            apply(bail, 5)
        }
    }' \
    "function 'bail'"

test_error "nl_continue_outside_loop" \
    'fn main() {
        fn helper() {
            continue
        }
        helper()
    }' \
    "continue outside of a loop"

test_error "default_param_type_mismatch" \
    'fn f(a: int = "x") {
        print(a)
    }' \
    "default value for parameter 'a' of function 'f' must be a literal of type int"

test_error "default_param_non_literal" \
    'fn f(a: int = 1 + 2) {
        print(a)
    }' \
    "default value for parameter 'a' of function 'f' must be a literal of type int"

test_error "default_param_not_trailing" \
    'fn f(a: int = 1, b: int) {
        print(a)
    }' \
    "cannot follow a parameter with a default value"

test_error "default_param_byte_range" \
    'fn f(a: byte = 300) {
        print(a)
    }' \
    "default value for byte parameter 'a' must be between 0 and 255"

test_error "default_params_too_few_args" \
    'fn f(a: int, b: int = 2) {
        print(a)
    }
    fn main() {
        f()
    }' \
    "expects at least 1 argument, got 0"

test_error "variadic_not_last" \
    'fn f(rest: ...int, a: int) {
        print(a)
    }' \
    "must be the last parameter"

test_error "variadic_duplicate" \
    'fn f(x: ...int, y: ...int) {
        print(x)
    }' \
    "more than one variadic parameter"

test_error "variadic_collects_array" \
    'fn f(rest: ...[int]) {
        print(length(rest))
    }' \
    "must collect a scalar type"

test_error "variadic_wrong_type" \
    'fn f(a: int, rest: ...int) {
        print(a)
    }
    fn main() {
        f(1, "s")
    }' \
    "type mismatch: variadic argument 2 of 'f' expects int, got text"

echo ""
test_error_module "use_missing_file" "main.hmx" "cannot open module" \
    "main.hmx" 'use "lib/nope.hmx"
    fn main() {
        print(0)
    }'

test_error_module "use_non_hmx" "main.hmx" "must be a .hmx file" \
    "lib/math.txt" 'fn sum(a: int, b: int) -> int {
        return a + b
    }' \
    "main.hmx" 'use "lib/math.txt"
    fn main() {
        print(0)
    }'

test_error_module "use_cycle" "main.hmx" "circular module dependency" \
    "lib/c2.hmx" 'use "c1.hmx"
    fn fc2() {
        print(2)
    }' \
    "lib/c1.hmx" 'use "c2.hmx"
    fn fc1() {
        print(1)
    }' \
    "main.hmx" 'use "lib/c1.hmx"
    fn main() {
        fc1()
    }'

test_error_module "use_cycle_to_entry" "main.hmx" "circular module dependency" \
    "lib/up.hmx" 'use "../main.hmx"
    fn up() {
        print(1)
    }' \
    "main.hmx" 'use "lib/up.hmx"
    fn main() {
        up()
    }'

test_error_module "use_not_at_top" "main.hmx" "Parse error" \
    "lib/math.hmx" 'fn sum(a: int, b: int) -> int {
        return a + b
    }' \
    "main.hmx" 'fn main() {
        print(1)
    }
    use "lib/math.hmx"'

test_error_module "use_dup_function" "main.hmx" "duplicate declaration of function" \
    "lib/a.hmx" 'fn fa(x: int) -> int {
        return x + 5
    }' \
    "lib/b.hmx" 'fn fa(x: int) -> int {
        return x + 1
    }' \
    "main.hmx" 'use "lib/a.hmx"
    use "lib/b.hmx"
    fn main() {
        print(fa(3))
    }'

test_error_module "use_module_type_error" "main.hmx" "Error \[.*err\.hmx:4\]" \
    "lib/err.hmx" 'fn bad() {
        let x = "a"
        x = 5
    }' \
    "main.hmx" 'use "lib/err.hmx"
    fn main() {
        bad()
    }'

test_error_module "use_module_parse_error" "main.hmx" "parsing failed in module" \
    "lib/syn.hmx" 'fn broken( {' \
    "main.hmx" 'use "lib/syn.hmx"
    fn main() {
        print(0)
    }'

test_error "use_reserved_keyword" \
    'fn main() {
        let use = 5
        print(use)
    }' \
    "Parse error"

echo "Negative Tests Passed: $PASS, Failed: $FAIL"
rm -rf "$TMPDIR"
[ $FAIL -eq 0 ]
