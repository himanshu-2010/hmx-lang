# HMX Transpiler — Test Execution Report

**Date:** 2026-09-25  
**Target Project:** HMX Transpiler (the `hmx-lang/` directory in this repo)  
**Status:** ALL TESTS PASSED (337 / 337)

---

## Executive Summary

A comprehensive, rigorous re-test was conducted against the HMX transpiler pipeline (Lexer → Parser → Type Resolver → Codegen → GCC) after incorporation of **function types, higher-order calls, closures, non-local exit, cross-file modules, and Unicode identifiers**:
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
12. **Non-local exit**: `break` / `continue` inside a nested function break/continue the nearest loop of the enclosing function (restricted to direct calls from the loop's owner inside the loop).
13. **Modules**: `use "file.hmx"` at the top of a file imports top-level functions from other `.hmx` files (relative paths, cycle detection, dedupe by canonical path, file-tagged diagnostics for imported-module errors).
14. **Unicode identifiers**: any non-ASCII UTF-8 byte is a valid identifier character, emitted verbatim into the generated C.
15. **Nested arrays & chained indexing**: recursive element type descriptors enable `[[int]]` annotations, nested-literal inference, `a[i][j]` reads, `a[i][j] = v` chained assignment, and nested `foreach`; bison conflict count still 6 SR (5 states), all resolved by shift.
16. **Growable arrays (`sd_array*`) + array built-ins**: every array is a heap pointer with spare capacity; `push`/`pop`/`sort` mutate the shared backing in place, `slice`/`concat` build independent copies, `index_of` finds the first match (`-1` if absent), `contains` reports membership; immutable/captured arrays reject mutation, void built-ins reject value use, and `pop` on empty / out-of-range `slice` terminate at runtime with exit code 1.
17. **Byte-level text ops**: `text[i]` read-indexing yields a `char` (runtime bounds-checked via `strlen`; assignment to a text character rejected at compile time), `ord(char)` → `int`, `chr(int)` → `char` (runtime `0..255` check, exit 1), and `split(text, sep)` → `[text]` preserving empty pieces (empty separator aborts with exit code 1).
18. **Array/text destructuring with `...rest`**: `let (a, b, ...rest) = expr` and the multi-assign form bind the first `N` elements (arrays / text characters) with a runtime `length ≥ N` check; `...rest` captures the remainder as a new `[elem]` array or `text` substring; tuples still require an exact match and reject `...rest`.
19. **Nested destructuring patterns**: any destructuring slot may itself be a parenthesized list — deep tuple nesting (`(((a,b),c),d)`), arrays of tuples (`[(int,int)]` with `((p,q), second)`), rest inside a nested array group (`((x, y, ...zs), row)`), and nested patterns over text elements (`(w0, (c1, c2))`) all type-check and lower correctly; nested tuple types and arrays of tuples were lifted from "not supported".
20. **Nested tuple type support**: `((int, int), int)` annotations and `[(int, int)]` arrays now work via structural tuple typedef names, dependency-ordered struct emission, and recursive deep registration of tuple types.
21. **Dynamic tuple indexing**: `t[i]` with a runtime `int` index works when every tuple member has the same type (the result has that type); the index is bounds-checked at runtime (`sd_check_tuple_index`, exit code 1 on out of range). Constant `t[0]` indexing is unchanged, heterogeneous tuples with a non-constant index are a compile error, and non-`int` indexes are rejected.
22. **Currying**: anonymous **lambda expressions** (`lambda(x: int) -> int { ... }`, plus zero-arg and void variants, with the full `fn` parameter syntax incl. defaults/variadic) and **partial application** — calling a named function or function value with `1 <= args < arity` (no defaults, no variadic) returns a closure over the prefix arguments that waits for the rest. Both combine: lambdas capture enclosing scopes by snapshot, partials compose/chain via higher-order calls, and everything lower through the existing closure machinery.

> [!IMPORTANT]
> **Summary Statistics:**
> - **Total Test Cases Executed:** 337
> - **Passed:** 337
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

### 1. Integration Fixtures (51/51 Passed)

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
| `nonlocal_exit.hmx` | **[NEW]** Non-local Exit | `break` from nested fn in `loop`, `while`, and `do-while`; `continue` from nested fn in `foreach` and `for` | **PASS** |
| `unicode_identifiers.hmx` | **[NEW]** Unicode Identifiers | Unicode fn names/params/locals (`añadir`, `日本語`, `número`, `çàñ`) lex, resolve, and emit verbatim | **PASS** |
| `mod_basic` | **[NEW]** Modules | Entry `use`s `lib/math.hmx`; calls imported `sum`/`twice` cross-file | **PASS** |
| `mod_chain` | **[NEW]** Module Chain | `a.hmx` itself `use`s `b.hmx`; entry `use`s `a.hmx` (transitive load) | **PASS** |
| `mod_closures` | **[NEW]** Module Closures | Imported fn returns a closure (`make_adder`) called from entry | **PASS** |
| `mod_nonlocal` | **[NEW]** Module Non-local | Imported fn uses non-local `break` from a nested fn | **PASS** |
| `mod_unicode` | **[NEW]** Module Unicode | Unicode identifiers (`ö`, `saludar`) inside an imported module | **PASS** |
| `nested_arrays.hmx` | **[NEW]** Nested Arrays | `[[int]]` annotation, nested inference, `a[i][j]` reads, chained assignment, nested `foreach`, array-of-arrays from array vars | **PASS** |
| `array_builtins.hmx` | **[NEW]** Growable Arrays | `push`/`pop`/`sort`/`slice`/`concat`/`index_of`/`contains` on int and text arrays; `push`/`pop` of whole rows on `[[int]]` | **PASS** |
| `text_ops.hmx` | **[NEW]** Text Ops | `text[i]` indexing, char-of-text chains (`names[1][0]`), `ord`/`chr`, `split` with preserved empty pieces, `index_of` on split results | **PASS** |
| `destructure_rest.hmx` | **[NEW]** Destructure `...rest` | Array `(x, y, ...rest)`, text `(c1, c2, ...cs)`, extra elements ignored, nested `[[int]]` rows, rest from `split` and `grid[i]`, single-element rest-is-empty | **PASS** |
| `destructure_nested.hmx` | **[NEW]** Nested Destructure | Deep tuple nesting, array of tuples with group+rest, rest inside a nested array group, nested patterns on text elements, nested multi-assign | **PASS** |
| `tuple_dynamic_index.hmx` | **[NEW]** Dynamic Tuple Index | Variable/expression indexes on homogeneous tuples, chained array-of-homogeneous-tuples, nested homogeneous tuples feeding destructuring, closure capture | **PASS** |
| `currying.hmx` | **[NEW]** Currying | Named/value partials in HOFs, lambda capture across an enclosing fn, lambda-returning-lambda, direct lambda argument, void lambda | **PASS** |

---

### 2. Negative & Error Handling Suite (182/182 Passed)

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
| `call_arg_count_mismatch` | Wrong Arg Count | `expects 2 arguments, got 3` | **PASS** |
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
| `array_nested_mismatch` | **[NEW]** Nested Array Annotation Mismatch | `[int] = [[1], [2]]` now rejects with the typed message | **PASS** |
| `array_nested_element_mismatch` | **[NEW]** Nested Heterogeneous Rows | `[[int]] = [[1], ["x"]]` element-type mismatch | **PASS** |
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
| `tuple_index_dynamic_hetero` | **[NEW]** Dynamic Index on Hetero Tuple | `t[i]` where `t: (int, text)` | `tuple members must all be of the same type` | **PASS** |
| `tuple_index_dynamic_nested_hetero` | **[NEW]** Dynamic Index on Nested Hetero | `t[i]` where `t: ((int, int), text)` | `tuple members must all be of the same type` | **PASS** |
| `tuple_index_dynamic_non_int` | **[NEW]** Non-Int Dynamic Index | `t[s]` with `s: text` on a homogeneous tuple | `tuple index must be int, got text` | **PASS** |
| `tuple_index_out_of_range` | **[NEW]** Tuple Index OOR | `t[2]` on a 2-member tuple | **PASS** |
| `tuple_index_on_int` | **[NEW]** Index on Non-Tuple | Indexing an `int` variable | **PASS** |
| `tuple_destruct_count_mismatch` | **[NEW]** Destruct Arity Mismatch | 3 targets vs 2-member tuple | **PASS** |
| `tuple_destruct_non_tuple` | **[NEW]** Destruct Non-Tuple | `let (a, b) = 5` | `right side of destructuring must be a tuple, array, or text, got int` | **PASS** |
| `tuple_destruct_target_type_mismatch` | **[NEW]** Destruct Target Mismatch | Assign `(int, text)` to `(int, int)` targets | **PASS** |
| `tuple_destruct_undefined_target` | **[NEW]** Undefined Destruct Target | `(a, b) = f()` with undeclared names | **PASS** |
| `tuple_return_count_mismatch` | **[NEW]** Return Arity Mismatch | 3 values vs 2-member tuple return | **PASS** |
| `tuple_return_member_type_mismatch` | **[NEW]** Return Member Mismatch | `return 1, "x"` for `-> (int, int)` | **PASS** |
| `tuple_return_single_whole_scalar` | **[NEW]** Scalar Return vs Tuple | `return 5` for `-> (int, int)` | **PASS** |
| `tuple_nested_pattern_on_char` | **[NEW]** Nested Pattern on Char | Nested slot inside a text destructure | `cannot destructure a character into a nested pattern` | **PASS** |
| `tuple_nested_pattern_on_scalar_elem` | **[NEW]** Nested Pattern on Scalar | `((x, y), z) = a` where `a: [int]` | `cannot destructure a value of type int into a nested pattern` | **PASS** |
| `tuple_nested_count_mismatch` | **[NEW]** Nested Count Mismatch | inner `(a, b)` vs `(int, int, int)` member | `cannot destructure tuple of 3 members into 2 variables` | **PASS** |
| `tuple_nested_rest_in_group` | **[NEW]** Rest Inside Tuple Group | `((a, ...r), b) = f()` | `cannot use '...rest' when destructuring a tuple` | **PASS** |
| `destruct_rest_not_last_array` | **[NEW]** Rest Not Last | `(...r, x) = a` on `[int]` | `cannot use '...rest' before another destructuring target` | **PASS** |
| `destruct_rest_not_last_text` | **[NEW]** Rest Not Last | `(...r, x) = "hello"` | `cannot use '...rest' before another destructuring target` | **PASS** |
| `tuple_nested_multiassign_undefined` | **[NEW]** Nested Multi-Assign Undefined | `((one, two), three) = ...` with undeclared `two` | `undefined variable 'two'` | **PASS** |
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
| `nested_fn_break_outside_loop` | **[NEW]** Loop Isolation | `break` in nested fn declared outside any loop | `break outside of a loop` | **PASS** |
| `nl_reject_call_outside_loop` | **[NEW]** Non-local Exits | breaker called after its target loop ends | `target loop is not active here` | **PASS** |
| `nl_reject_call_from_other_fn` | **[NEW]** Non-local Exits | breaker called from a different function | `target loop is not active here` | **PASS** |
| `nl_reject_forwarded_via_wrapper` | **[NEW]** Non-local Exits | breaker invoked from a wrapper nested fn | `target loop is not active here` | **PASS** |
| `nl_reject_cross_loop_call` | **[NEW]** Non-local Exits | breaker of loop A called inside loop B | `target loop is not active here` | **PASS** |
| `nl_reject_token_as_value` | **[NEW]** Non-local Exits | breaker assigned to a variable | `cannot use function 'bail' as a value` | **PASS** |
| `nl_reject_token_as_arg` | **[NEW]** Non-local Exits | breaker passed as a higher-order argument | `function 'bail'` | **PASS** |
| `nl_continue_outside_loop` | **[NEW]** Non-local Exits | `continue` in nested fn with no loop anywhere | `continue outside of a loop` | **PASS** |
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
| `curry_prefix_arg_mismatch` | **[NEW]** Partial Prefix Type | `add("one")` for `add(a: int, b: int)` | `type mismatch: argument 1 of 'add' expects int, got text` | **PASS** |
| `curry_zero_args_value` | **[NEW]** Zero Args on Fn Value | `f()` where `f` is a 2-arg fn value | `expects 2 arguments, got 0` | **PASS** |
| `curry_too_many_remaining` | **[NEW]** Partial Remaining Overshoot | `f(2, 3, 4)` on `add(1)` of a 3-arg fn | `expects 2 arguments, got 3` | **PASS** |
| `curry_multi_partial_chain_type` | **[NEW]** Partial Result Type | `fn(int) -> int = add(1)` where `add` takes 3 args | `declared as fn(int) -> int but initialized with fn(int, int) -> int` | **PASS** |
| `lambda_void_value_position` | **[NEW]** Void Lambda as Value | `print(v())` where `v` is a void lambda | `returns nothing and cannot be used as a value` | **PASS** |
| `lambda_missing_return` | **[NEW]** Lambda Missing Return | `lambda(x: int) -> int` body without `return` | `lambda may exit without returning int` | **PASS** |
| `lambda_default_value_type` | **[NEW]** Bad Lambda Default | `lambda(x: int = "nope") -> int` | `default value for parameter 'x' of lambda must be a literal of type int` | **PASS** |
| `use_missing_file` | **[NEW]** Module Missing | `use "lib/nope.hmx"` (nonexistent) | `cannot open module` | **PASS** |
| `use_non_hmx` | **[NEW]** Non-`.hmx` Module | `use "lib/math.txt"` | `must be a .hmx file` | **PASS** |
| `use_cycle` | **[NEW]** Module Cycle | `c1.hmx` ↔ `c2.hmx` mutual `use` | `circular module dependency` | **PASS** |
| `use_cycle_to_entry` | **[NEW]** Module→Entry Cycle | module `use`s the entry file | `circular module dependency` | **PASS** |
| `use_not_at_top` | **[NEW]** Late `use` | `use` statement after declarations | `Parse error` | **PASS** |
| `use_dup_function` | **[NEW]** Cross-Module Dup | two modules both declare `fa` | `duplicate declaration of function` | **PASS** |
| `use_module_type_error` | **[NEW]** Module Type Error | type error inside imported `err.hmx` | `Error \[.*err\.hmx:4\]` | **PASS** |
| `use_module_parse_error` | **[NEW]** Module Parse Error | syntactically broken module | `parsing failed in module` | **PASS** |
| `use_reserved_keyword` | **[NEW]** Reserved `use` | `let use = 5` | `Parse error` | **PASS** |
| `array_builtin_push_non_array` | **[NEW]** Push Non-Array | `push(3, 1)` | `builtin 'push' expects an array as argument 1` | **PASS** |
| `array_builtin_push_type_mismatch` | **[NEW]** Push Element Mismatch | `push(a, "x")` on `[int]` | `cannot push text to array of int` | **PASS** |
| `array_builtin_push_immutable` | **[NEW]** Push Const Array | `push` on `const` array | `cannot modify immutable array` | **PASS** |
| `array_builtin_push_as_value` | **[NEW]** Void Builtin as Value | `let x = push(a, 2)` | `returns nothing and cannot be used as a value` | **PASS** |
| `array_builtin_sort_bool` | **[NEW]** Sort Unsupported Elem | `sort` on `[bool]` | `requires an array of int, decimal, byte, char, or text` | **PASS** |
| `array_builtin_slice_non_int` | **[NEW]** Slice Non-Int Index | `slice(a, 0, "x")` | `builtin 'slice' expects int indexes` | **PASS** |
| `array_builtin_concat_mismatch` | **[NEW]** Concat Element Mismatch | `concat([1], ["x"])` | `cannot concatenate array of text with array of int` | **PASS** |
| `array_builtin_index_of_type_mismatch` | **[NEW]** `index_of` Value Mismatch | `index_of(["a"], 2)` | `index_of value of int does not match array of text` | **PASS** |
| `array_builtin_index_of_nested` | **[NEW]** `index_of` Nested Elem | `index_of([[1]], [1])` | `requires an array of scalar or text elements` | **PASS** |
| `array_builtin_pop_on_const` | **[NEW]** Pop Const Array | `pop(a)` on `const` array | `cannot modify immutable array` | **PASS** |
| `text_index_assign` | **[NEW]** Text Char Assign | `s[0] = 'x'` on `text` | `cannot assign to a character of a text value` | **PASS** |
| `text_index_non_int` | **[NEW]** Non-Int Text Index | `s[1.5]` | `text index must be int, got decimal` | **PASS** |
| `ord_expects_char_int` | **[NEW]** `ord` on Int | `ord(5)` | `builtin 'ord' expects char, got int` | **PASS** |
| `ord_expects_char_text` | **[NEW]** `ord` on Text | `ord("a")` | `builtin 'ord' expects char, got text` | **PASS** |
| `ord_arity` | **[NEW]** `ord` Arity | `ord('a', 'b')` | `builtin 'ord' expects 1 arguments, got 2` | **PASS** |
| `chr_expects_int` | **[NEW]** `chr` on Text | `chr("a")` | `builtin 'chr' expects int, got text` | **PASS** |
| `split_expects_text1` | **[NEW]** `split` Non-Text 1 | `split(3, ",")` | `builtin 'split' expects text as argument 1, got int` | **PASS** |
| `split_expects_text2` | **[NEW]** `split` Non-Text 2 | `split("a", 3)` | `builtin 'split' expects text as argument 2, got int` | **PASS** |
| `split_arity` | **[NEW]** `split` Arity | `split("a")` | `builtin 'split' expects 2 arguments, got 1` | **PASS** |
| `destruct_tuple_rest` | **[NEW]** `...rest` on Tuple | `let (a, ...rest) = f()` | `cannot use '...rest' when destructuring a tuple` | **PASS** |
| `destruct_array_unknown_elem` | **[NEW]** Unknown Elem Array | `let (a, b) = []` | `cannot infer element type for this array destructuring` | **PASS** |
| `destruct_array_multiassign_mismatch` | **[NEW]** Array Multi-Assign Mismatch | `(a, b) = [1, 2]` on text vars | `cannot assign int to text` | **PASS** |
| `destruct_array_rest_target_mismatch` | **[NEW]** Rest Target Mismatch | `(x, ...r) = [1, 2, 3]` with `r: int` | `cannot assign array of int to int` | **PASS** |
| `destruct_array_immutable_target` | **[NEW]** Immutable Target | `(c, a) = [5, 6]` with `const c` | `cannot modify immutable variable 'c'` | **PASS** |
| `destruct_text_multiassign_mismatch` | **[NEW]** Text Multi-Assign Mismatch | `(x, y) = "ab"` on int vars | `cannot assign char to int` | **PASS** |
| `destruct_text_rest_target_mismatch` | **[NEW]** Text Rest Target Mismatch | `(a, ...r) = "hi there"` with `r: [int]` | `cannot assign text to array of int` | **PASS** |

---

### 3. Stress, Output & Runtime Semantics Suite (104/104 Passed)

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
| `tuple_dynamic_index_homogeneous` | **[NEW]** Dynamic Tuple Index | Variable and expression indexes on `(int,int,int)` | `20\n10\n30` | **PASS** |
| `tuple_dynamic_index_loop` | **[NEW]** Dynamic Index Loop | Homogeneous tuple walked with a `for` header index | `4\n5\n6` | **PASS** |
| `tuple_dynamic_index_oob` | **[NEW]** Runtime Error | Runtime index at/over member count aborts | Exit Code: `1` | **PASS** |
| `tuple_dynamic_index_negative` | **[NEW]** Runtime Error | Negative runtime index aborts | Exit Code: `1` | **PASS** |
| `tuple_dynamic_index_chained` | **[NEW]** Chained Dynamic Index | `grid[i][j]` on `[(int,int)]` with dynamic row and column | `2\n20` | **PASS** |
| `tuple_dynamic_index_nested_tuple` | **[NEW]** Nested Homogeneous Tuple | `t[i][j]` on `((int,int),(int,int))` | `1\n2\n6` | **PASS** |
| `tuple_dynamic_index_destructure` | **[NEW]** Dynamic Index + Destructure | `let (x, y) = t[i]` | `5 6` | **PASS** |
| `tuple_dynamic_index_capture` | **[NEW]** Captured Tuple Index | `t[i]` inside a closure over a captured tuple | `1` | **PASS** |
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
| `nonlocal_break_loop` | **[NEW]** Non-local Exit | nested-fn `break` ends a `loop` at iteration 2 | `2` | **PASS** |
| `nonlocal_continue_for` | **[NEW]** Non-local Exit | nested-fn `continue` skips one `for` iteration | `9` | **PASS** |
| `nonlocal_continue_foreach` | **[NEW]** Non-local Exit | nested-fn `continue` skips one `foreach` iteration | `3` | **PASS** |
| `nonlocal_break_while` | **[NEW]** Non-local Exit | nested-fn `break` ends a `while` at 7 | `7` | **PASS** |
| `nonlocal_break_dowhile` | **[NEW]** Non-local Exit | nested-fn `break` ends a `do-while` at 4 | `4` | **PASS** |
| `nonlocal_nested_targets` | **[NEW]** Non-local Exit | inner-fn `continue` + outer-fn `break` in one function | `inner 100\ninner 100\nafter 2` | **PASS** |
| `nonlocal_non_main_owner` | **[NEW]** Non-local Exit | breaker owned by a non-main function | `iter\nafter` | **PASS** |
| `unicode_identifiers` | **[NEW]** Unicode Identifiers | Unicode fn name + locals with exact Latin-1 output (`ñ`) | `10 ñ 4` | **PASS** |
| `mod_output_basic` | **[NEW]** Module Output | imported `sum`/`twice` called from entry | `3\n42` | **PASS** |
| `mod_diamond_dedupe` | **[NEW]** Module Diamond | `e1`/`e2` both `use` `d.hmx` — loaded once, correct results | `10 18` | **PASS** |
| `mod_exit_code` | **[NEW]** Module Exit Code | `main` returns a value from an imported fn | Exit Code: `42` | **PASS** |
| `array_builtins` | **[NEW]** Array Built-ins | push/sort/pop/slice/concat/index_of/contains output | `4\n9\n9\n3\n2\n2\n5\n-1\n2\n1\n0\napple` | **PASS** |
| `array_pop_empty` | **[NEW]** Runtime Error | `pop` on an empty array aborts | Exit Code: `1` | **PASS** |
| `array_slice_oob` | **[NEW]** Runtime Error | out-of-range `slice` bounds abort | Exit Code: `1` | **PASS** |
| `text_indexing` | **[NEW]** Text Ops Output | `s[i]`, `names[1][0]`, `ord`/`chr` arithmetic | `h\no\no\nd\n65\n97\nA\nc` | **PASS** |
| `split_basic` | **[NEW]** `split` Output | split preserving empty pieces, `index_of`, concat, `foreach` | `4\na\nb\n\nc\n3\na!\n1\n\n1\n2\n3` | **PASS** |
| `text_index_oob` | **[NEW]** Runtime Error | text index at/over length aborts | Exit Code: `1` | **PASS** |
| `chr_out_of_range` | **[NEW]** Runtime Error | `chr(300)` aborts | Exit Code: `1` | **PASS** |
| `split_empty_separator` | **[NEW]** Runtime Error | `split("abc", "")` aborts | Exit Code: `1` | **PASS** |
| `destructure_array_rest` | **[NEW]** Array `...rest` Output | first-N + rest binding, extra ignored, rest-is-empty | `1\n2\n2\n3 4\n1 2\n42 0` | **PASS** |
| `destructure_text_rest` | **[NEW]** Text `...rest` Output | text destructure, `[[int]]` rows, `grid[i]` rest | `h\ne\nllo\n3 l l\n3 3\n4\n2 5 6` | **PASS** |
| `destructure_array_oob` | **[NEW]** Runtime Error | too few array elements aborts | Exit Code: `1` | **PASS** |
| `destructure_text_oob` | **[NEW]** Runtime Error | too few text characters aborts | Exit Code: `1` | **PASS** |
| `destructure_nested_tuple_deep` | **[NEW]** Nested Tuple Output | `(((a,b),c),d)` deep destructure | `1 10 2 4` | **PASS** |
| `destructure_nested_array_group_rest` | **[NEW]** Nested Group Rest Output | rest inside nested array group + row capture | `1 2\n1 3\n2 4 5` | **PASS** |
| `destructure_array_of_tuples_rest` | **[NEW]** Array-of-Tuples Output | `((p,q), r, ...tail)` on `[(int,int)]` | `1 10\n2 20\n1 3 30` | **PASS** |
| `destructure_nested_text_elem` | **[NEW]** Text-Element Group Output | nested pattern on a text element | `hi\no k` | **PASS** |
| `destructure_nested_multi_assign` | **[NEW]** Nested Multi-Assign | assign into existing vars via nested pattern | `1 10 2` | **PASS** |
| `destructure_nested_array_oob` | **[NEW]** Runtime Error | nested group over a short row aborts | Exit Code: `1` | **PASS** |
| `destructure_array_of_tuples_oob` | **[NEW]** Runtime Error | too few array-of-tuple elements aborts | Exit Code: `1` | **PASS** |
| `destructure_nested_text_member` | **[NEW]** Runtime Error | text member too short for nested pattern aborts | Exit Code: `1` | **PASS** |
| `curry_partial_named` | **[NEW]** Currying | `add(1)` partial on a 3-arg fn, then `f(2, 39)` | `42` | **PASS** |
| `curry_partial_value` | **[NEW]** Currying | fn value `twice` partial-applied via `let ten = f(10)` | `40` | **PASS** |
| `curry_lambda_capture` | **[NEW]** Currying | lambda capturing `c` from `scale(c)` returns a closure | `42` | **PASS** |
| `curry_nested_lambda` | **[NEW]** Currying | lambda returning a lambda; `outer(20)` value call returns a closure | `19` | **PASS** |
| `curry_void_lambda_statement` | **[NEW]** Currying | void lambda called as a statement | `9` | **PASS** |
| `curry_hof_partial` | **[NEW]** Currying | partial application passed as a HOF argument | `42` | **PASS** |
| `curry_exit_chain` | **[NEW]** Currying | exit code via a chained partial `inc(41)` | Exit Code: `42` | **PASS** |

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
> **Conclusion:** Tier 1 and Tier 2 work, plus function types, higher-order calls, closures,
> non-local exit, cross-file modules (`use "file.hmx"` with cycle detection and file-tagged
> diagnostics), and Unicode (UTF-8) identifiers, now lands end-to-end without regressions:
> unary minus/plus, int-only modulo
> (incl. compound `%=`), `break`/`continue` loop control, `foreach`, `input()`, `tostr`/`parse_int`/
> `parse_decimal`, variadic `print`, nested functions, default parameter values, variadic
> `...type` parameters, `fn(...) -> ...` type annotations, function values as first-class
> data (pass, return, store, call via variable), nested-function closures capturing
> enclosing locals by-value snapshot, and `break`/`continue` from nested functions targeting
> an enclosing loop — all compile through the HMX pipeline and pass
> integration, negative, and stress/output tests. The bison parser still carries
> six harmless shift/reduce conflicts (all resolved by shift).
>
> **0.A1 addition:** recursive element type descriptors now make arrays recursively typed.
> Nested arrays (`[[int]]`) are implemented end-to-end: annotations, literal inference,
> empty-literal contextual fixing, `a[i][j]` chained indexing (expression reads and
> statement assignments via the new `postfix_index` grammar + `ElementAssignStmt`),
> tuple-member-array chains (`pair[1][0]`), and nested `foreach (row in grid)`. The conflict
> count is unchanged at 6 SR across 5 states; suites rerun at 45/141/69 = **255**.
>
> **0.A2 addition:** arrays are now growable heap pointers (`sd_array*` with `capacity`),
> so `push`/`pop`/`sort` mutate the shared backing in place (and through any alias —
> `let b = a; push(a, 9)` is visible via `b`), while `slice`/`concat` return independent
> copies. The seven array built-ins (`push`, `pop`, `sort`, `slice`, `concat`,
> `index_of`, `contains`) are resolver-typed (immutable/captured arrays, element-type
> mismatches, void-as-value, unsupported element kinds all rejected) and lowered to
> inline loop/statement-expression C plus runtime helpers (`sd_push`,
> `sd_ensure_capacity`). Runtime guards abort with exit code 1 on `pop` from an empty
> array and out-of-range/reversed `slice`. Suites rerun at 46/151/72 = **269**.
>
> **0.A3 addition:** text values are now indexable as bytes — `text[i]` reads a `char`
> with `strlen`-based bounds checking (assignment to a text character is a compile
> error), and the character built-ins `ord`/`chr` plus `split(text, sep)` → `[text]`
> complete the byte-level string set. `split` is lowered to a `sd_split` runtime
> helper (strstr-based, preserving empty pieces), `chr` checks the `0..255` code
> range, and an empty separator aborts; all three runtime failures exit 1. Also
> fixed chained-index resolution so `m[i][j]` records its resolved type (chars were
> formatting as ints). Suites rerun at 47/160/77 = **284**.
>
> **0.A4 addition:** destructuring now works on arrays and text in addition to
> tuples. `let (a, b, ...rest) = e` and `(a, b, ...rest) = e` bind the first `N`
> elements (or characters) and an optional `...rest` (a new `[elem]` array or a
> `text` substring), with a runtime length check that aborts (exit 1) when the
> source is too short. Tuple destructuring keeps exact-match semantics and
> rejects `...rest`. The `sd_array_slice` runtime helper backs array rest;
> `sd_substring` backs text rest; rest copies are independent of the source.
> Suites rerun at 48/167/81 = **296**.
>
> **0.A5 addition:** destructuring patterns now nest. Any slot may be a
> parenthesized list, so deep tuple nesting (`(((a,b),c),d)`), arrays of tuples
> (`[(int,int)]` with `((p,q), second)` patterns), rest inside a nested array
> group (`((x, y, ...zs), row)`), and nested patterns over text elements
> (`(w0, (c1, c2))`) all work, in both `let` and multi-assign forms. Nested
> tuple types and arrays of tuples were lifted from "not supported" end to end
> (annotations, literals, returns). Codegen orders tuple struct emission
> topologically and mangles tuple names structurally so nested shapes don't
> collide. A nested slot's value must be a tuple, array, or text (scalars are a
> compile error, as is `...rest` before another target). Suites rerun at
> 49/173/89 = **311**.
>
> **0.A6 addition:** tuple indexing now accepts a runtime `int` expression —
> `t[i]` — in addition to the existing compile-time constant. Because a dynamic
> member selection has no single static type, it is restricted to tuples whose
> members are all the same type; the result has that type and the index is
> bounds-checked at runtime via the new `sd_check_tuple_index` helper (aborts
> with exit code 1 out of range). Constant `t[N]` selection is unchanged.
> Lowering casts the address of the tuple struct to the common member type
> (struct layout of `N` identical fields); because call results can't be
> indexed by the grammar, the base is always an lvalue. Heterogeneous tuples
> under a non-constant index, and non-`int` indexes, are compile errors. Works
> for captured (closure) tuples, chained `grid[i][j]` on arrays of homogeneous
> tuples, nested homogeneous tuples (`t[i][j]`), and as a destructuring source.
> Suites rerun at 50/175/97 = **322**.
>
> **0.A7 addition:** currying lands via two complementary features. Anonymous
> **lambda expressions** use the reserved `lambda` keyword (`lambda(x: int) -> int
> { ... }`, zero-arg and void variants supported) and reuse the full `fn` parameter
> syntax — defaults, variadic, tuples, arrays, and function types all work, and
> lambdas capture enclosing scopes by snapshot exactly like nested functions.
> **Partial application** applies when a named function or function value is called
> with `1 <= args < arity` and the callee has no defaults and no variadic: the call
> returns a closure capturing the prefix arguments (lowered to a heap env plus a
> generated static trampoline that re-calls the original with applied + remaining
> args). Both named- and value-call paths participate, so partials compose, chain,
> and flow through higher-order functions; `lambda` was chosen over reusing `fn`
> to keep the bison conflict count at exactly 6 (5 states). Chained-call syntax
> `add(1)(2)` is not yet parseable — bind the intermediate closure to a name. A
> latent `expr_function_type` bug (full function-value calls returning the callee's
> type instead of the call result) was fixed as part of this work. Suites rerun at
> 51/182/104 = **337**.
>
> **0.A8 addition:** bare **tuple literal** expressions — `(1, 2)`, nested
> `(4, (5, 6))`, heterogeneous `(42, "hi", true)`, `([1, 2], [3, 4])`, arrays of
> literals `[(2, 3), (7, 8)]` — are now first-class in the grammar (the
> `factor` paren rule now accepts an `args` list; single-element `(v)` remains
> plain grouping). They work in every tuple position: `let`/`const` binding,
> direct function arguments (`swap((3, 4))`), `return (a, b)`, destructuring
> `let (a, b) = (10, 20)`, and as function-value tuple returns. The pre-existing
> codegen bug where paren groups silently vanished in generated C is fixed —
> `(2 + 3) * 4` now emits `(2 + 3) * 4` (= 20, previously `2 + 3 * 4` = 14) and
> `2 * (3 + 4)` similarly. Two more pre-existing latent bugs fixed en route:
> tuple-returning function-value calls lost their tuple members due to a
> copy-after-move in the four return-type parser productions, and `foreach` over
> an array of tuples now binds the loop variable's member types. Tuples remain
> immutable values — element assignment (`t[0] = x`) is still unsupported.
> Suites rerun at 52/190/116 = **358**, conflicts still exactly 6.
