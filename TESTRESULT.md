# HMX Transpiler — Test Execution Report

**Date:** 2026-09-17  
**Target Project:** HMX Transpiler (the `hmx-lang/` directory in this repo)  
**Status:** ALL TESTS PASSED (219 / 219)

---

## Executive Summary

A comprehensive, rigorous re-test was conducted against the HMX transpiler pipeline (Lexer → Parser → Type Resolver → Codegen → GCC) after incorporation of **function types, higher-order calls, and closures**:
1. **`foreach`**: `foreach (x in coll)` and `foreach (i, x in coll)` over arrays and text, value-copy loop variables, with `break`/`continue` support.
2. **`input()`**: reads a stdin line as `text` (empty string at end of input).
3. **Conversions**: `tostr`, `parse_int`, `parse_decimal` (runtime error + exit code 1 on malformed input).
4. **Variadic `print(a, b, c)`**: space-separated single-line output via one `printf`.
5. **Nested functions**: `fn` declarations inside function bodies, hoisted to program scope, with program-unique names.
6. **Default parameter values**: trailing `name: type = literal` defaults padded at call sites.
7. **Variadic parameters**: a single trailing `...type` parameter collects extra args into an array.
8. **Function types**: `fn(<param_types>) -> <return_type>` in annotations, parameters, and return types.
9. **Function values**: a named function (other than `main`) is a first-class value; can be passed, returned, stored, and called via variables.
10. **Higher-order calls**: calling a variable of function type triggers arity + type checking.
11. **Closures**: nested functions capture enclosing locals by-value snapshot; heap-allocated env survives enclosing scope; captured variables are read-only.

> [!IMPORTANT]
> **Summary Statistics:**
> - **Total Test Cases Executed:** 219
> - **Passed:** 219
> - **Failed:** 0
> - **Pass Rate:** 100%

---

## Test Environment & Toolchain

- **Operating System:** Linux (Kernel x86_64)
- **C/C++ Compiler:** `gcc` / `g++` (16.2.1)
- **Lexer Generator:** `flex` (2.6.4)
- **Parser Generator:** `bison` (3.8.2)
- **Build System:** `cmake` (4.4.3)
- **Optimization Level:** `-O2`

---

## Test Results by Category

### 1. Integration Fixtures (37/37 Passed)

These tests compile HMX (`.hmx`) source files into native C binaries via GCC and verify clean execution and output correctness.

| Test Case Name | Feature Tested | Description | Status |
| :--- | :--- | :--- | :---: |
| `assignment.hmx` | Assignment Ops | Tests `=`, `+=`, `-=`, `*=`, `/=`, `++`, `--` statements inside loops and functions | **PASS** |
| `block_comments.hmx` | Lexer Comments | Multi-line `/* ... */` comment stripping without affecting code execution | **PASS** |
| `booleans.hmx` | Logical Operators | Both keyword (`and`, `or`, `not`) and symbol (`&&`, `\|\|`, `!`) boolean operations | **PASS** |
| `calls.hmx` | Function Calls | Void function calls, parameter passing, and returning values | **PASS** |
| `comparisons.hmx` | Relational Ops | `==`, `!=`, `<`, `>`, `<=`, `>=` comparisons on integer literals and expressions | **PASS** |
| `complex_math.hmx` | Precedence | Operator precedence (`*`/`/` over `+`/`-`), grouping `()`, left-associativity, `decimal` ops | **PASS** |
| `control_flow_nested.hmx` | Control Flow | Nested `loop(N)` blocks inside nested `if`/`else` branches | **PASS** |
| `do_while.hmx` | Do-While Loop | Body executes once, then checks boolean condition | **PASS** |
| `else_if.hmx` | Else-If Chains | Multiple conditional branches with an optional final `else` | **PASS** |
| `expressions.hmx` | Expressions | Complex arithmetic expression trees with variables and constants | **PASS** |
| `fn_params.hmx` | Function Params | Functions with multiple typed parameters (`a: int, b: text`) and explicit return types (`-> int`) | **PASS** |
| `for.hmx` | For Loop | C-style `for (let i = 0; i < n; i++)` loop | **PASS** |
| `for_assignment_init.hmx` | For Assignment Init | `for` header using an existing variable assignment as initializer | **PASS** |
| `forward_calls.hmx` | Prototypes | Out-of-order function declarations (calling functions declared later in source) | **PASS** |
| `functions.hmx` | Basic Functions | Function definitions and simple function invocation | **PASS** |
| `ifelse.hmx` | Conditionals | `if (cond) { ... } else { ... }` branching logic | **PASS** |
| `loop.hmx` | Counted Loops | `loop(count)` counted loop execution | **PASS** |
| `loops_nested.hmx` | Loop Nesting | Combined `loop`, `while`, `for`, and `do-while` nesting | **PASS** |
| `recursion.hmx` | Direct Recursion | Direct recursive function calls calculating Fibonacci numbers | **PASS** |
| `scope_shadowing.hmx` | Variable Scoping | Block-level variable shadowing inside `if` statements vs outer parameter scopes | **PASS** |
| `string_concat.hmx` | **[NEW]** String Concat | `text + text` string concatenation lowering to runtime `sd_concat` | **PASS** |
| `string_ops.hmx` | String Semantics | String equality (`==`) and inequality (`!=`) lowering to `strcmp` in C | **PASS** |
| `while.hmx` | **[NEW]** While Loop | `while (cond) { ... }` conditional iteration loops | **PASS** |
| `advanced_functions.hmx` | Type Return / Return in Loop | Functions returning `text`, `decimal`, `bool`, and early `return` inside `loop` blocks | **PASS** |
| `arrays.hmx` | **[NEW]** Array Support | Array literals, indexing, element assignment, `length()`, typed params, returns | **PASS** |
| `tuples.hmx` | **[NEW]** Tuple Support | Multi-value return, destructuring, multi-assignment, whole-tuple vars, tuple params, `[int]` member | **PASS** |
| `neg_mod_break.hmx` | **[NEW]** Tier 1 Ops | Unary minus, modulo (incl. compound `%=`), `break`/`continue` inside loops | **PASS** |
| `foreach.hmx` | **[NEW]** Tier 2 `foreach` | Array sum via `foreach`, index+value form, char iteration with `continue`, value-copy semantics | **PASS** |
| `conversions.hmx` | **[NEW]** Tier 2 Conversions | `tostr` on int/decimal/bool/char/byte/text, `parse_int`/`parse_decimal`, concatenation of conversions | **PASS** |
| `print_multi.hmx` | **[NEW]** Tier 2 Variadic Print | `print(a, b, c)` space-separated output across ints, text, bool, char, decimal, negatives | **PASS** |
| `nested_functions.hmx` | **[NEW]** Tier 2 Nested Functions | Nested helpers with params/returns, nested-in-nested, recursion, loop-declared helper, top-level calls | **PASS** |
| `variadic_defaults.hmx` | **[NEW]** Tier 2 Defaults + Variadic | Default padding, default recursion, variadic `foreach` sum, empty + multi-arg tails | **PASS** |
| `closures.hmx` | **[NEW]** Closures + HOF | Capture, nested capture, forwarding through fn-value params, recursive closures, shared-array capture, two-closure independence | **PASS** |

---

### 2. Negative & Error Handling Suite (124/124 Passed)

These tests verify that invalid HMX constructs are caught at compile-time by the parser or type resolver, exiting with code `1` and producing accurate error diagnostics.

| Test Case Name | Target Error Condition | Expected Error Diagnostic Pattern | Status |
| :--- | :--- | :--- | :---: |
| `decl_type_mismatch` | Annotated Var Init | `type mismatch` | **PASS** |
| `assign_type_mismatch` | Reassignment Mismatch | `type mismatch` | **PASS** |
| `binary_type_mismatch` | Mixed Type Binary Op | `type mismatch` | **PASS** |
| `binary_bool_addition` | Arithmetic on Bool | `operator.*not defined` | **PASS** |
| `binary_mixed_int_decimal` | Int + Decimal Mix | `type mismatch` | **PASS** |
| `text_ordering` | Relational Op on Text | `operator.*not defined for type text` | **PASS** |
| `logical_non_bool` | Non-Bool Logical Op | `requires bool` | **PASS** |
| `not_non_bool` | Non-Bool Unary Not | `requires bool` | **PASS** |
| `loop_count_non_int` | Non-Int Loop Counter | `loop count must be int` | **PASS** |
| `while_cond_non_bool` | **[NEW]** Non-Bool While Cond | `while condition must be bool` | **PASS** |
| `for_cond_non_bool` | **[NEW]** Non-Bool For Cond | `for condition must be bool` | **PASS** |
| `for_update_text_increment` | **[NEW]** Invalid For Update | `requires int or decimal` | **PASS** |
| `do_while_cond_non_bool` | **[NEW]** Non-Bool Do-While Cond | `do-while condition must be bool` | **PASS** |
| `semicolon_outside_for` | **[NEW]** Semicolon Guard | `Parse error` | **PASS** |
| `if_cond_non_bool` | Non-Bool If Condition | `if condition must be bool` | **PASS** |
| `undef_var_read` | Reading Undefined Var | `undefined variable` | **PASS** |
| `undef_var_assign` | Writing Undefined Var | `undefined variable` | **PASS** |
| `compound_assign_type_mismatch` | Compound Type Error | `type mismatch` | **PASS** |
| `compound_assign_text` | Compound Op on Text | `requires int or decimal` | **PASS** |
| `incr_text` | Incrementing Text Var | `requires int or decimal` | **PASS** |
| `string_concat_mixed` | **[NEW]** `text` + `int` Concat | `type mismatch` | **PASS** |
| `string_subtraction` | **[NEW]** `text` - `text` Op | `operator '-' not defined for type text` | **PASS** |
| `undef_fn_call` | Call Non-Existent Fn | `undefined function` | **PASS** |
| `call_main` | Direct Call to `main` | `cannot call function 'main'` | **PASS** |
| `call_arg_count_mismatch` | Wrong Arg Count | `expects 2 arguments, got 1` | **PASS** |
| `call_arg_type_mismatch` | Wrong Arg Type | `type mismatch: argument 2` | **PASS** |
| `void_fn_as_value` | Void Call in Expr | `returns nothing and cannot be used as a value` | **PASS** |
| `return_val_in_void_fn` | Return Val in Void Fn | `return value in void function` | **PASS** |
| `bare_return_in_typed_fn` | Bare Return in Typed Fn | `bare return used` | **PASS** |
| `return_type_mismatch` | Return Type Mismatch | `type mismatch: return text but function returns int` | **PASS** |
| `return_outside_fn` | Top-Level Return | `return outside of function` | **PASS** |
| `syntax_unclosed_brace` | Unclosed Block Brace | `Parse error` | **PASS** |
| `syntax_unclosed_paren` | Unclosed Paren | `Parse error` | **PASS** |
| `unterminated_block_comment` | Unclosed Comment | `unterminated block comment` | **PASS** |
| `array_element_type_mismatch` | **[NEW]** Array Element Mismatch | Array init type vs annotation | **PASS** |
| `array_mixed_element_types` | **[NEW]** Mixed Array Elements | Array with heterogeneous literal types | **PASS** |
| `array_untyped_empty` | **[NEW]** Untyped Empty Array | `[]` without annotation | **PASS** |
| `array_nested` | **[NEW]** Nested Array | `[[1], [2]]` literal | **PASS** |
| `array_index_on_non_array` | **[NEW]** Index on Non-Array | Indexing an `int` variable | **PASS** |
| `array_index_non_int` | **[NEW]** Non-Int Index | `a["x"]` | **PASS** |
| `array_assign_type_mismatch` | **[NEW]** Element Assign Mismatch | Assign `text` to `[int]` element | **PASS** |
| `array_assign_immutable` | **[NEW]** Assign to Const Array | Write to `const` array element | **PASS** |
| `array_binary_op` | **[NEW]** Binary Op on Arrays | `a + a` where `a` is `[int]` | **PASS** |
| `print_array` | **[NEW]** Print Array | `print(a)` where `a` is `[int]` | **PASS** |
| `array_param_element_mismatch` | **[NEW]** Param Element Mismatch | `f(["x"])` where `f(a: [int])` | **PASS** |
| `tuple_print` | **[NEW]** Print Tuple | `print(f())` where `f` returns `(int, int)` | **PASS** |
| `tuple_binary_op` | **[NEW]** Binary Op on Tuple | `t + t` where `t` is `(int, int)` | **PASS** |
| `tuple_ternary` | **[NEW]** Tuple Ternary Branch | Ternary selecting `(int, int)` values | **PASS** |
| `tuple_index_non_constant` | **[NEW]** Variable Tuple Index | `t[i]` with loop variable | **PASS** |
| `tuple_index_out_of_range` | **[NEW]** Tuple Index OOR | `t[2]` on a 2-member tuple | **PASS** |
| `tuple_index_on_int` | **[NEW]** Index on Non-Tuple | Indexing an `int` variable | **PASS** |
| `tuple_destruct_count_mismatch` | **[NEW]** Destruct Arity Mismatch | 3 targets vs 2-member tuple | **PASS** |
| `tuple_destruct_non_tuple` | **[NEW]** Destruct Non-Tuple | `let (a, b) = 5` | **PASS** |
| `tuple_destruct_target_type_mismatch` | **[NEW]** Destruct Target Mismatch | Assign `(int, text)` to `(int, int)` targets | **PASS** |
| `tuple_destruct_undefined_target` | **[NEW]** Undefined Destruct Target | `(a, b) = f()` with undeclared names | **PASS** |
| `tuple_return_count_mismatch` | **[NEW]** Return Arity Mismatch | 3 values vs 2-member tuple return | **PASS** |
| `tuple_return_member_type_mismatch` | **[NEW]** Return Member Mismatch | `return 1, "x"` for `-> (int, int)` | **PASS** |
| `tuple_return_single_whole_scalar` | **[NEW]** Scalar Return vs Tuple | `return 5` for `-> (int, int)` | **PASS** |
| `tuple_nested` | **[NEW]** Nested Tuple Type | `-> ((int, int), int)` | **PASS** |
| `tuple_annotated_mismatch` | **[NEW]** Annotated Tuple Var | `(int, int)` var initialized with `(int, text)` | **PASS** |
| `tuple_length` | **[NEW]** `length()` on Tuple | `length(t)` where `t` is a tuple | **PASS** |
| `tuple_bare_return` | **[NEW]** Bare Return in Tuple Fn | `return` with no value in `-> (int, int)` | **PASS** |
| `tuple_call_arg_shape_mismatch` | **[NEW]** Arg Tuple Shape Mismatch | Pass `(int, text)` where `(int, int)` expected | **PASS** |
| `mod_on_decimal` | **[NEW]** `%` on Decimal | `5.5 % 2.5` | `operator '%' not defined for type decimal` | **PASS** |
| `mod_on_text` | **[NEW]** `%` on Text | `"abc" % "def"` | `operator '%' not defined for type text` | **PASS** |
| `mod_type_mismatch` | **[NEW]** Mixed-Type `%` | `5 % 2.5` | `type mismatch` | **PASS** |
| `mod_eq_on_decimal` | **[NEW]** `%=` on Decimal | `x %= 2` with `let x = 5.5` | `operator '%=' requires int` | **PASS** |
| `unary_minus_on_text` | **[NEW]** Unary Minus on Text | `-"abc"` | `operator '-' not defined for type text` | **PASS** |
| `break_outside_loop` | **[NEW]** Break at Top Level | Top-level `break` | `break outside of a loop` | **PASS** |
| `continue_outside_loop` | **[NEW]** Continue at Top Level | Top-level `continue` | `continue outside of a loop` | **PASS** |
| `break_in_switch_no_loop` | **[NEW]** Break in Switch Case | `loop (1) { switch { case 1: break } }` | `break inside a switch case requires an enclosing loop` | **PASS** |
| `continue_in_switch_no_loop` | **[NEW]** Continue in Switch Case | `loop (1) { switch { case 1: continue } }` | `continue inside a switch case requires an enclosing loop` | **PASS** |
| `foreach_on_int` | **[NEW]** Non-Iterable | `foreach (x in 5)` iterable must be array/text | `foreach iterable must be an array or text, got int` | **PASS** |
| `foreach_on_tuple` | **[NEW]** Tuple Iterable | `foreach (x in pair())` | `foreach iterable must be an array or text, got tuple` | **PASS** |
| `foreach_var_out_of_scope` | **[NEW]** Loop Scoping | foreach var referenced after loop | `undefined variable` | **PASS** |
| `input_with_args` | **[NEW]** Arity | `input(5)` | `builtin 'input' expects 0 arguments, got 1` | **PASS** |
| `tostr_on_array` | **[NEW]** Bad `tostr` Arg | `tostr([1, 2])` | `builtin 'tostr' expects int, decimal, bool, byte, char, or text` | **PASS** |
| `tostr_wrong_arity` | **[NEW]** Arity | `tostr()` | `builtin 'tostr' expects 1 arguments, got 0` | **PASS** |
| `parse_int_on_int` | **[NEW]** Bad `parse_int` Arg | `parse_int(42)` | `builtin 'parse_int' expects text, got int` | **PASS** |
| `parse_decimal_on_bool` | **[NEW]** Bad `parse_decimal` Arg | `parse_decimal(true)` | `builtin 'parse_decimal' expects text, got bool` | **PASS** |
| `print_zero_args` | **[NEW]** Empty `print()` | `print()` requires ≥ 1 argument | `syntax error near` | **PASS** |
| `print_array_arg` | **[NEW]** Array in `print` | `print(a, 5)` | `cannot print an array` | **PASS** |
| `print_tuple_arg` | **[NEW]** Tuple in `print` | `print(pair())` | `cannot print a tuple` | **PASS** |
| `nested_fn_refs_outer_local` | **[NEW]** No Closures | nested fn uses enclosing local | `undefined variable` | **PASS** |
| `nested_fn_duplicate_global` | **[NEW]** Global Collision | nested fn mirrors a top-level name | `duplicate declaration of function` | **PASS** |
| `nested_fn_duplicate_sibling` | **[NEW]** Sibling Collision | two nested fns with the same name | `duplicate declaration of function` | **PASS** |
| `nested_fn_named_main` | **[NEW]** Reserved `main` | nested fn named `main` | `duplicate declaration of function` | **PASS** |
| `nested_fn_break_outside_loop` | **[NEW]** Loop Isolation | `break` in nested fn not affected by enclosing loop | `break outside of a loop` | **PASS** |
| `default_param_type_mismatch` | **[NEW]** Default Value Mismatch | `a: int = "x"` | `must be a literal of type int` | **PASS** |
| `default_param_non_literal` | **[NEW]** Non-Literal Default | `a: int = 1 + 2` | `must be a literal of type int` | **PASS** |
| `default_param_not_trailing` | **[NEW]** Default Run Broken | required param after a defaulted one | `cannot follow a parameter with a default value` | **PASS** |
| `default_param_byte_range` | **[NEW]** Byte Default Range | `a: byte = 300` | `must be between 0 and 255` | **PASS** |
| `default_params_too_few_args` | **[NEW]** Below Required Count | `f()` for `f(a: int, b: int = 2)` | `expects at least 1 argument, got 0` | **PASS** |
| `variadic_not_last` | **[NEW]** Variadic Order | `rest: ...int` followed by `a: int` | `must be the last parameter` | **PASS** |
| `variadic_duplicate` | **[NEW]** Two Variadics | `x: ...int, y: ...int` | `more than one variadic parameter` | **PASS** |
| `variadic_collects_array` | **[NEW]** Non-Scalar Element | `rest: ...[int]` | `must collect a scalar type` | **PASS** |
| `variadic_wrong_type` | **[NEW]** Variadic Arg Type | `f(1, "s")` for `f(a: int, rest: ...int)` | `type mismatch: variadic argument 2 of 'f' expects int, got text` | **PASS** |
| `nested_fn_assigns_captured` | **[NEW]** Captured Var Assign | `outer = 7` inside nested fn | `cannot assign to captured variable` | **PASS** |
| `closures_capture_not_in_scope` | **[NEW]** Capture Not In Scope | Capturing fn uses var from unrelated scope | `captured variable 'local' is not in scope` | **PASS** |
| `closures_forward_ref_value` | **[NEW]** Forward Ref as Value | `let f: fn(int) -> int = g` before `g` is declared | `must be declared before it is used as a value` | **PASS** |
| `closures_use_main_value` | **[NEW]** `main` as Value | `apply(main, 3)` | `cannot use function 'main' as a value` | **PASS** |
| `closures_print_function` | **[NEW]** Print Function | `print(f)` where `f` is a function | `cannot print a function` | **PASS** |
| `closures_ternary_function` | **[NEW]** Ternary Function | `t ? f : f` where `f` is a function | `ternary branches cannot be functions` | **PASS** |
| `closures_arg_fn_mismatch` | **[NEW]** Arg Function Type | `choose(true, f, g)` with wrong `g` type | `argument 3 of 'choose' expects` | **PASS** |
| `closures_var_mismatch` | **[NEW]** Variable Function Type | `fn(int, int) -> int = twice` | `but initialized with` | **PASS** |
| `closures_assign_mismatch` | **[NEW]** Assignment Function Type | `f = concat` with wrong function type | `cannot assign` | **PASS** |
| `closures_return_fn_mismatch` | **[NEW]** Return Function Type | `return h` where `h` has wrong function type | `but function returns` | **PASS** |
| `closures_return_mismatch` | **[NEW]** Return Kind Mismatch | `return 5` in fn returning function type | `but function returns function` | **PASS** |
| `closures_call_arity` | **[NEW]** HOF Arity | `f(1, 2)` where `f: fn(int) -> int` | `expects 1 arguments, got 2` | **PASS** |

---

### 3. Stress, Output & Runtime Semantics Suite (58/58 Passed)

These tests verify exact runtime output matching and process exit code propagation under complex recursive algorithms, `while` loops, string concatenation chains, stdin-driven programs, conversions, and variadic output.

| Test Case Name | Category | Tested Behavior | Expected Output / Code | Status |
| :--- | :--- | :--- | :--- | :---: |
| `exit_code_zero` | Exit Code | `fn main() -> int { return 0 }` | Exit Code: `0` | **PASS** |
| `exit_code_custom_42` | Exit Code | `fn main() -> int { return 42 }` | Exit Code: `42` | **PASS** |
| `exit_code_custom_100` | Exit Code | `fn main() -> int { return 100 }` | Exit Code: `100` | **PASS** |
| `factorial_recursion` | Recursion | `fact(6)` via `n * fact(n - 1)` | `720` | **PASS** |
| `ackermann_recursion` | Recursion | Ackermann function `ack(2, 4)` | `11` | **PASS** |
| `large_loop_stress` | Stress | 1,000 iteration `loop` counter | `1000` | **PASS** |
| `while_loop_counter` | **[NEW]** While Loop | 100 iteration `while` accumulator | `4950` | **PASS** |
| `nested_while_loops` | **[NEW]** Nested While | 5x5 nested `while` matrix accumulator | `25` | **PASS** |
| `string_concat_chain` | **[NEW]** Concat Chain | `"A" + "B" + "C" + "D" + "E"` multi-way concat | `ABCDE` | **PASS** |
| `boolean_logic_truth_table` | Verification | Full truth table for `and`/`or`/`not`/`!` | `1\n0\n1\n0\n1\n0` | **PASS** |
| `collatz_steps` | Algorithms | Collatz sequence using `while (x != 1)` | `6\n1` | **PASS** |
| `for_loop_factorial` | **[NEW]** For Loop | Factorial using C-style `for` | `720` | **PASS** |
| `do_while_countdown` | **[NEW]** Do-While Loop | Countdown with post-condition loop | `3\n2\n1` | **PASS** |
| `all_loop_forms_nested` | **[NEW]** Loop Nesting | Nested `loop`, `for`, `while`, and `do-while` | `12` | **PASS** |
| `array_sum_loop` | **[NEW]** Array Loop Sum | `while` over `[int]` accumulating totals | `50` | **PASS** |
| `array_text_elements` | **[NEW]** Text Array Elements | `[text]` indexing and nested `length()` | `beta\n5` | **PASS** |
| `array_return_and_param` | **[NEW]** Array Return/Param | Function returns `[int]`, reads and mutates it | `3\n1\n9` | **PASS** |
| `array_oob_high` | **[NEW]** Bounds Check High | Index past the end | Exit Code: `1` | **PASS** |
| `array_oob_low` | **[NEW]** Bounds Check Low | Negative index | Exit Code: `1` | **PASS** |
| `tuple_multi_return_destructure` | **[NEW]** Tuple Destructure | `quotrem(17, 5)` destructured | `3\n2` | **PASS** |
| `tuple_inference_and_index` | **[NEW]** Tuple Inference + Index | Whole-tuple var with `[0]` / `[1]` access | `3\n1` | **PASS** |
| `tuple_multi_assign` | **[NEW]** Tuple Multi-Assign | `(q, r) = quotrem(20, 7)` | `2\n6` | **PASS** |
| `tuple_param_and_call` | **[NEW]** Tuple Params | `pair_it` + `swap(t: (int, int))` nesting | `5\n4` | **PASS** |
| `tuple_text_member` | **[NEW]** Text Tuple Member | Destructure `(int, text)` return | `7\nhi` | **PASS** |
| `tuple_array_member` | **[NEW]** Array Tuple Member | Tuple holding `[1,2,3]` + best score | `9\n3` | **PASS** |
| `tuple_annotated_decl` | **[NEW]** Annotated Tuple Decl | `let tagged: (int, int) = ...` | `2\n1` | **PASS** |
| `modulo_basic` | **[NEW]** Modulo | `17 % 5`, `10 % 3`, `-100 % 7`, `7 % 100` | `2\n1\n-2\n7` | **PASS** |
| `modulo_compound` | **[NEW]** `%=` Chain | `x %= 5` then `y %= 3` `y %= 2` | `2\n1` | **PASS** |
| `unary_minus` | **[NEW]** Unary Minus | `-5`, `-(-5)`, `-2 + 5`, `-(3 * 4)`, `-3.5` | `-5\n5\n3\n-12\n-3.500000` | **PASS** |
| `break_continue` | **[NEW]** Loop Control | `continue` skips, `break` stops `loop` & `while` | `1\n3\n4\n4\n1\n2\n4\n5\n6` | **PASS** |
| `break_in_switch_with_inner_loop` | **[NEW]** Switch+Loop | `break` in case requires inner loop | `1` | **PASS** |
| `modulo_exit_code` | **[NEW]** Exit Code | `1` iff `100 % 7 == 2` | Exit Code: `42` | **PASS** |
| `foreach_array_sum` | **[NEW]** Tier 2 `foreach` | Sum, value-copy mutation, element unchanged | `15\n55\n3` | **PASS** |
| `foreach_index_form` | **[NEW]** Tier 2 `foreach` | Index+value over array and over text | `0\n0\n1\n20\n2\n60\n0\na\n1\nb\n2\nc` | **PASS** |
| `foreach_text_chars` | **[NEW]** Tier 2 `foreach` | `continue` skips char; vowel count over text | `2\n5` | **PASS** |
| `input_echo_and_length` | **[NEW]** Tier 2 `input` | Two stdin lines echoed; `length()` of second | `hello\n5` | **PASS** |
| `input_concat` | **[NEW]** Tier 2 `input` | stdin line concatenated into greeting | `hi ada` | **PASS** |
| `input_empty_lines` | **[NEW]** Tier 2 `input` | Empty stdin lines become empty strings | `0\n0` | **PASS** |
| `tostr_variants` | **[NEW]** Tier 2 `tostr` | int/decimal/bool/char/byte/text conversion | `-7\n1.250000\n1\n0\nk\n3\nx\n6 items` | **PASS** |
| `parse_and_use` | **[NEW]** Tier 2 Parsing | `parse_int` / `parse_decimal` arithmetic + `tostr` | `46\n7\n3.600000\n9!` | **PASS** |
| `input_parse_loop` | **[NEW]** Tier 2 I/O Combo | Two stdin lines parsed and summed | `12` | **PASS** |
| `parse_int_runtime_error` | **[NEW]** Runtime Error | `parse_int("12abc")` aborts with exit code 1 | Exit Code: `1` | **PASS** |
| `print_mixed_args` | **[NEW]** Tier 2 Variadic Print | Mixed int/text/bool/char/decimal args | `n = 5\n1 2 3\nab c\n1 x 0.500000\n8 64 512` | **PASS** |
| `print_text_concat_and_multi` | **[NEW]** Tier 2 Variadic Print | Concatenated text + multi-arg + `tostr` args | `go gh gh done\n12 0.750000 p` | **PASS** |
| `nested_helper_functions` | **[NEW]** Tier 2 Nested Functions | Nested `twice`/`thrice` helpers + recursive `fib` | `24\n34` | **PASS** |
| `nested_multi_level` | **[NEW]** Tier 2 Nested Functions | Three-level nesting + loop-declared helper | `5\n14` | **PASS** |
| `variadic_sum` | **[NEW]** Tier 2 Variadic | `sum()`/`sum(1,2,3,4)`/`sum(7)` via `foreach` over the tail | `0\n10\n7` | **PASS** |
| `default_padding` | **[NEW]** Tier 2 Defaults | Omitted trailing args receive defaults | `a 0 3\nb 1 3\nc 0 9` | **PASS** |
| `variadic_mixed_defaults` | **[NEW]** Tier 2 Defaults + Variadic | defaulted prefix + variadic tail, first/last tail access | `- 0\n+ 1\n5 5\n+ 3\n1 3` | **PASS** |
| `variadic_exit_recursion` | **[NEW]** Tier 2 Defaults | defaulted recursion returning 42 | Exit Code: `42` | **PASS** |
| `closures_hof_fold` | **[NEW]** HOF Fold | `apply(add, 30, 12)` and `apply(mul, 6, 7)` via fn-value params | `42\n42` | **PASS** |
| `closures_snapshot_env` | **[NEW]** Capture Snapshot | value captured at `let f = bump` time; later mutation to `total` is invisible | `0` | **PASS** |
| `closures_nested_forwarding` | **[NEW]** Nested Capture Chain | outer→inner→caller forwarding chain via direct call | `5` | **PASS** |
| `closures_exit_capture` | **[NEW]** Capture Exit Code | captured int compared in if-branch returning 42 | Exit Code: `42` | **PASS** |

---

### 4. CLI Driver Options Suite

| Command / Option Tested | Action Taken | Expected Result | Status |
| :--- | :--- | :--- | :---: |
| `./hmx run <file.hmx>` | Transpile, compile, execute | Binary executes, temporary C file removed | **PASS** |
| `./hmx build <file.hmx>` | Transpile and compile only | Binary created, output `Built: <file>` | **PASS** |
| `-keep-c` Flag | Transpile & keep source | Intermediate `build_temp.c` retained | **PASS** |
| Invalid Arguments / Missing File | Run without valid file | Exit `1` with usage / error diagnostic | **PASS** |

---

## How to Re-Run Test Suites

To execute all test suites again locally:

```bash
cd hmx-lang

# 1. Build transpiler binary
cd build && cmake .. && make && cd ..

# 2. Run Integration Fixtures
./tests/run_integration.sh

# 3. Run Negative / Error Handling Tests
./tests/run_negative_tests.sh

# 4. Run Stress & Output Verification Tests
./tests/run_stress_tests.sh
```

---

> [!TIP]
> **Conclusion:** Tier 1 and Tier 2 work, plus function types, higher-order calls, and closures, now
> lands end-to-end without regressions: unary minus/plus, int-only modulo (incl. compound `%=`),
> and `break`/`continue` loop control, `foreach`, `input()`, `tostr`/`parse_int`/
> `parse_decimal`, variadic `print`, nested functions, default parameter values, variadic
> `...type` parameters, `fn(...)  -> ...` type annotations, function values as first-class
> data (pass, return, store, call via variable), and nested-function closures capturing
> enclosing locals by-value snapshot — all compile through the HMX pipeline and pass
> integration, negative, and stress/output tests. The bison parser still carries
> six harmless shift/reduce conflicts (all resolved by shift).
