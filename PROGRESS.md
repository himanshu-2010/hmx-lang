# HMX Compiler — Progress Log

Last updated: 2026-09-17
## Objective
Implement the HMX transpiler's 8-phase plan (from `PLAN.md`) so users can write full hello-world-capable programs. Multi-stage pipeline: lexer → parser → type resolution → codegen → gcc.

## Build / Test
- Build: `cd build && cmake .. && make` (workspace: this repo's `hmx-lang` dir)
- Tests: `./tests/run_integration.sh` runs `tests/fixtures/*.hmx`; fixtures must exit 0.
- CLI: `./build/hmx run|build <file.hmx> [-keep-c]`
- Deps: flex 2.6.4, bison 3.8.2, cmake 4.4.3, gcc/g++ 16.2.1.

## Language decisions (locked)
- If syntax: `if (cond) { } else { }` (C-style parens).
- Boolean ops: `and/or/not` AND `&&/||/!` both valid; emit C symbols.
- Function return type: `-> TYPE` (e.g. `fn add(a: int, b: int) -> int`).
- Function params: colon-annotated (`a: int`).
- Assignment: statement-only (no chaining, no in-expression); `= += -= *= /=` and `++ --`.
- Loop forms: `loop(count)`, `while (cond)`, `for (init; cond; update)`, and
  `do { ... } while (cond)`; `for` is the only syntax that uses semicolon separators.
- Text comparison: `==`/`!=` lower to strcmp; ordering ops on text are compile error.
- `main()` exit code: `fn main() -> int { return N }` → C exit code N; main without `-> int` appends `return 0`.
- Error format: `Error [line N]: ...` / `Parse error [line N]: ... near '...'`.
- Comments: `//` and `/* */` (non-nesting).
- Extension: `.hmx`.

## Progress

### Phase 1 — Block comments `/* */` — DONE
- Lexer `%x BLOCK_COMMENT`; unterminated comment → `Error [line N]: unterminated block comment`, exit 1.
- Fixture: `block_comments.hmx`.

### Phase 2 — Comparison ops `== != < > <= >=` — DONE
- `ExprKind` (Arithmetic/Comparison/Logical) on `BinaryExpr`; tokens `EQ NEQ LT GT LEQ GEQ`.
- Precedence: expression→equality→relational→additive→term→factor.
- Result type Bool; text ordering rejected; codegen `strcmp` for text `==`/`!=`.
- Added `current_line_` to resolver. Fixture: `comparisons.hmx`.

### Phase 3 — Boolean ops — DONE
- Lexer `and/or/not` + `&&/||/!` → `AND/OR/NOT`; AST `NotExpr`.
- Parser layers logical_or→logical_and→equality; unary NOT factor.
- Bool-only operands; codegen `&&`/`||`/`!`. Fixture: `booleans.hmx`.

### Phase 4 — if/else — DONE
- Lexer `if/else`; AST `IfStmt`; parser `if_stmt`; resolver requires bool condition.
- Known cosmetic: block-statement line numbers point at closing brace (affects if/loop).

### Phase 5 — Assignment — DONE
- Lexer `+= -= *= /= ++ --`; AST `AssignStmt`; parser `assign_stmt`.
- Resolver: lhs defined, `=` rhs type matches, compound/++/-- need int/decimal.
- Fixture: `assignment.hmx`.

### Phase 6 — Function params & return values — DONE
- Lexer `return`, `->` (ARROW), `,`. AST: `FunctionDecl` params/return_type/has_return_type, `ReturnStmt`.
- Parser: `return_stmt`, `param_type`, `param_list`, 4-way `fn_decl`.
- Resolver: `FunctionSig`, `functions_` map, `collect_functions()`, return tracking.
- Codegen: `emit_function_signature()` (typed params + return); main-appends `return 0` only when no `-> int`.
- Fixed main exit-code propagation (used `WEXITSTATUS` in main.cpp).
- Fixture: `fn_params.hmx`. Note: harmless bison shift/reduce conflict on `return expr` vs bare `return`.

### Phase 7 — Function calls — DONE
- AST: `CallExpr` (name + args), `ExprStmt` (for void-call statements).
- Parser: `args` nonterminal; call in factor; `call_stmt` statement rule.
- Resolver: `get_function()` validation — cannot call main, arg count match, per-arg type match, call type = return type; void call as value → error unless ExprStmt (`allow_void_call_`).
- Codegen: CallExpr emission, ExprStmt emission (this was the dropped-`greet("Boss")` bug — the emit_stmt ExprStmt branch was never added and is now fixed).
- Prototype-first emission (all `fn` signatures before definitions) so forward/reordered calls compile.
- Verified error cases: cannot call main, undefined fn, arg count mismatch, arg type mismatch, void fn used as value.
- Fixture: `calls.hmx` (10/10 pass). Bison shift/reduce conflict is only the harmless `return` ambiguity (resolved by shift).

### Next / remaining

### Phase 8 — Finalise — DONE
- Updated `SYNTAX.md`: all `[Spec]` tags for implemented features (assignment, compound/increment, comparison, boolean, full expression grammar, if, params, returns, calls) → `[Implemented]`; updated §12.1 main/exit-code and §12.3 (recursion now works via prototypes); documented void-fn-as-statement + call-order rules; removed stale recursion out-of-scope note.
- Added `recursion.hmx` fixture (fib) — proves recursion + calls + params + returns + if work end-to-end.
- Full regression: 11/11 fixtures pass.

## Language is hello-world-capable
All 8 phases complete. Users can write real programs: vars, arithmetic, comparison,
booleans, if/else, loops, assignment, functions with typed params + returns + calls
(including recursion), and `main -> int` exit codes.

## Post-plan features
### String concatenation `text + text` — DONE
- Resolver: `Arithmetic` with `+` on two `text` operands → result `text` (allowed); all
  other arithmetic on text/bool still errors; mixed `text + int` still a type mismatch.
- Codegen: emits static `sd_concat(a, b)` runtime helper (`malloc`-based) in generated C;
  `text + text` lowers to `sd_concat(...)`; left-associative for chains. `print(...)` on a
  concat uses `%s`.
- Fixture: `string_concat.hmx` (18/18 integration pass).
- Docs: SYNTAX.md §8.1 updated; removed roadmap "string concatenation undefined" note.

### Full loop family — DONE
- Removed stale `[` / `]` lexer returns for undeclared `LBRACK` / `RBRACK`; arrays/lists
  remain roadmap-only.
- Existing `while (cond) { ... }` is implemented end-to-end with bool condition checks.
- Added `for (init; cond; update) { ... }`: init is `let` or assignment, condition must be
  bool, update is assignment/compound/`++`/`--`, and init declarations are scoped to the
  loop header/body.
- Added `do { ... } while (cond)` with bool condition checks and no trailing semicolon in
  HMX source.
- Fixtures: `for.hmx`, `for_assignment_init.hmx`, `do_while.hmx`, `loops_nested.hmx`.
- Full regression: 23/23 integration, 35/35 negative, 14/14 stress/output.

### Arrays — DONE
- Lexer: restored `[` / `]` tokens.
- AST: `ArrayLiteral`, `ArrayIndexExpr`, `ArrayAssignStmt` nodes; `TypeKind::Array` and
  `TypeDesc` struct for `[type]` annotations; `array_element_type` fields on `VarDecl`,
  `FunctionDecl::Param`, `Symbol`; `return_array_element_type` on `FunctionDecl`.
- Parser: `'[' param_type ']'` for `[int]`/`[text]`/… type syntax; `factor` rules for
  `'[' args ']'` (literal) and `IDENTIFIER '[' expression ']'` (index); `assign_stmt` rule
  for `IDENTIFIER '[' expression ']' '=' expression`; `let`/`const` var_decl rules for
  array annotations.
- Resolver: resolves `ArrayLiteral` element types with same-type checking; validates
  `ArrayIndexExpr` (must be array, index must be `int`); validates `ArrayAssignStmt`
  (element type match, immutability); guards against binary/ternary/print on arrays;
  extends `length()` builtin to arrays; checks array-element types in function calls.
- Codegen: emits `sd_array` struct typedef and `sd_make_array` / `sd_check_index` runtime
  helpers; `ArrayLiteral` → heap-cloned compound literal; `ArrayIndexExpr` → cast + bounds
  check; `ArrayAssignStmt` → cast + bounds check + assignment; `length(arr)` → `.length`.
- Fixtures: `arrays.hmx`; 11 new negative tests; 5 new stress tests (loop sum, text
  elements, return/param round-trip, bounds-check exit codes).
- Docs: SYNTAX.md §5.3, §9, §10, §13.2 updated; roadmap §15 arrays row removed.
- Full regression: 29/29 integration, 62/62 negative, 23/23 stress/output.

### Multiple return values / tuples — DONE
- AST: `TypeKind::Tuple` and `TypeDesc::tuple_members`; `tuple_members` fields on `Param`,
  `FunctionDecl` (`return_tuple_members`), `VarDecl`, `Symbol`; new `DestructDecl` and
  `MultiAssignStmt` nodes; `ReturnStmt::values` vector; `ArrayIndexExpr` tuple fields
  (`is_tuple` / `member_index` / `array_of_element_type`).
- Parser: `'(' tuple_elem_list ')'` for `(int, int)` type syntax (params, annotations,
  return types); `let (a, b) = f()` destructuring declaration; `(a, b) = f()` multi-assign
  statement; `return a, b` multi-value return. Grammar guard rejects nested tuples and
  arrays of tuples ("nested tuple types / arrays of tuples are not supported").
- Resolver: `FunctionSig` tuple param/return shaping; `expr_tuple_members()`;
  `types_match()`; tuple call-argument matching; `ArrayIndexExpr` tuple branch (constant
  in-range int index only); guards for print/binary/ternary/length on tuples; VarDecl
  tuple annotation + inference; destructuring/multi-assign member-wise checks; reworked
  `ReturnStmt` compound member-wise validation; for-header rejection of destructuring.
- Codegen: `tuple_types_` collection + `sd_tuple_<type>_...` struct typedefs (scalars as
  C types, arrays as `sd_array`); multi-value return → compound literal; destructure /
  multi-assign → temp struct + field extraction (`__sd_dN` / `__sd_mN`); tuple param/return
  signatures; `.fN` field emission for tuple indexing.
- Fixtures: `tuples.hmx`; 18 new negative tests; 7 new stress tests (destructure,
  inference+index, multi-assign, tuple params, text member, array member, annotated decl).
- Docs: SYNTAX.md §5.4 added; §7.1/§7.2/§9/§10/§12.2/§12.3 updated; roadmap tuple row removed.
- Known quirk: the document bison conflict count is now 4 (return-vs-statement, tuple-assign
  vs args, call-vs-factor, `not ... as`), all resolved by shift; the `return` ambiguity now
  also covers `return` followed by a `(a, b) = ...` statement.
- Full regression: 30/30 integration, 80/80 negative, 30/30 stress/output.

### Unary minus, modulo `%`, and `break`/`continue` — DONE
- Lexer: `%` (MOD) and `%=` (MOD_EQ) tokens; `break` / `continue` keywords.
- AST/parser: `NegExpr` node; `factor : '-' factor` and `factor : '+' factor` (unary
  plus returns operand, kept for symmetry); `term '%' factor`; `IDENTIFIER MOD_EQ expression`
  compound assignment; `BreakStmt` / `ContinueStmt` statements.
- Resolver: `NegExpr` requires int/decimal ("operator '-' not defined for type X");
  `%` requires int operands and resolves to int; `%=` requires an int variable; new
  `loop_depth_` counter tracks loop nesting and `switch_entry_loop_depths_` records loop
  depth at switch entry so `break`/`continue` inside a case are only allowed when an
  innermost loop exists ("break inside a switch case requires an enclosing loop").
- Codegen: `-(expr)`, `a % b` via the generic binary path (no text-concat special case),
  `%=` via the generic compound-op path, `break;` / `continue;`.
- Bison conflicts now **6** (up from 4): the two new ones are the `+ factor` / `- factor`
  vs `factor AS type` ambiguity, same harmless shift-resolves-by-shift pattern as `not factor`.
- Fixtures: `neg_mod_break.hmx`; 10 new negative tests; 6 new stress tests (modulo basics,
  compound `%=`, unary minus, break/continue interplay, switch-with-inner-loop, exit code 42).
- Docs: SYNTAX.md §2 keywords, §7.3 `%=`, §8.1 `%` + unary ops + precedence, §9 grammar,
  §10 statements, new §11.5 break/continue, §14.4 checks; TESTRESULT.md; AGENTS.md conflict note.
- Full regression: 31/31 integration, 88/88 negative, 36/36 stress/output.

### Tier 2 — `foreach`, `input()`, conversions, variadic `print` — DONE
- `foreach (x in coll)` / `foreach (i, x in coll)`: iterates arrays (element copy) and
  text (char). Lexer tokens FOREACH/IN; AST `ForeachStmt`; parser rules (bare and
  index+value forms); resolver requires array/text iterable, scopes the loop variable
  (index as `int`), fills `element_type`; codegen emits a C `for` loop over
  `.length`/`strlen` with a value copy. `break`/`continue` work inside the body.
- `input()`: returns one stdin line as `text` (CR/LF stripped, `""` on EOF) via a
  getline-based `sd_read_line` runtime helper; resolver accepts 0 args, result Text.
- Conversions: `tostr` (int/decimal/bool/char/byte → text, text = identity, matches
  `print` formatting), `parse_int` / `parse_decimal` (strict whole-string parse;
  malformed input → stderr message + `exit(1)`). Runtime helpers
  `sd_to_str_int` / `sd_to_str_decimal` / `sd_to_str_char` / `sd_parse_int` /
  `sd_parse_decimal`; preamble now includes `<errno.h>` and `<limits.h>`.
- Variadic `print(a, b, c)`: `PrintStmt` now carries `std::vector<ExprPtr>`; grammar
  reuses the `args` rule (≥ 1 arg); resolver rejects array/tuple args; codegen emits a
  single `printf` with space-separated per-type formats. Empty `print()` is a parse error.
- Fixtures: `foreach.hmx`, `conversions.hmx`, `print_multi.hmx`; 14 new negative tests;
  13 new stress tests incl. stdin-fed cases via new `test_output_with_input` helper.
- Bison conflicts remain **6**. Full regression: 34/34 integration, 99/99 negative,
  48/48 stress/output.
- Docs: SYNTAX.md §2 keywords, §11.8 foreach, §13.1 variadic print, §13.3 `input`,
  §13.4 conversions, §14.4 checks; README.md status/keywords/control-flow/output/tests;
  TESTRESULT.md; AGENTS.md unchanged.

### Tier 2 (post-plan) — Nested functions — DONE
- `fn` declarations are now legal anywhere inside a function body (the grammar already
  allowed them as statements); they are **hoisted to program scope**.
- Resolver: `collect_functions` recursively registers nested signatures (self- and
  mutual-recursion work); program-unique name checking finds nested/global duplicates.
  Function bodies resolve in an **isolated scope + loop-depth context**: enclosing
  locals are invisible (no closures → `undefined variable`), and `break`/`continue`
  inside a nested function can't leak out of the enclosing loops.
- Codegen: recursive `collect_function_decls` gathers nested functions; every non-main
  function gets a top-level C prototype + definition (emission order unchanged), and
  the `FunctionDecl` case in `emit_stmt` now emits nothing (nested definitions are not
  inlined into the enclosing C function).
- Tests: fixture `nested_functions.hmx`; 5 new negatives (outer-local ref, global/sibling
  duplicate, nested `main`, break-outside-loop isolation); 2 new stress cases
  (nested helpers + recursion, three-level nesting + loop-declared helper).
- Known pre-existing limit noted: `fn double()` breaks because `double` is a C keyword;
  empty `{ }` function bodies are a parse error (`stmt_list` requires ≥ 1 statement).
- Full regression: 35/35 integration, 104/104 negative, 50/50 stress/output.
- Docs: SYNTAX.md §12.5 nested functions; README.md status/functions/tests; TESTRESULT.md.

## Known issues / deferred
- if/loop/while/for/do-while/return block line numbers point at closing brace (cosmetic).
- `return` followed immediately by `IDENTIFIER = ...` or `(a, b) = ...` on next line misparses (return expr wins via shift); acceptable edge case.
- bison emits six harmless shift/reduce conflicts, all resolved by shift: the `return expr`
  vs bare `return` ambiguity (now also covering a following tuple multi-assign statement),
  the `IDENTIFIER '[' ...` array indexing/assignment ambiguity, the `IDENTIFIER '(' ...`
  call-vs-factor ambiguity, and the unary `not` / `+` / `-` prefix vs `factor AS` ambiguity.
- Duplicate declarations and missing definite returns are rejected by the type resolver.
- `else if` chains are implemented and covered by `else_if.hmx`.
- Ternary expressions, explicit numeric casts, and immutable `const` bindings are implemented.

## Relevant files
- `src/lexer.l`, `src/parser.y`, `src/ast.hpp/cpp`, `src/type_resolver.hpp/cpp`, `src/codegen.hpp/cpp`, `src/main.cpp`
- `tests/fixtures/*.hmx`, `tests/run_integration.sh`
- `PLAN.md`, `SYNTAX.md`
