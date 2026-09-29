# HMX Compiler — Progress Log

Last updated: 2026-09-27
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

### Tier 2 (post-plan) — Variadic parameters & default values — DONE
- Lexer: new `ELLIPSIS` token (`...`). Parser: `param` now has three forms —
  `IDENTIFIER ':' type`, `IDENTIFIER ':' type '=' expression` (default), and
  `IDENTIFIER ':' ELLIPSIS type` (variadic). Still **6 shift/reduce conflicts**.
- AST: `FunctionDecl::Param` gains `ExprPtr default_value` and `bool variadic`;
  `Param` is move-only (holds a `unique_ptr`), so parser copies became moves
  (`f->params = std::move(*$4)`).
- Resolver: `FunctionSig` gains `param_has_default`, `variadic`, and
  `variadic_element_type`. Declaration checks: at most one variadic parameter, it must
  be last, it must collect a **scalar** element type, and defaults must form a trailing
  run of constant literals matching the param type (`byte` defaults must be `0..255`).
  Call checks: functions built with defaults/variadic use "expects at least N /
  at most M" errors; defaults-only exact-count semantics for plain functions are
  unchanged (kept old error message) except that supplied args are type-checked only
  up to the fixed prefix, with the variadic tail checked against the element type.
- Codegen: `functions_by_name_` map; call sites pad omitted args with their default
  literal and pack extras into `sd_make_array((T[]){...}, sizeof(T)*n, n)` (empty tail
  → `sd_make_array(0, 0, 0)`); variadic params emit as `sd_array` in signatures
  (existing Array handling). First `nbytes` bug (used element count) caught by
  `sum(1,2,3,4)` test and fixed with `sizeof(T)*count`.
- Tests: fixture `variadic_defaults.hmx`; 10 new negatives (default type/non-literal/
  trailing/byte-range, too-few, variadic-last/duplicate/scalar-y/wrong-type); 4 new
  stress cases (variadic sum, default padding, defaults+variadic, exit-code recursion).
- Full regression: 36/36 integration, 113/113 negative, 54/54 stress/output = **203**.
- Docs: SYNTAX.md §12.2 defaults + variadic ¶, §12.4 call arity, §14.4 errors,
  README.md functions/tests/roadmap; TESTRESULT.md.

### Milestone (post-plan) — Function types, higher-order calls & closures — DONE
- **Design (locked):** function type syntax `fn(<param_types>) -> <type>` in
  annotations, parameters, and return types. Lowered to C via a runtime
  `sd_closure { void* fn; void* env; }`. Every non-`main` user function gets a
  hidden leading `void* _sd_env` parameter; direct by-name calls pass a stack env
  (or `0`); closure **values** (passed/returned/stored via a variable of function
  type) get **heap** env copies (`sd_copy_env`) so they outlive the caller.
- **AST:** `TypeKind::Function`; `TypeDesc` gains `shared_ptr<FunctionTypeInfo>
  {params, ret}` with deep `==` (`operator!=` added) and `<`. `CapturedVar`
  (compiled name, type, depth) on `FunctionDecl`; `IdentifierExpr`/`CallExpr`
  gain `function_value`/`function_reference` flags.
- **Parser:** `type_spec` extended with `fn ( fn_type_params? ) -> type_spec`.
  Still **6 shift/reduce conflicts** (unchanged), zero warnings.
- **Resolver:** capture machinery — `outer_scope_stack_` (enclosing fn frames),
  `current_fn_`, `fn_decls_`, `resolved_functions_`; `find_outer_symbol` walks the
  actual enclosing function chain; `register_capture` snapshots the symbol's real
  `TypeDesc` (fixes `void outer;`). `require_capture_visibility` errors on
  out-of-scope captures ("cannot call 'g' from here: captured variable 'x' is not
  in scope"). `require_function_value` enforces declaration-before-use for function
  values and rejects `main` as a value. Deep function-desc checks on
  var/assign/param/arg/return; calling a variable of function type is a
  higher-order call with full arity + type matching; `print` and ternary reject
  Function; `expr_array_element_type`/`expr_tuple_members` fall back to
  `find_outer_symbol` for captured identifiers. Capture = read-only ("cannot assign
  to captured variable"), by-value snapshot (arrays share backing).
- **Codegen:** `sd_make_closure`, `sd_copy_env` helpers; per-capturing-fn
  `sd_env_<name>` struct typedefs; `emit_function_signature` prepends `_sd_env`;
  `emit_env_arg` (stack) vs `emit_env_heap_arg` (heap); direct calls pass env;
  higher-order calls emit
  `((<ret>(*)(void*,...))<name>.fn)(<name>.env, args...)`; identifier emission:
  function references → `sd_make_closure((void*)f, heapEnv)`, captured locals →
  `((sd_env_<name>*)_sd_env)-><name>`. Fixed registration-before-main-emission
  ordering bug; return of fn values uses heap env copies (no stack escape).
- **Tests:** fixture `closures.hmx` (capture, nested captures, forwarding through
  fn-value params, recursive closures, shared-array capture, two-closure
  independence); 11 new negatives (not-in-scope capture, forward-ref-to-value,
  `main` as value, print/ternary fn, param/var/assign/return fn-type mismatches,
  call arity); 4 new stress (hof fold, capture snapshot, nested forwarding,
  exit-code capture).
- Full regression: 37/37 integration, 124/124 negative, 58/58 stress/output = **219**.
- Docs: SYNTAX.md §7.1 annotations + §12.2 fn-type grammar, §12.3 returning fns,
  §12.5 rewritten (function types, closures, capture rules, roadmap trimmed);
  README.md features/tests/roadmap; TESTRESULT.md.

### Milestone (post-plan) — Non-local `break` / `continue` — DONE
- **Design (locked):** a `break`/`continue` in a nested function with no loop of
  its own targets the nearest lexically enclosing loop in the enclosing function
  chain; the nested function is a "breaker." Call-site restriction: a breaker is
  callable only directly from the function owning its target loop, lexically
  inside that loop — no forwarding through wrappers, no function values, no
  higher-order/indirect calls, no recursion through a breaker.
- **AST:** `Statement` gains `nl_id`/`nl_target`/`nl_owner`; `FunctionDecl` gains
  `has_nonlocal`/`nl_target_loop_id`/`nl_use_break`/`nl_use_continue`;
  `BreakStmt`/`ContinueStmt` gain `nonlocal`.
- **Resolver:** pass A `analyze_nonlocal_exits()` runs after `collect_functions`:
  assigns `nl_id`+`nl_owner` to every loop (loop/while/for/foreach/do-while),
  classifies each break/continue by presence of a loop enclosing the *statement
  site*, replicates the switch-case local-break guard, and errors
  "break/continue outside of a loop" when no loop exists anywhere. `resolve_stmt`
  maintains a `lex_loop_stack_` of currently active loops (target loops indexed by
  id); `require_nonlocal_call` rejects breaker calls outside the active target
  loop ("cannot call 'bail' from here: its non-local break/continue target loop
  is not active here"); `require_function_value` rejects breakers used as values.
- **Codegen:** `#include <setjmp.h>`; each target loop is wrapped with
  `jmp_buf _sd_nl_buf<id>;` before the loop and re-armed per iteration via
  `volatile int st = setjmp(buf); if (st == 1) break; if (st == 0) { body }`
  (resuming at 1 = break; 2 = continue skips the body so `for`/`foreach`/`loop`
  still run their update step). Breakers get a hidden `void* _sd_nl` param (after
  `_sd_env`); call sites pass `(void*)_sd_nl_buf<callee->nl_target_loop_id>`;
  non-local break/continue emit `longjmp(*(jmp_buf*)_sd_nl, 1/2)`.
- **Behavior change:** the previous negative test where a nested fn inside a loop
  used `break` became *valid* under this feature; replaced with a nested fn
  declared outside any loop (still "break outside of a loop").
- **Tests:** fixture `nonlocal_exit.hmx` (break in loop/while/do-while, continue
  in foreach/for); 7 new negatives (call outside loop, cross-function call,
  wrapper forwarding, cross-loop call, break/continue token as value, breaker as
  HOF argument, continue outside any loop); 7 new stress (break in loop/while/
  do-while, continue in for/foreach, nested non-local targets in one function,
  breaker owned by non-main function).
- Full regression: 38/38 integration, 131/131 negative, 65/65 stress/output = **234**.
- Docs: SYNTAX.md §12.6 (non-local exit semantics + restrictions + lowering),
  §12 hoisting bullets updated; README.md features/nested-fn section/tests;
  TESTRESULT.md.

### Milestone (post-plan) — Modules (`use`) + Unicode identifiers — DONE
- **Design (locked via Q&A):** modules imported with `use "path.hmx"`, allowed only
  at the very top of a file before any declarations; paths resolve relative to the
  importing file's directory; `.hmx` extension enforced; imports deduplicate by
  canonical path (diamond graphs compile each file once); cycles (including a module
  that `use`s the entry file) are a compile error; top-level functions merge into one
  program-wide namespace (the existing duplicate-function check applies across files;
  `main` must come from the entry). Unicode identifiers are opaque UTF-8 — any byte
  ≥ 0x80 is an identifier character, no normalization — emitted verbatim into the
  generated C (gcc accepts UTF-8 identifiers).
- **Lexer:** `"use"` → `USE` keyword; identifier rule widened to
  `([a-zA-Z_]|[^\x00-\x7F])([a-zA-Z0-9_]|[^\x00-\x7F])*`.
- **Parser:** `%token USE`; `program : use_list stmt_list` / `use_list` / `use_stmt`
  (`USE STRING`); conflicts remain exactly 6; `yyerror` no longer exits so module
  parse failures can be wrapped (`yyparse` return value checked).
- **AST:** `FunctionDecl::file`; `Program::use_files`; `Program::source_file`.
- **Loader (main.cpp):** `parse_file` (resets `g_program` + `yylineno`, `fopen`s and
  parses one file), `assign_file` (stamps each top-level function's subtree with its
  source file), `load_module_uses` (recursive DFS via a visiting stack: resolves
  relative paths, canonicalizes, validates `.hmx`, errors on missing file, detects
  cycles, dedupes, then merges modules into the entry program). Entry open-failure
  still reports `Error: cannot open file '<path>'`.
- **Resolver:** `CompileError` gained a file overload formatting
  `Error [<file>:<line>]: ...`; `err(line, msg)` (plain `Error [line N]` when no file,
  i.e. entry) and `err(line, msg, file)`; `entry_file_`/`current_file_` tracked in
  `resolve()`, and per-function in `resolve_stmt` (saved/restored around each
  FunctionDecl); all 137 `throw CompileError(` sites routed through `err()`; the
  parity of all 131 pre-existing negative messages is preserved.
- **Codegen:** per-function `#line` file via `line_file_` + `fn_file(fn)` (module path
  for imported functions, entry path otherwise), so `gcc` stage errors and recompiles
  map back to the correct `.hmx`.
- **Tests:** `test_module` helper + 5 module fixtures in integration; `test_error_module`
  helper + 9 module/`use` negatives (missing module, non-`.hmx`, cycle, cycle-to-entry,
  `use` not at top, duplicate fn across modules, module type error with file tag,
  module parse error, `use` as reserved keyword); `unicode_identifiers.hmx` fixture;
  `test_module_output`/`test_module_exit_code` helpers + 4 module stress cases and
  1 unicode stress case.
- Full regression: 44/44 integration, 140/140 negative, 69/69 stress/output = **253**.
- Docs: SYNTAX.md §1.6 Modules, §2 keyword table, §3 identifier grammar (unicode),
  §15 roadmap emptied; README.md features/tests/Remaining Features; TESTRESULT.md.

### 0.A1 — Recursive type descriptors, nested arrays, chained indexing — DONE
- AST: `TypeDesc` now carries a recursive element type
  (`std::shared_ptr<TypeDesc> elem`, null-safe `element()`, `TypeDesc::array_of()`);
  element fields renamed for clarity (`elem`/`elem_desc`/`return_elem`/`param_elems`/
  `variadic_elem`/`return_elem`/`current_return_elem_`); dead `array_of_elem` removed;
  `ArrayIndexExpr` gained an expression `base` for chains; new `ElementAssignStmt`.
- Parser: bison-typed `postfix_index` (recursive `a[0][1]…`) replacing the single
  `IDENTIFIER '[' expr ']'` factor, plus a chained-assign statement
  `postfix_index '[' expr ']' '=' expr` (single-index assignment unchanged); `[int]`
  var-decl annotations now store the element desc directly (`elem_desc = *$5`); param
  actions copy `desc` before moving tuple members (member vec was previously emptied
  in `desc`). Conflict count unchanged: still 6 shift/reduce across 5 states, all
  resolved by shift (2 on `return`, 1 call-vs-factor — now also covering the array
  postfix, and one each on `not`/`+`/`-` `factor AS type`).
- Resolver: `types_match`/`expr_element_desc`/`expr_desc` rewritten on recursive
  descs; nested-array literals enabled (inference from elements, contextual fixing of
  empty literals); `ArrayIndexExpr` chain branch resolves base first then applies the
  index (array or tuple member); foreach value defined against its own element type so
  `foreach (row in grid)` yields an array value that can itself be iterated; annotated
  variable paths use the full recursive descriptor.
- Codegen: `c_type_for_desc` recursion, `mangle_type_name` recursion, chained index
  emission doubles the (pure) base expression for `.data`/`.length`, `ElementAssignStmt`
  emits the chain target as an lvalue; tuple member array chains (`pair[1][0]`) work.
- Tests: `nested_arrays.hmx` fixture (annotation, inference, `a[i][j]` reads, chained
  assignment, nested foreach, array-of-arrays built from array vars); negative suite
  reworked: `array_nested_mismatch` (`[int] = [[1],[2]]`) and
  `array_nested_element_mismatch` (`[[int]]` heterogeneous rows) replace the removed
  "nested arrays are not supported" test.
- Docs: SYNTAX.md §5.3 (nested arrays implemented), §7 grammar (postfix_index),
  §13.? empty-literal note; this entry.
- Full regression: 45/45 integration, 141/141 negative, 69/69 stress/output = **255**.

### 0.A2 — Growable arrays (`sd_array*` pointer model) + array built-ins — DONE
- Runtime: the emitted `sd_array` struct now tracks `capacity` and element size
  (`esize`) alongside `data`/`length`; every array value is a heap `sd_array*`
  pointer (`sd_make_array` returns a pointer, `text[i]`-style element access
  becomes `->data`/`->length`). Array variables, params, returns, captures,
  variadic tails, tuple members, and `foreach` values all carry the pointer
  type. Added `sd_push` (grown by doubling +8) and `sd_ensure_capacity` runtime
  helpers. Reference semantics are preserved and now include the header: any
  `let b = a` shares the growable struct, so `push(a, …)`/`pop(a)`/`sort(a)`
  through one name are visible through the other, matching the already-shared
  element backing.
- Codegen/Resolver: `c_type_for_desc(Array)` → `sd_array*`; function signatures
  for array returns now use the full return descriptor; `VarDecl` emission emits
  `sd_array*` for array-annotated variables (annotated and inferred paths), with
  `VarDecl::elem_desc` now populated for inferred array initializers too (it was
  previously only set in the annotated path).
- Built-ins (resolver-typed via `CallExpr::array_aux`, codegen lowers to inline
  statement-expressions + runtime helpers): `push(a, v)` (mutates in place,
  returns nothing), `pop(a)` (returns the removed element; runtime error on empty
  array), `sort(a)` (in-place insertion sort for `[int]`/`[decimal]`/`[byte]`/
  `[char]`/`[text]`, text via `strcmp`), `slice(a, s, e)` (new independent copy;
  runtime-bounds-checked), `concat(a, b)` (new copy joining two arrays of one
  element type), `index_of(a, v)` (`-1` if absent), `contains(a, v)` (bool).
  `push`/`pop`/`sort` reject immutable array identifiers and captured-outer
  arrays (matching element-assignment rules); `index_of`/`contains` reject
  array/function element types; void built-ins (`push`, `sort`) enforce the
  "cannot be used as a value" rule. `expr_element_desc` understands
  `slice`/`concat`/`pop` so `let x = pop(grid)` on `[[T]]` infers `[T]`.
- Tests: `array_builtins.hmx` fixture (grow/sort/pop/slice/concat/index_of/
  contains + nested-array push/pop rows); 10 new negative tests (non-array arg,
  element/type mismatch, immutable array, void-as-value, unsupported sort
  element, non-int slice index, concat mismatch, `index_of` mismatch and
  nested-array rejection); stress additions `array_builtins` (exact output)
  plus runtime-error exit-code cases `array_pop_empty` and `array_slice_oob`.
- Docs: SYNTAX.md §5.3 (growable + reference semantics), §13.3 Array Built-ins
  (renumbered `input`→13.4, conversions→13.5); this entry.
- Full regression: 46/46 integration, 151/151 negative, 72/72 stress/output = **269**.

### 0.A3 — Byte-level text operations: `text[i]`, `ord`, `chr`, `split` — DONE
- `text[i]` read-indexing: `ArrayIndexExpr` gained an `is_text` flag; the
  resolver handles text in both the chained-index (on any expression whose
  value is `text`, e.g. `names[i][j]` for `[text]`) and identifier paths,
  requiring an `int` index and yielding `char`. Codegen emits
  `(B)[sd_check_index((int)strlen(B), I)]` for both paths, so out-of-range
  indexes reuse the array bounds error/exit. Assigning to a text character is
  rejected at compile time (`ElementAssignStmt` for chains, plus a dedicated
  "cannot assign to a character of a text value" message for the single-index
  `s[i] = v` case in `ArrayAssignStmt`).
- Bug fix: chained `ArrayIndexExpr` resolution returned `result` without
  writing `expr->resolved_type`, so `print(m[i][j])` formatted chars/arrays as
  int (masked for int arrays since `%d` is the formatter default). Now stored
  before the early return.
- Built-ins: `ord(char)` → `int` (codegen `(int)(unsigned char)(c)`);
  `chr(int)` → `char` with a runtime `0..255` bounds check ("Error: chr expects
  a character code between 0 and 255, got N", exit 1); `split(text, sep)`
  → `[text]` via a new `sd_split` runtime helper (strstr-based loop; empty
  pieces preserved, `split("")` yields one empty piece; empty separator is a
  runtime error "Error: split separator must not be empty", exit 1). Resolver
  type-checks each builtin's arity/arguments; `expr_element_desc(split(...))`
  is `text` so `let p = split(...)` infers `[text]`.
- Tests: `text_ops.hmx` fixture; 9 new negative tests (text element assignment,
  non-int text index, `ord`/`chr` wrong arg types and arity, `split`
  non-text args and arity); stress additions `text_indexing` and `split_basic`
  (exact output) plus exit-code cases `text_index_oob`, `chr_out_of_range`,
  `split_empty_separator`.
- Docs: SYNTAX.md §13.3 Character Indexing & `ord`/`chr`/`split` (renumbered
  array built-ins→13.4, `input`→13.5, conversions→13.6; §5.3 cross-reference
  retargeted to §13.4); this entry.
- Full regression: 47/47 integration, 160/160 negative, 77/77 stress/output = **284**.

### 0.A4 — Destructuring arrays and text: first-N + `...rest` — DONE
- Syntax extends the existing tuple destructuring forms: `let (a, b, ...rest) = e`
  and `(a, b, ...rest) = e`. The parser's `id_list` now accepts an optional
  trailing `ELLIPSIS IDENTIFIER` (the `...` is only allowed as the last target),
  producing the new `IdList{names, rest}` struct shared by `DestructDecl` and
  `MultiAssignStmt` (both gained `rest_name`, `destruct_type`, `destruct_elem`).
- Resolver: destructure sources may be tuples, arrays, or text. Tuples keep the
  exact-match rule and reject `...rest`. Arrays bind the first `N` targets to the
  element type (recursively fine — `(row0, row1) = grid` and `(t, ...tt) =
  grid[i]` work) and `...rest` to a new `[element-type]` array; text binds
  `char` targets and a `text` rest. Generic error message for other sources
  ("right side of destructuring must be a tuple, array, or text, got X" — the
  old `tuple_destruct_non_tuple` expectation was updated accordingly).
  Multi-assignment type-checks every target (including the rest target) for
  mutability and matching type via a shared lambda.
- Codegen: array destructuring lowers to a temp `sd_array*`, an upfront
  `length < N` runtime check ("Error: cannot destructure array of length L into
  N targets", exit 1), direct element copies, and a `sd_array_slice` runtime
  helper (added to the preamble) for the independent rest copy. Text
  destructuring lowers to a temp `char*`, a `strlen`-based length check ("Error:
  cannot destructure text of length L into N targets", exit 1), `char` copies,
  and `sd_substring` for the rest. Rest slices are independent (mutating them
  does not affect the source).
- Tests: `destructure_rest.hmx` fixture (array rest, text rest, extra elements
  ignored, nested `[[int]]` rows, `...rest` from `split` and `grid[i]`,
  single-element rest-is-empty); 7 new negative tests (tuple rest rejection,
  unknown-element arrays, multi-assign element mismatch, rest-target mismatch,
  immutable target, text multi-assign mismatch, text rest-target mismatch);
  stress additions `destructure_array_rest`, `destructure_text_rest` (exact
  output) and exit-code cases `destructure_array_oob`, `destructure_text_oob`.
- Docs: SYNTAX.md §7.5 Array and Text Destructuring (renumbered casts→7.6),
  §7.2 cross-reference, statement table row updated; this entry.
- Full regression: 48/48 integration, 167/167 negative, 81/81 stress/output = **296**.

### 0.A5 — Nested destructuring patterns — DONE
- Syntax: any destructuring slot of `let (…) = e` / `(…) = e` may itself be a
  parenthesized list. `IdList{names, rest}` became `IdList{items}` of
  `DestructPattern{name, items, nested, is_rest, vdesc}`; the new `pattern_item`
  nonterminal accepts `IDENTIFIER`, `... IDENTIFIER`, or `( id_list )`. Every
  list keeps the ≥2-item rule. `...rest` may appear at any nesting level
  (arrays/text) but only as the last slot of its list.
- Types: lifted the three parser restrictions that blocked nested values —
  "nested tuple types are not supported" (×2 in `tuple_elem_list`) and "arrays
  of tuples are not supported" (`[ param_type ]`); also removed the identical
  array-of-tuples rejection in the resolver's `ArrayLiteral` branch. Nested
  tuples (`((int,int), int)`), arrays of tuples (`[(int,int)]`), and array
  literals of tuples now type-check end to end. `expr_tuple_members` gained an
  `ArrayIndexExpr` case so `pairs[i][j]` and `tail[0][0]` resolve tuple-member
  types.
- Resolver: `bind_destruct_slot` + recursive `apply_destruct_pattern`. A leaf
  defines/checks a slot with its value type (tuples record `tuple_members`);
  a nested group recurses when its value is a tuple, array, or text and errors
  otherwise ("cannot destructure a value of type X into a nested pattern",
  "cannot destructure a character into a nested pattern"). Tuple groups keep the
  exact member-count match and reject `...rest` at any depth; array/text groups
  require `...rest` to be last ("cannot use '...rest' before another
  destructuring target"). Every slot records its resolved `vdesc` for codegen.
- Codegen: recursive `emit_destruct_level`/`emit_binding`. Tuple sources slice
  fields inline (`.fN` chains); array sources emit a `length < N` check and
  element reads `((T*)src->data)[i]`, recursing with the member expression as
  the sub-source (no temp needed — array/text element expressions are
  side-effect-free); text sources emit a `strlen` check and `sd_substring`
  rests. Tuple typedef emission was made dependency-ordered
  (`emit_pending_tuple_types`) so nested struct types are defined before the
  outer structs that embed them, and `register_tuple_types_deep` pre-registers
  every reachable tuple type (patterns, VarDecl/FunctionDecl/ReturnStmt
  annotations). `mangle_type_name` is now structural for tuples
  (`tup_int_text_…`), fixing a name collision where differently-shaped nested
  tuples all mangled to `sd_tuple_tuple_int`.
- Tests: `destructure_nested.hmx` fixture (deep tuple nesting, array of tuples
  with group+rest, rest inside a nested array group, nested patterns on text
  elements, nested multi-assign); 8 net-new negative tests (nested pattern on a
  scalar element, nested count mismatch, rest inside a tuple group, rest before
  another target in array/text, nested multi-assign undefined target, nested
  pattern on a char — the old `tuple_nested` test, which asserted nested tuples
  were rejected, was replaced); 9 new stress cases (5 exact-output, 4 exit-code
  for nested length errors).
- Docs: SYNTAX.md §5.2 (array elements may be tuples), §5.4 tuple-member rules
  (nested tuples + arrays of tuples now supported), §7.1 grammar
  (`id_list`/`pattern_item`), §7.5 nested-pattern example + rules, statement
  table row; this entry.
- Full regression: 49/49 integration, 173/173 negative, 89/89 stress/output =
  **311**; bison conflicts unchanged at 6; zero compiler warnings.

### 0.A6 — Dynamic tuple indexing (`t[i]` with runtime bounds check) — DONE
- Semantics: tuple indexing now accepts a runtime `int` expression in addition
  to the existing compile-time `t[N]`. Because a dynamic member selection has no
  single static type, it is allowed only when every member of the tuple has the
  same type; the result then has that member type. The index is bounds-checked
  at runtime (negative or ≥ arity aborts with exit code 1). Constant
  `t[literal]` selection is unchanged (compile-time range check, direct `.fN`
  field access). Heterogeneous tuples under a non-constant index and non-`int`
  indexes remain compile errors.
- Resolver: new `resolve_tuple_index(ArrayIndexExpr*, members, line)` helper used
  by both `ArrayIndexExpr` branches (identifier base and chained base). It
  resolves the index expression first (int-check), takes the constant path for
  `NumberLiteral` (range-checked `.fN`), and otherwise requires homogeneity —
  "cannot index tuple (A, B) with a non-constant index: tuple members must all
  be of the same type" — setting `idx->tuple_dynamic`, `idx->tuple_arity`, and
  `idx->elem` (the common member type). `expr_tuple_members` / `expr_element_desc`
  already read `elem`, so dynamic indexes compose with destructuring, chained
  indexing, and array-element typing without further changes.
- Codegen: new `sd_check_tuple_index(length, index)` runtime helper (distinct
  "tuple index out of bounds" diagnostic). Dynamic access lowers to casting the
  address of the tuple struct to the common member type and subscripting it —
  `(((T*)(&(t)))[sd_check_tuple_index(N, i)])` — which is a valid lvalue and
  bounds-checked; the base is always an lvalue because the grammar can't index a
  call result, and `N` identical `T` fields embed at `sizeof(T)` offsets with no
  padding, so the struct layout matches an array of `T`. The tuple typedef isn't
  needed here, only the pre-registered member type.
- Tests: `tuple_dynamic_index.hmx` fixture; 3 net-new negatives (heterogeneous
  dynamic index, nested-heterogeneous dynamic index, non-int index on a tuple —
  the old `tuple_index_non_constant` negative, now legal, was removed); 8 new
  stress cases (exact-output: homogeneous variable/expression index, `for` loop
  walk, chained `grid[i][j]`, nested `((int,int),(int,int))` with `t[i][j]`,
  dynamic-index destructuring source, closure-captured tuple; exit-code:
  out-of-range high and negative indexes).
- Docs: SYNTAX.md §5.4 rules and §9 tuple-indexing paragraph + example; this
  entry.
- Full regression: 50/50 integration, 175/175 negative, 97/97 stress/output =
  **322**; bison conflicts unchanged at 6; zero compiler warnings.

### 0.A7 — Currying: lambda expressions + partial application — DONE
- **Design (locked):** anonymous functions use the reserved `lambda` keyword
  (`lambda(x: int) -> int { ... }`, plus zero-arg and void variants). A
  dedicated keyword (not `fn`) keeps the bison conflict count at exactly 6:
  `fn` also starts the `fn_decl` statement, so `lambda` in expression position
  is unambiguous against a following bare `return`. Partial application —
  calling a named function or function value with `1 <= args < arity` (no
  defaults, no variadic) — returns a closure over the prefix arguments.
  Chained-call syntax `add(1)(2)` remains unparseable; bind the intermediate
  closure to a name.
- **Parser:** `LAMBDA` token; four `factor` productions
  (`lambda(')' '{' ...` / 0-arg vs param_list × void vs `-> param_type`),
  reusing `param_list` (defaults, variadic, complex types all supported) and
  `stmt_list` (≥ 1 statement, matching `fn_decl`). Conflicts stay at 6 across
  the same 5 states.
- **AST:** `LambdaExpr` (params, return fields, body, line) with resolver-set
  `resolved` (the hoisted `FunctionDecl`) and `lambda_type`; placed after
  `FunctionDecl` for the `Param`/`StmtPtr` dependency. `CallExpr` gains
  `is_partial`, `partial_applied`, `partial_full_params`, `partial_params`,
  `partial_ret`, `partial_ftype`. `FunctionDecl` gains `is_lambda`.
- **Resolver:** `resolve_function_decl(FunctionDecl*)` extracted from the
  `resolve_stmt` nested-fn branch (identical semantics: fresh scope,
  `outer_scope_stack_` chain, captures, return tracking, scope restore). The
  `LambdaExpr` branch synthesizes `__lam_<n>` (collision-safe vs.
  `functions_`/`fn_decls_`; named `<n>` also avoids user fns), moves params +
  body in, resolves via the shared helper, builds the fn type desc, and owns it
  in `lambda_fns_`; `resolve()` appends those to `program.statements` after the
  main loop (post-loop so no iterator invalidation, no double resolution) so
  codegen picks them up like any function. Lambda error messages say `lambda`
  not `__lam_0`. Partial calls in both the named and function-value branches:
  `1 <= args < arity` sets the partial fields (prefix validated like a normal
  call) and resolves to `Function`; empty calls stay "expects N arguments, got
  0"; excess args stay errors; defaults/variadic paths unchanged. Bug fix:
  `expr_function_type` on a full function-value call now returns
  `fn_info->ret` (the call result) instead of the callee's whole type —
  previously `let g = hof(1)` on a function-returning function value typed
  wrong.
- **Codegen:** `emit_expr` builds partial calls as a GNU statement-expression:
  base closure (named fn → `sd_make_closure((void*)name, heapEnv)`; value →
  the stored `sd_closure`), then `sd_papp_env_<m>` struct literal + heap copy +
  `sd_make_closure((void*)sd_papp_<m>, ...)`. Per unique signature the pre-scan
  (`collect_lambdas_stmt`/`_expr` walkers over statements' expressions) pushes
  lambdas into `all_functions_` (deduped by pointer) and registers papp
  typedefs + `static` trampolines (emitted after tuple typedefs), which forward
  by re-calling `orig.fn` with `orig.env` + applied args + new args. Name
  mangling recurses into fn-typed params so `compose(square)` vs.
  `compose(inc)` signatures can't collide. Lambdas emit as
  `sd_make_closure((void*)__lam_N, heapEnv)` via the normal capture machinery.
- **Tests:** `currying.hmx` fixture (named/value partials in HOFs, capture
  across an enclosing fn, lambda-returning-lambda, direct lambda argument, void
  lambda); 7 new negatives (too-many args at a partial-returning call, prefix
  type mismatch, zero-arg on a fn value, remaining-arity overshoot, partial
  result type mismatch, void lambda in value position, lambda may exit without
  returning) + `call_arg_count_mismatch` rewritten to `add(1, 2, 3)` since
  `add(1)` is now legal; 7 new stress (named/value partial, lambda capture,
  nested lambda, void lambda, partial-as-HOF-arg, exit-code 42 via partial
  chain).
- Docs: SYNTAX.md §12.5 (lambda expressions + partial application, `lambda`
  keyword reserved, parser-limitation note, roadmap trim); this entry.
- Full regression: 51/51 integration, 182/182 negative, 104/104 stress/output =
  **337**; bison conflicts unchanged at 6; zero compiler warnings.

### 0.A8 — Bare tuple literals — DONE
- **Design (locked):** a comma-separated `(v0, v1, ...)` with 2+ elements is a
  tuple literal expression usable everywhere a tuple value is legal — `let`/
  `const` binding, function argument, `return (a, b)`, tuple member, array
  element, destructure RHS. A single-element `(v)` stays plain grouping
  (passthrough, type of `v`), so `(1, 2)` is a tuple but `(3)` is `int`.
  Member types are inferred from the element expressions and checked against an
  optional annotation. Reuses the existing tuple machinery end to end:
  `expr_tuple_members` on the literal gives the member descs, tuple struct
  typedefs carry it through codegen, and indexing/destructuring/multi-assign
  work unchanged.
- **Parser:** the `factor` `'(' expression ')'` rule is replaced by
  `'(' args ')'` (single element → the element itself; 2+ → `TupleLiteral`).
  The 6 bison shift/reduce conflicts are unchanged, across the exact same 5
  states. Latent-bug fix in all four return-type productions (fn_decl 0-arg
  `$6`, fn_decl arg `$7`, lambda 0-arg `$5`, lambda arg `$6`): copy
  `return_desc = *$N` **before** `std::move($N->tuple_members)` — the move was
  emptying the tuple members, so tuple-returning function values
  (`let mk = lambda(b: int) -> (int, int) { return (b, b + 1) }; mk(41)`)
  failed tuple typing at the call site.
- **AST:** `TupleLiteral` (children vector, line) after `ArrayLiteral`.
- **Resolver:** `resolve_expr` TupleLiteral case (resolve each child, build the
  tuple desc) and `expr_tuple_members` case (recurses into children). Existing
  tuple-returning fn-value call and ArrayIndex paths now also cover literals.
  Pre-existing bug fix: `foreach` over an array of tuples
  (`for (pt in pts)` where `pts` is `[(int, int)]`) now passes the element's
  `tuple_members` when defining the loop variable, so `pt[0]`/`pt[1]` resolve.
- **Codegen:** `collect_lambdas_expr` TupleLiteral case registers the member
  typedefs; `emit_expr` emits the aggregate struct literal
  `(sd_tuple_<mangle>){ v0, v1, ... }`. Pre-existing bug fix: `emit_expr` for a
  `BinaryExpr` now parenthesizes child `BinaryExpr` nodes — previously
  `(2 + 3) * 4` emitted C `2 + 3 * 4` (= 14), and `2 * (3 + 4)` emitted
  `2 * 3 + 4` (= 10); the paren groups silently vanished in the generated C.
  SYNTAX.md §8.1 documented `(2 + 3) * 4 // 20` but no test exercised mixed
  precedence through parens, so it had never been caught.
- **Tests:** `tuple_literals.hmx` fixture (basic/nested/heterogeneous literals,
  literal as arg, literal returns incl. fn-value, array-of-tuples +
  `foreach`, tuple-of-arrays, direct destructure, `const`, grouping
  precedence); 8 new negatives (print, annotated mismatch, arity mismatch,
  single-element-not-tuple, index out of range, `+` on tuples, ternary, `length`);
  12 new stress (literal members/nested/arg, heterogeneous, fn-value return,
  array-of + foreach, const, destructure, single-value return, tuple-of-arrays,
  grouping precedence `20/14/-4/7`).
- Docs: SYNTAX.md §5.4 (tuple literals, single-element = grouping) + §8.1 note;
  this entry.
- Full regression: 52/52 integration, 190/190 negative, 116/116 stress/output =
  **358**; bison conflicts unchanged at 6; zero compiler warnings.

### Milestone — Web playground: full native-parity compiler (M2–M4) — DONE
- **Scope:** the browser playground (`web-playground/`) ships a from-scratch,
  no-backend compiler (Vite + React + TS only) whose output is byte-identical to
  `build/hmx` across all 358 native suite cases.
- **Frontend (M2):** TypeScript lexer mirroring lexer.l; `tables/tables.json`
  extracted from bison's generated `build/parser.cpp` by
  `tools/extract_parser_table.mjs`; a generic LALR driver reproducing all six
  shift/reduce conflicts; rule actions mirroring parser.y; full AST.
- **Resolver (M3):** port of type_resolver.cpp — scopes, declarations, closures +
  captures, function values, defaults/variadics, arrays/text destructuring +
  `...rest`, dynamic tuple indexing, lambdas + partial application, and the
  `err(line, msg[, file])` pair with the entry-aware file overload. Two parsing
  shapes the port surfaced were fixed: partial-application calls must spread the
  rest args, and capture-aware reads are required for base-less array indexes and
  element assigns.
- **Backend (M4):** `codegen_js.ts` emits JS mirroring codegen.cpp
  (`v_*`/`f_*` mangling, `_sd_*` internals, closures `{f, e}`, int division via
  `SD.idiv`, `SD.copy` shallow tuple copies at C struct boundaries, and destructure
  recursion threading the full `TypeDesc` so nested members resolve against their
  own tuple members / element descs); `runtime.ts` implements the SD helpers
  (concat, bounds checks, split, substring, parse_int/parse_decimal, tostr) with
  verbatim native error strings; `vm.ts` executes the emitted body via
  `new Function("SD", src)` and unwinds `ExitSignal`; `program.ts` mirrors main.cpp
  (`.hmx` check, module loader with entry-seeded cycle detection, module
  parse-detail diagnostics, `main()` exit-code propagation).
- **Parity gate:** `tools/smoke/gen-data.mts` parses the three native `.sh`
  suites with a bash-aware tokenizer (handles the `'"'"'` / `'\''` idioms and
  `$(printf ...)` substitutions) and snapshots `{ stdout, stderr, exit }` per
  case from `build/hmx`; the committed `tests/data/*.json` + `tests/parity.test.ts`
  assert `runProgram()` verbatim across 52 integration, 116 stress, and 190
  negative cases (361 vitest). Module diagnostics compare entry-relative (native
  embeds absolute `weakly_canonical` paths; web canonicalizes relative to entry).
- **Deploy:** `npx tsc -b` and `vite build` green (Antideploy auto-builds `main`
  → https://hmx.antideploy.com; live bundle hash matches the local build).
- Docs: TESTRESULT.md (web parity section added); PLAN.md quirks note clarified.
- Full parity: 52/52 integration, 116/116 stress, 190/190 negative — all
  web-vs-native byte-identical; native suites unchanged at **358**.

### Milestone — Landing page, multi-page app + guided tour — DONE
- **Routes:** `react-router-dom` (HashRouter — hash links survive static hosting,
  so `hmx.antideploy.com/#/playground` deep-links work). `/` = home, `/playground`
  = compiler workspace, `/docs` = docs. The top bar becomes route links; runner
  state is lifted into a `RunnerProvider` so the home samples and docs examples
  load straight into the playground editor via one dispatch + navigate.
- **Home page:** a full landing page in the red/black brand palette with
  originkit-style detailing — animated hero (drifting blood-red blur blobs, grid
  mask, vignette), glowing terminal-style sample card, stats strip, keyword
  marquee, compiler-pipeline card + fact sheet, spotlight-hover feature grid,
  three verified runnable samples (closures / tuples / loops) with their exact
  stdout shown, native-vs-web byte-parity cards, CTA banner, and footer. Every
  sample was validated against `build/hmx` before being committed.
- **Guided tour:** first-time users on desktop only (`matchMedia` pointer:fine +
  ≥1024px; localStorage-gated) get a 4-step coach-mark tour that spotlights the
  editor, Run button, Output pane, and the Docs nav link; re-playable via a `?`
  button in the results toolbar; touch/coarse pointers never see it.
- **Palette:** `index.css` `:root` re-themed to the brand palette (near-black
  `#0A0A0A` canvas, burgundy `#1A0505` depths, `#8B0000`/`#C41E3A`/`#E63946`
  reds, `#FF6B6B` warm highlight, `#F5F0F0` off-white text, `#4A2C2C` dusty
  secondary) via its existing CSS variables, so the whole app re-themes.
- **Hygiene:** `tsc -b` + `vite build` + `oxlint` (0 errors) green; a jsdom
  render smoke suite (`tests/app.test.tsx`, 5 tests) mounts the real app and
  asserts Home/Playground/Docs routing plus a real `Run` through the pipeline;
  parity gate unchanged at 361 vitest green. Browser API usage hardened
  (`matchMedia` / `IntersectionObserver` guards).

### Milestone — Production UX pass: fonts, light/dark theme, splash, rate-limited run — DONE
- **Typography roles** (per the design brief): `Waterlily` (handwritten,
  self-hosted `web-playground/public/fonts/waterlily.ttf`, free-for-personal-use
  license noted in `fonts/README.md`) for the `HMX` wordmark / hero accent;
  `Outfit` 500–700 for headings; `Inter` 300–600 for body/UI; `JetBrains Mono`
  for code. Loaded via preconnect + Google Fonts CSS (Inter/Outfit/Mono) and an
  `@font-face` for Waterlily; exposed as `--font-body/display/code/script`
  tokens so roles map once and everything else inherits.
- **Boot splash:** `SplashLoader` shows the brand frame (logo, script `HMX`,
  progress bar) until `document.fonts.ready` resolves — minimum 700ms, hard 2.8s
  cap so the site never hangs on a blocked font — then fades out. Skipped under
  vitest (`import.meta.env.MODE === "test"`).
- **Light/dark theme toggle:** `ThemeToggle` in the top bar (sun/moon). First
  visit resolves the system `prefers-color-scheme`; afterwards the choice is
  persisted to `localStorage` (`hmx-theme`) and applied to
  `<html data-theme="light|dark">` before first paint (no flash). Full light
  palette overrides in `index.css`/`home.css`/`guide.css`; code panels and the
  hero terminal intentionally stay dark in both modes so token colors hold.
- **Dark Reader detection:** `darkReaderActive()` sniffs `data-darkreader-scheme`
  / `darkreader` classes / injected `style#darkreader*`; if found, a themed
  `DarkReaderAlert` card asks the user to disable it for this site (once per
  session via `sessionStorage`, delayed re-checks after first paint).
- **Rate-filtered interactions:** `useDebouncedCallback(cb, 250)` wraps every
  compile-carrying action — the playground Run (button + Ctrl/⌘+Enter), the
  home samples' "open in playground", and the docs' run-example buttons — so
  double-clicks and key-spam collapse into one compile. Smoke test updated to
  flush the debounce timer with fake timers.
- **Hygiene:** `tsc -b` + `vite build` + `oxlint` (0 errors, 10 benign
  warnings) + vitest **366/366** green.

### Milestone — Mouse follower + light-theme colour pass (M8) — DONE
- **Cursor trail:** `web-playground/src/ui/CursorTrail.tsx` — a hot dot that
  tracks the pointer 1:1 plus a 190px halo that lerps behind it, driven by one
  `requestAnimationFrame` loop writing only to `transform`/`scale` through refs
  (no React state per frame). Mounted in `App.tsx` with `pointer-events: none`
  and z-index 40 (below splash/guide overlays). Gated to `(pointer: fine) and
  (hover: hover)`, disabled under `prefers-reduced-motion`, hidden until the
  first pointer move, hidden on document leave, skipped in vitest
  (`MODE === "test"`) and on touch — verified: headless Chrome reports no fine
  pointer, so nothing renders there.
- **Light-theme palette overhaul:** rebuilt the `[data-theme="light"]` token
  block around a considered warm-paper palette (`--bg #f4efec`, white panels,
  `--text #241a17` ≈13:1, `--muted #5d4843` ≈6.5:1, `--dim #8a726c` ≈4.5:1 on
  `--bg`, readable red accents `--red-hi #a0162c` / `--coral #d73748`). Fixed
  every "hidden text" regression: `.doc-intro` was hardcoded light-grey
  `#c6c6d0` (invisible on a light page → now `var(--muted)`); dark-kept
  surfaces (hero terminal, sample-code bars, docs code strips/actions) pinned
  to light-mode-forced text colors so token-driven `--muted/--dim/--ok` do not
  flip dark inside them.
- **Hygiene:** tsc ✓, vite build ✓ (fresh `index-CQYx8wo9.css` /
  `index-CZE3Fah3.js`), oxlint 0 errors, vitest 366/366.

### Milestone — CLI hardening: default-run, help/version, `new`, portability (M9) — DONE
- `src/main.cpp` reworked argument handling: bare `hmx <file.hmx>` **runs by
  default**; `run`/`build` stay explicit; `-h/--help/help` → usage on stdout
  (exit 0); `-v/--version/version` → `hmx 0.9.0`; `hmx new <name>` scaffolds a
  runnable starter file (refuses to overwrite, tolerates a `.hmx` suffix);
  `build -o <output>` for explicit binary paths; unknown options / missing
  args / non-`.hmx` files exit 1 with a clear message.
- **Version stamp:** `project(hmx VERSION 0.9.0 …)` in `CMakeLists.txt` +
  `target_compile_definitions(hmx PRIVATE HMX_VERSION=...)`, with a hard-coded
  `0.9.0` fallback in `main.cpp` when built outside CMake.
- **Compiler probe:** `find_c_compiler()` prefers `gcc`, falls back to `cc`
  then `clang` (macOS/no-gcc systems), with a friendly error if none exist.
- **Windows portability:** `sys/wait.h` include guarded (`#ifndef WEXITSTATUS`
  fallback for MSVC), output binaries get a `.exe` suffix on `_WIN32`, and the
  POSIX `./` run-prefix is dropped (cmd runs current-dir executables by name).
  MinGW-w64 + winflex-bison build path covered by the release workflow.
- **Exit-code contract preserved:** `run` still passes through the program's
  exit code via `WEXITSTATUS` (stress suite asserts 0/1/42/100).
- New `tests/run_cli_tests.sh` (**23 CLI tests**): default-run, explicit run,
  `-keep-c` file retention, exit-code passthrough, `build -o` + run, version,
  help, `new` semantics, and error paths. Full regression: native 52 integration
  / 190 negative / 116 stress + 23 CLI, all green.

### Milestone — Release v0.9.0: packaging, installers, distribution (M10) — DONE
- **CMake install target:** `cmake --install` drops `hmx` into `bin/` and the
  MIT `LICENSE` into `share/doc/hmx` (GNUInstallDirs).
- **CPack DEB:** `.deb` builds locally (`cpack -G DEB` → `hmx_0.9.0_amd64.deb`,
  depends on `gcc`, section `devel`).
- **GitHub release workflow** (`.github/workflows/release.yml`): on a `v*` tag,
  three runners — ubuntu (x86_64) → tarball + `.deb`, macos-14 (arm64) →
  tarball, windows (MSYS2/MinGW-w64) → zip of `hmx.exe` — each runs the native
  suites, then a `publish` job downloads everything and attaches the assets to
  the GitHub Release.
- **Distro-aware installer:** `install/install.sh` detects apt (`.deb` via
  `apt`), pacman (AUR via paru/yay, binary fallback), dnf (binary fallback),
  brew (macOS Homebrew), else the generic `linux|x86_64|arm64` tarball;
  `install/install.ps1` tries winget → scoop → direct zip (user PATH).
- **Repo packaging manifests:** `packaging/arch/PKGBUILD` (AUR), `packaging/brew/hmx.rb`
  (Homebrew tap `himanshu-2010/homebrew-hmx`), `bucket/hmx.json`,
  `packaging/winget/hmx.installer.yaml`. The brew `revision` and scoop/winget
  hashes are stamped at release time from the actual tag/build.
- **Docs:** README install table + refreshed CLI section; SYNTAX.md CLI
  reference; TESTRESULT.md re-run report.

### Milestone — Runtime soundness: byte arithmetic/casts, crash reporting, overflow guards (M11) — DONE
- **Byte arithmetic (finding #8):** byte promotes to `int` (`b+1`→int,
  `byte+decimal`→decimal, `byte+byte`→int, `-b`→int); `++`/`--` and compound
  `+= -= *= /= %=` wrap like `uint8` (255→0, 255→128); `byte`+`text` and
  `byte`+`char` are type mismatches (new negatives); `%` on byte allowed.
- **Byte casts:** `factor AS TYPE_BYTE / TYPE_CHAR` grammar rules (152/153,
  conflicts still 6) with runtime bounds-checked `as byte`
  (`Error: byte cast out of range (N)`, exit 1) via `sd_to_byte(double)` in
  codegen; `let c: byte = b + 1` stays a compile error (explicit cast needed);
  compile-time literal range check for `let v: byte = N` stays. `as char`
  mirrors the C `(char)` cast (wraps mod 256); char operands convert by code.
- **Crash masking (finding #2):** POSIX run path switched from `system()` to
  `fork`/`execlp`/`waitpid`; `WIFEXITED`/`WIFSIGNALED` distinguish exits from
  signal deaths → `Error: program crashed with signal N (SIGSEGV)`, exit
  `128+N` (hand-rolled `signal_name()`, no strsignal). MSVC keeps the
  `WEXITSTATUS` fallback.
- **Integer overflow (finding #7):** lexer `atoi` → `strtoll` + range check →
  `Error [line N]: integer literal 'X' out of range (max 2147483647)`, exit 1.
- **Allocation guards (finding #1):** `sd_make_array` allocates `cap*el` with
  overflow guards; `sd_push`/`sd_ensure_capacity`/`sd_split` growth
  overflow-guarded.
- **Tests:** fixtures `byte_arithmetic.hmx`, `array_push_heap.hmx`; negatives
  `int_literal_overflow`, `int_literal_overflow_big`,
  `byte_annotated_arith_mismatch`, `byte_text_mixed_arith`,
  `byte_mod_decimal`; stress `byte_arithmetic_promotion`, `byte_wrap_incr`,
  `byte_casts_and_chars`, `byte_cast_out_of_range_{high,low,var}`,
  `array_push_heap_regression`; CLI `crash reports signal + exit 139`.
- **Web parity (1:1):** `tables.json` regenerated (YYNSTATES 422 / YYLAST 1123
  / YYPACT_NINF -237 / YYNRULES 158); `lalr.ts` now reads the LALR constants
  from `tables.constants` (the old hard-code went stale under rule growth —
  tuple/array/paren/neg parses broke). `actions.ts` renumbered A[152]–
  A[158] (byte/char casts, parens, postfix, args). Resolver: byte promotion,
  compound `%=`, `NegExpr`, and AssignStmt byte-wrap annotation; codegen_js:
  `SD.toByte` + `& 0xFF` wrap; runtime: `SD.num` (char→code), `SD.toByte`
  (char-aware, range-checked), `SD.toChar` (mod-256 wrap). Lexer overflow
  path: `T.EOF`-was-undefined bug fixed by returning literal `code: 0`.
- **Hygiene:** native 396/396 (54 integration / 195 negative / 123 stress / 24
  CLI); web `tsc -b` + `vite build` + oxlint (0 errors, 11 benign pre-existing
  warnings) + vitest **380/380**; `gen-data.mts` parity 0 failures.

### Milestone — Identifier safety: global `hmx_` mangling (M12) — DONE
- **Audit #6 fixed:** the repro `let static = 5; print(static)` previously
  emitted raw `static` into C → `gcc: error: expected identifier or '(' before
  '='`; any user identifier that happened to be a C keyword (or collided with a
  `_`/`sd_*` runtime name) broke the build.
- **`safe_name()` lowering rule:** every user identifier is emitted into the
  generated C as `hmx_<name>` (injective — two user names can never collide
  with each other or with C keywords, `_`/`__`-reserved names, or the `sd_*`
  runtime helpers). `fn main()` stays C `main()`; resolver-synthesized
  `__lam_*` names pass through unmangled. `#line` directives keep compiler
  errors pointing at the original `.hmx` lines.
- **Every emission site converted** (single helper, so decls + refs match by
  construction): env-struct typedef tags/fields for closures, function
  signatures + parameter names, `emit_env_arg`/`emit_env_heap_arg`, closure
  refs `sd_make_closure((void*)...)`, direct call sites, `VarDecl`/`AssignStmt`/
  `ArrayAssignStmt`, destructuring bindings (`emit_binding`, array/text rest
  slots), `foreach` index/value names, and `for`-loop init/update components.
  Lambda `__lam_*` decls stay in sync with their ref sites; papp helpers call
  the original only through `orig.fn` function pointers (never raw names), so
  they need no change.
- **Web side already safe:** the web codegen has always mangled (`v_<name>` for
  variables, `f_<name>` for functions, `_sd_entry` for `main`) — verified the
  keyword programs already ran identically on the web; no web code change
  needed for M12.
- **Tests:** fixture `c_keyword_names.hmx` (integration); stress
  `keyword_var_and_fn_names`, `keyword_closure_loop_destruct` (exact stdout).
- **Hygiene:** native **399/399** (55 integration / 195 negative / 125 stress /
  24 CLI); web `tsc -b` + `vite build` + oxlint (0 errors, 11 benign warnings)
  + vitest **383/383** (378 parity + 5 app); `gen-data.mts` parity 0 failures
  (125/195/55).

### Milestone — Closures: transitive captures (M13) — DONE
- **Audit #4 fixed:** a nested function or lambda that references a variable
  from a grandparent (or higher) function previously registered the capture only
  on itself. When the intermediate function built/returned the inner closure as
  a function value, codegen emitted a bare identifier that didn't exist there →
  native `error: 'a' undeclared` in `hmx_middle` (gcc stage, exit 1) and web
  `ReferenceError: v_a is not defined`. Named nested-fn chains that were called
  directly happened to work because `require_capture_visibility` re-registered
  the capture at the call site; value-returned lambdas had no call site.
- **Fix:** `find_outer_symbol` now also threads the capture through every
  intermediate function between the referencing function and the owner of the
  variable. A new `outer_fns_` stack — aligned 1:1 with `outer_scope_stack_` —
  maps each enclosing function's scope group to its owning `FunctionDecl`;
  `thread_capture(name, sym, reverse_index)` registers the capture on entries
  `[N - r, N-1]`, i.e. each function in between (never the owner, which already
  owns the variable). `register_capture` was split into
  `register_capture_on(fn, ...)` so a given function (not just `current_fn_`)
  receives the capture. Codegen needed no changes — it was already driven by the
  `captures` lists (`is_capture` resolves the value out of the intermediate's env
  when it builds the inner closure's environment). Mirrored 1:1 in the web
  resolver (`outer_fns_`, `threadCapture`, `registerCaptureOn`).
- **Verified scope:** 3-level lambda capture, a function value threaded through
  two intermediates (l3→l2→l1), grandparent **parameter** capture, array-valued
  transitive captures (element index + `foreach`), text-valued captures (runtime
  concatenation), and 2→3 level named-fn chains.
- **Semantics unchanged:** still by-value snapshots, still read-only; a transitive
  capture that a use site cannot satisfy is now a proper compile error
  (`cannot call 'maker' from here: captured variable 'secret' is not in scope`)
  instead of a bogus gcc/JS runtime failure.
- **Tests:** fixture `transitive_capture.hmx` (integration); stress
  `transitive_capture_{lambda,three_level,function_value,param_and_text}`;
  negative `closures_transitive_capture_not_in_scope`.
- **Hygiene:** native **405/405** (56 integration / 196 negative / 129 stress /
  24 CLI); web `tsc -b` + `vite build` + oxlint (0 errors, 11 benign warnings)
  + vitest **389/389** (384 parity + 5 app); `gen-data.mts` parity 0 failures
  (129/196/56).

### Milestone — Modules: top-level state (M14) — DONE
- **Audit #5 fixed:** the module loader (`load_module_uses` in `main.cpp`)
  merged only `FunctionDecl`s into the entry program, silently dropping any
  top-level `let`/`const` in a module → `undefined variable 'PI'` at every use
  site. Module top-level state is now real program state.
- **Post-order merge:** modules contribute **all** top-level statements —
  functions AND state declarations (and any init statements like top-level
  `print`) — collected **dependencies-first** (a module's own statements come
  after every module it `use`s, transitively) and inserted **before** the entry
  file's own statements. Result: module init sections run in `use` order,
  dependency state is initialized and visible before dependents read it, and
  everything executes before `main`'s body. Mirrored 1:1 in web `program.ts`.
- **Two-phase top-level registration (native + web resolver):** `resolve()`
  runs pass 1 registering every top-level `VarDecl`/`DestructDecl` (entry +
  modules, in program order, resolving initializers for type inference) before
  pass 2 resolves any function body. Any function in any file can therefore
  reference any top-level state regardless of file/order — including module
  functions reading entry-file state and entry functions reading module state.
  New `resolve_var_decl`/`resolve_destruct_decl` (native + `resolver.ts`)
  extracted from the old inline branches; pass 2 skips the pre-registered
  statements.
- **Diagnostics + hygiene:** `VarDecl`/`DestructDecl` gained a `file` field
  (`assign_file`/`stampFile` extended) so module-state errors cite the module
  path + line and codegen `#line` stays accurate. The codegen env-build sites
  cast each captured value to its env-struct field type, so capturing a `const`
  text/array (module `const` state) no longer trips gcc
  `-Wdiscarded-qualifiers` on stderr.
- **Semantics locked in SYNTAX.md §1.6:** top-level state shares one namespace
  (duplicates rejected); functions see it by value (read-only, like local
  closure captures); top-level *initializers* follow program order (forward
  refs are `undefined variable`, while function bodies may see any top-level
  state).
- **Tests:** fixture `top_level_state.hmx` (entry two-phase + forward fn refs +
  top-level destructure); integration `mod_state`, `mod_state_dep`,
  `mod_state_entry_to_module`; stress `mod_top_state`,
  `mod_top_state_init_order`, `mod_top_state_dep`; negative
  `module_top_state_type_err` (module-file attribution),
  `module_top_state_dup` (cross-module duplicate), and
  `module_top_state_forward_ref` (init order within a module).
- **Hygiene:** native **415/415** (60 integration / 199 negative / 132 stress /
  24 CLI); web `tsc -b` + `vite build` + oxlint (0 errors, 11 benign warnings)
  + vitest **399/399** (394 parity + 5 app); `gen-data.mts` parity 0 failures
  (132/199/60).

### Milestone — Reference-counted allocator (M15) — DONE
- **Audit #3 fixed (no deallocation anywhere):** the generated C runtime now
  reference-counts every heap value — `sd_str`, `sd_array` (via `sd_abuf`
  buffers), tuple members and `sd_closure` environments — with paired
  `retain`/`release` helpers (`sd_ret_*`/`sd_rel_*` per type slot) emitted by
  codegen around every temporary, binding and call.
- **Ownership rules (locked in SYNTAX.md §16):** locals own; params are
  borrowed (callee never releases; a callee that returns a borrowed value
  retains — fixes `let y = f(g())`); the caller releases fresh argument
  temporaries after each call; `return` transfers only bare-identifier owned
  locals, all other heap returns retain (tuples always retain); scope exits
  and returns release owned locals; statement-only `push`/`sort` release the
  retained argument result they hold (ExprStmt special-cases them).
- **Sharing + views:** `let b = a` / `b = a` alias-share the struct pointer
  (mutations visible — web parity); `substring`/`slice` return O(1) **views**
  pinned by refcount; `sd_array_slice` retains its range's elements; `pop`
  transfers the popped element; `sd_push` retains heap elements on the new slot
  and the push emission releases its held temp. `sd_detach` copy-on-write
  forks a private copy of the *view's* range (`a->data`, view-offset aware)
  and **moves** element refs rather than double-counting them; the grow path in
  `sd_push` copies from `a->data` too, so pushing onto a view is safe even
  after the source died.
- **NUL-safety (views are not NUL-terminated):** `sd_str_equals`/`sd_str_cmp`
  compare by length + memcmp (sort/find/index_of/`==`/`!=` lowered to them),
  printing uses `%.*s` + `(int)len`, `sd_parse_int`/`sd_parse_decimal` parse
  NUL-copies and report `%.*s` errors, and `sd_split` bounds every memcmp scan
  with `hay_end = data + len`; `sd_concat` copies `b->len` bytes and NUL-terminates.
- **Gates added:** `HMX_ASAN=1` environment hook in `main.cpp` appends
  `-O1 -g -fsanitize=address -fno-omit-frame-pointer` to the gcc command
  (ASan aborts on UAF/overflow; LSan exits 23 on leaks — the stress runner's
  `2>&1` comparison only diverges when a real error prints). New
  `.github/workflows/ci.yml` runs **build-test** (4 native suites),
  **asan** (integration + stress under `HMX_ASAN=1`), and **valgrind**
  (new `tests/run_valgrind_tests.sh`: `hmx build` then valgrind **directly on
  the generated binary** — never the compiler — with
  `--quiet --error-exitcode=99 --leak-check=full
  --errors-for-leak-kinds=definite,indirect,possible`).
- **Tests:** fixtures `text_views.hmx` (view consumers: `==`/`parse`/`split`/
  `foreach`) and `cow_and_alias.hmx` (alias visibility + COW isolation + push
  on a view); stress `m15_refcount_lifecycle` (100-iteration create/discard
  churn — leak gate under ASan), `m15_view_consumers` (sort/index_of/contains/
  `==`/concat over shared views), `m15_param_borrow` (param reassignment leaves
  the caller's value intact + alias/COW); negatives `runtime_split_empty_sep`,
  `runtime_slice_oob`, `runtime_parse_int_invalid`,
  `runtime_parse_decimal_invalid` (byte-identical stderr on web).
- **Hygiene:** native **424/424** (62 integration / 203 negative / 135 stress /
  24 CLI), ASan-clean integration + stress + negative; valgrind matrix
  **66/66**; web `tsc -b` + `vite build` + oxlint (0 errors, 11 benign
  warnings) + vitest **408/408** (403 parity + 5 app); `gen-data.mts` parity
  0 failures (135/203/62).

### Milestone — Structs, enums & type aliases (M16) — DONE
- **Three new top-level declarations** (SYNTAX.md §17–19): `alias NAME = TYPE`,
  `struct NAME { field: TYPE ... }`, `enum NAME { VARIANT ... }`. Types live in
  one flat top-level namespace with functions and variables, and are rejected
  inside function bodies (`type declarations are only allowed at the top level`).
- **Two-phase resolution (forward references allowed):** the resolver runs
  `collect_type_decls` + `expand_type_refs` *before* collecting functions, so a
  type may be used in an annotation, parameter, return type, `struct` field, or
  constructor call before it is declared. `expand_desc` / `resolve_named` cache
  each declaration, so a cycle is reported once by name:
  `alias cycle detected involving type 'A'`, `struct type 'S' cannot contain
  itself by value` (an array/function field that mentions its own struct is
  fine — the `by_value` flag is what separates the two).
- **Nominal identity:** `TypeDesc` gained `type_name`; `TypeKind::Struct` /
  `Enum` compare by name in `type_desc_equals` / `types_match`, while aliases
  expand away to the target descriptor (`alias Orientation = Suit` *is*
  `Suit`, transparent, no wrapping). A type name colliding with a function or
  variable is an error.
- **Native codegen:** a struct lowers to C `struct hmx_<Name> { f0 … fN }`; a
  constructor is a compound literal that *moves* its arguments. Heap fields
  retain/release exactly like tuple members (`type_has_heap`,
  `slot_ret_name`/`slot_rel_name`), so a struct copy shares its `text`/array
  storage and copies nested struct/tuple fields by value — `let p2 = p1;
  p2.y = 99` leaves `p1.y` alone while a shared array stays shared. Enums are
  plain `int` ordinals with no runtime representation; the ordinal is
  materialized at the member-access site.
- **Web codegen:** struct and tuple values are plain JS arrays, so a *shallow*
  `SD.copy` was observably wrong (it aliased nested aggregates, so
  `shift(v, 3)` mutated the caller's `v`). Replaced by a type-directed copy:
  generated hoisted `_sd_cp_<mangle>(s) { return [ <slot or recursive copy> ]; }`
  helpers, where a struct mangles to `st_<TypeName>` and a tuple to
  `tp_<members>`; nested aggregate slots copy recursively, `array`/`text`/
  function slots stay shared — the exact shape of C's by-value copy. Copies
  happen at the C pass-by-value boundaries (`copyIfValue`), tracked with a
  codegen-side descriptor scope stack (`pushScope`/`recordVarDesc`/
  `varDescOf`/`paramDescOf`/`descOfExpr`).
- **Locked enum rules:** implicit enum→int only where an `int` is consumed
  (`print`, array index, `switch` subject, one operand of an arithmetic or
  relational operator against an `int`). `enum ⊕ enum`, the logical operators,
  `==` against an `int`, `let c: Color = 1`, `let n: int = Color.Red`, and
  compound assignment to an enum variable or field are all errors. `==`/`!=`
  are same-enum only, so nominal identity is enforced at the operator. Structs
  have no `==`, no `print`, no `length`, no destructuring, and no arithmetic.
- **Two resolver gaps closed while writing the spec tests:** a function-typed
  struct field is now readable (`expr_function_type` gained a
  `MemberAccessExpr` case, so `let f = op.apply` infers instead of erroring
  with "initialized with function"), and a repeated variant name inside one
  enum is now `duplicate variant 'Red' in enum 'Color'` instead of silently
  shadowing the earlier ordinal.
- **Grammar:** `factor: IDENTIFIER` split into `postfix_index: IDENTIFIER` +
  a call factor so member access composes with `[]`/`.`; `postfix_index DOT
  IDENTIFIER <op>` added for member assignment. 9 shift/reduce conflicts (was
  6) — all benign, all resolved by shift. 179 rules / 471 states / 46
  nonterminals; web `tables.json` regenerated.
- **Ownership fix found by the new valgrind matrix cases:** a struct parameter
  arrives by value, so its field slots are borrowed from the caller's argument
  temp — but the member-assign path released the old field unconditionally, so
  `fn f(b: Bag) { b.label = "x" }` dropped a reference the callee never owned
  (heap-use-after-free, caught by ASan/LSan). The member-write lvalue now
  resolves through its field-read chain to a borrowed parameter
  (`member_write_borrowed_param`) and promotes it to an owned copy first
  (`declare_param_owned` + `sd_ret_hmx_<Name>`), the same treatment a
  whole-parameter reassignment already got. An array index in the chain stops
  the search — the array owns its elements. `type_has_heap` became const. The
  web needed no change (a JS array slot is just overwritten, and the call site
  already copies the arg).
- **Tests:** fixture `m16_structs_enums.hmx` (nested structs, enum arrays,
  switch on an enum, closures over structs, foreach over a struct field,
  function-typed fields, value-copy semantics); integration `mod_m16_types`
  (cross-module types); stress `m16_struct_refcount` (shared-buffer
  semantics), `m16_enum_switch`, `m16_struct_conditional_alias`,
  `m16_struct_return_chain`, `m16_param_field_write`, `m16_struct_fn_field`,
  `m16_mod_struct_enum`; valgrind matrix `struct_field_heap` +
  `enum_alias_ownership`; 35 negatives `m16_*`.
- **Valgrind run locally (valgrind 3.25.1):** `--fixtures` is **69/69** clean
  (14 matrix cases + all 55 fixtures). The first run caught a test regression
  rather than a codegen one — M16 reserved `alias`, and the M15 matrix case
  `array_of_arrays` used `alias` as a variable, so it stopped compiling
  (renamed to `shared`). Three negatives
  (`m16_reserved_{alias,struct,enum}_ident`) now lock the new keywords as
  reserved so the same mistake fails loudly instead of silently.
- **Hygiene:** native **468/468** (64 integration / 238 negative / 142 stress /
  24 CLI), ASan+LSan-clean on integration and stress; web `tsc` ✓ +
  `vite build` ✓ + oxlint (0 errors, 11 benign warnings) + vitest **452/452**
  (447 parity + 5 app); `gen-data.mts` parity 0 failures (142/238/64); valgrind
  **69/69** (14 matrix cases + all 55 fixtures).

## Non-local exit: `volatile` locals (setjmp clobber fix)
- **Bug:** a loop that a nested function `break`s/`continue`s out of is generated
  with a `setjmp` in the owning function and a `longjmp` in the nested one. C11
  7.13.1.1p4 then makes every **non-volatile** automatic object of the
  `setjmp`'s function that changed in between **indeterminate**, so the loop
  counter is not guaranteed to survive. gcc happens to spill such locals; clang
  keeps them in registers and the value is gone. Surfaced only on the new macOS
  portability CI job: `nonlocal_break_loop` printed 1 (expected 2),
  `nonlocal_break_while` 6 (7), `nonlocal_break_dowhile` 3 (4). The generated C
  was UB, so this was a latent miscompile on any clang target, not a macOS bug.
- **Fix:** codegen now marks every local of a function whose body emits a
  `setjmp` as `volatile` (scalars, `T* volatile` pointers, by-value tuple /
  struct / closure / enum locals), and so does the `for`-init variable, which is
  such a local too. Functions that emit no `setjmp` are untouched, so no
  generated C changes for ordinary programs.
  - The set of such functions comes from the resolver's existing
    `Statement::nl_target` flag — a loop is `nl_target` exactly when a nested
    function exits it — so this needed **no resolver change** and no web
    mirror. The flag is read inside the existing `collect_lambdas_stmt` walker
    (one line) rather than a second traversal, so the two can never drift: the
    walk that finds every lambda and nested function is the same one that now
    finds every `setjmp` loop. It over-approximates (a nested function's targeted
    loop also marks its enclosing function), which is the safe direction.
  - Placement matters: `volatile T* p` is a pointer to a volatile `T`, but only
    `T* volatile p` — a volatile *pointer* — preserves the local's own value
    across a `longjmp`, which is the whole point. The qualifier is therefore
    always emitted *after* the C type text.
  - A `volatile` local's address is `volatile T*`, which does not convert to the
    `T*` the generated `sd_rel_*` release helpers take, so `emit_release_value`
    emits an explicit `(T*)&slot` cast for those. Dropping the qualifier at the
    release site instead would reintroduce the exact bug the qualifier fixes.
    `declare_owned` records the flag per scope entry so shadowing resolves
    innermost-first, like `find_var_desc`.
- **Tests:** stress `nonlocal_heap_locals` (**new**) — `text` / array / `struct`
  locals mutated across a nested-fn `break`, i.e. the release-cast path; the seven
  existing `nonlocal_*` cases now assert against clang on every CI platform.
  Verified the fix directly: the five loop forms give the expected value under
  both gcc and clang where the pre-fix C gave an indeterminate one, and a
  program exercising every local kind inside a `setjmp` function compiles clean
  under `gcc -Wall -Wextra` and `clang -Wall -Wextra` with zero
  volatile-qualifier warnings and valgrind-clean refcounts.
- **Hygiene:** native **470/470** (64 / 238 / 143 / 25), ASan+LSan-clean on
  stress; web vitest **455/455** (448 parity + 7 app), `gen-data.mts` parity
  0 failures (143/238/64), `tsc` ✓, oxlint 0 errors; valgrind **69/69**.
  (This entry also re-snapshots `tests/data/negative.json`, whose module-path
  patterns still carried the pre-`[/\\]`-separator text.)

## The container image was never actually published under a usable tag
Three independent defects, found in sequence once the tag bug was fixed. Each
one masked the next, which is why the image job had been red on every push
without any of them being visible.
1. **`tags=` collapsed to one value.** `$GITHUB_OUTPUT` holds one value per
   key, so writing `tags=` three times kept only the last. The image was built
   and pushed as `hmx-lang:sha-<short>` alone — `:0.10.0` and `:latest` never
   existed, which is every tag a person would actually pull. GHCR has only ever
   held the throwaway sha tags. Fixed with the documented `tags<<EOF` heredoc
   form, and the (now multi-line) list is handed to the smoke test through
   `env:` rather than spliced into the `run:` body.
2. **The smoke test reported Docker's fault, not its own.** It recovered the
   tag with `sed 's#^tags=##p'` against a step output that no longer carried
   the prefix, so the tag was empty and `docker run` failed with "invalid
   reference format". It now fails with a named cause before reaching Docker.
3. **The image ran as uid 1000 against a uid-1001 mount.** `hmx run` writes
   `build_temp.c` into the working directory, so the runner's `/tmp` dir was
   unwritable for the container user. The image was fine; the *test* was
   wrong. The smoke test now passes `--user "$(id -u):$(id -g)"`, which is
   what a real caller does and is what makes `-v "$PWD:/src"` work. The
   Dockerfile and README document the uid requirement.

Fixing (3) exposed two real compiler bugs, both now fixed in `src/main.cpp`:
- **An unwritable working directory produced a misleading error.** The
  `ofstream` for `build_temp.c` was never checked, so the write failed
  silently and gcc reported `cc1: fatal error: build_temp.c: No such file or
  directory` — blaming the C compiler for a filesystem problem. Now reported
  as what it is, naming the cwd, and noting that `-o` moves only the output
  binary and not the `.c` file.
- **An unreadable source file aborted the process.** `std::filesystem::exists`
  and `weakly_canonical` throw on a stat failure, so a path whose parent
  directory cannot be traversed (precisely the bind-mount case above) died
  with an unhandled `filesystem_error` and a `terminate` — no diagnostic at
  all. Every `std::filesystem` call on a user-supplied path now uses the
  `error_code` overloads and reports the failure.
- **Tests:** two CLI cases (unwritable cwd named as such; unreadable source a
  diagnostic and not an abort, asserted on the *absence* of `terminate called`
  because an abort also exits non-zero), plus 11 static packaging checks
  covering the heredoc form, the absence of repeated output keys, the `env:`
  plumbing, the `--user` flag and the named-cause guard. The container workflow
  additionally asserts the unwritable-cwd diagnostic from inside the image, so
  the two fixes stay tied together.
- **Hygiene:** native **472/472** (64 / 238 / 143 / 27), valgrind **69/69**,
  ASan+LSan-clean on integration and stress; web vitest **455/455**,
  `gen-data.mts` parity 0 failures, oxlint 0 errors; packaging **48/51** (the 3
  remaining are the PKGBUILD / Scoop / winget digests, which need the release
  to exist). Verified all three container cases against a locally built image
  with a deliberately mismatched uid.

## A generated-C warning that only one compiler reports
With the container job green, the last macOS failure was not a wrong answer at
all: `m15_refcount_lifecycle` produced the *correct* stdout plus one stray
`-Wunused-value` line on stderr, and the stress suite compares the two
separately. The line came from `pop(tmp)` used as a statement — `pop` has to
release the array it pops from, so codegen emits it as a GNU
statement-expression, and a statement-expression used as a statement is an
unused value.

gcc does not warn about this. clang does, so it appeared only on the macOS
runner, where it had been hiding behind the three `nonlocal_break_*` failures
all along. It is a warning no HMX user can act on (there is no warning
channel), printed onto stderr that their program is supposed to own.

- **Fix:** an HMX expression statement's value is *always* discarded, so say so
  in C — the scalar expression-statement path now emits `(void)(...);`. The
  two heap paths are untouched: they end in a void release call, so their
  statement-expressions are void-valued and never warned about.
- **Gate:** a new CLI case compiles the emitted C with `-Werror=unused-value`
  under **every** host compiler, not just the first one found. That detail is
  the whole point: taking only `cc` means gcc — which never warns — hides the
  regression on the very platform whose silence caused it. Verified by
  reverting the cast and watching the clang case turn the suite red.
- **Hygiene:** native **475/475** (64 / 238 / 143 / 30), valgrind **69/69**,
  ASan+LSan-clean; web vitest **455/455**, `gen-data.mts` parity 0 failures;
  packaging **67/67**.

## `[ "$x" != "PREFIX"* ]` is not a prefix test
The two new CLI cases were guarded with

    [ "$(uname -s)" != "MINGW"* ] && [ "$(uname -s)" != "MSYS"* ] && ...

and still ran on the msys2 Windows runner, failing with `exit=0` — `chmod 555`
is a no-op on a Windows filesystem, so both cases passed vacuously. The guard
was wrong, not the pattern list: when a glob matches nothing, bash leaves the
word in place but marks it **quoted**, so `test` compares it literally.
`[ MINGW64_NT-10.0-26100 = MINGW* ]` is false in bash 5.3, while
`case MINGW64_NT-10.0-26100 in MINGW*)` matches. The `case` form — already used
correctly by the signal-death guard a few lines up, and the only one that
matched in the CI log — is what works.

So this was a guard that reported a platform as POSIX while running on Windows,
which is worse than no guard: the suite looked covered and was not. Fixed by
using `case` for all three prefixes. Verified both ways — the two cases run and
pass on Linux, and are skipped under a stubbed `uname -s` of
`MINGW64_NT-10.0-26100` — and by diffing the full pass list between the two, to
confirm nothing *else* was skipping silently.

## `#line` filenames were not escaped, and the symptom was on stderr
With the CLI suite green, six module stress tests failed on Windows while
printing the *correct* program output. The extra text was the C compiler's:

    #line 2 "D:\a\_temp\...\main.hmx"
          warning: unknown escape sequence: '\_'
          warning: unknown escape sequence: '\h'

`#line`'s filename is a C string literal, and a Windows path is mostly
backslashes, so C parses `\h`, `\m`, `\a` as escapes. The compiler answers on
stderr, and `hmx run` lets the C compiler's stderr through, so it landed on the
program's stderr — which the stress suite compares byte for byte. Every test
involving a module failed for that reason and nothing else.
`emit_line_directive` now doubles the backslash. Escaping it (rather than
normalising to forward slashes) also means gcc echoes back the path the user
actually typed, instead of one containing a bell character.

The check runs on **Linux**, not Windows, which looks backwards until you notice
that Windows cannot hold a backslash in a filename at all. A backslash is a
perfectly legal character in a Linux filename and the emitted C is identical
either way, so this is the one place the case can be constructed on every run.
Verified by reverting the escaping and watching all three host compilers fail.

## The release shipped with no `.deb`, and every glob that should have
## noticed matched nothing
The first real `v0.10.0` release published cleanly: four green jobs, three
platform archives, a `SHA256SUMS` that verifies. Listing the assets showed three
archives and the sums file. The `.deb` was not there — and `install.sh` resolves
`hmx_0.10.0_amd64.deb` with `curl -fsSL` as its *primary* Debian/Ubuntu path, so
the flagship Linux install was a hard 404.

The cause is the quietest kind of CI failure there is:

    (cd build && cpack -G DEB)              # writes build/hmx-0.10.0-Linux.deb
    mv "hmx-...-Linux.deb" "hmx_..._amd64.deb"   # ...still inside build/
    ...
    path: |
      hmx*.tar.gz        # relative to the workspace root — matches
      hmx*.zip           # relative to the workspace root — matches
      hmx*.deb           # relative to the workspace root — matches NOTHING

The tarball and zip are created from the workspace root so they match; the `.deb`
is created inside `build/` and stayed there. `actions/upload-artifact` treats an
unmatched glob as a *warning*, so with three patterns where two match, nothing is
reported. And `publish`'s `fail_on_unmatched_files: true` only guards
`dist/**` — which matched, because the other two archives were in it. Every layer
was correct in isolation and the combination shipped a release missing a file the
README promised.

Fixed on three levels, because each catches a different mistake:
- move the `.deb` up to the workspace root next to the other archives, and
  `test -f` it — a missing build product fails the step that should have made it;
- `if-no-files-found: error` on the upload, so a platform that produces *nothing*
  at all is an error rather than an empty artifact;
- a runtime assertion in `publish` that names all five expected assets and also
  rejects unexpected ones, so a rename cannot slip past either. Verified by
  running that exact assertion against the real published asset list — it reports
  the missing `.deb` and exits 1, i.e. it would have caught the release that
  actually shipped.

## The PKGBUILD was checking a tarball it never built from
With the release out, the three manifest digests could be pinned at last. Filling
them in exposed a second quiet bug: the source tarball's top directory is
`himanshu-2010-hmx-lang-500dfa6` — repo name plus commit — while `_src()`
returned `${srcdir}/hmx-lang`. So the lookup missed, `prepare()` fell through to
its `git clone`, and every build used the clone while `makepkg` had verified the
`sha256sums` of a tarball that went unused. `_src()` now locates the tree that
actually contains `CMakeLists.txt` instead of guessing its name; both branches
were checked against a simulated `srcdir`.

Also split the dependency lists honestly: `depends=(gcc)` only, with flex, bison,
cmake, ninja and git in `makedepends` — Arch installs runtime deps on the user's
machine permanently, and none of those are needed to *run* hmx. The packaging
check for this was passing for the wrong reason: `depends=\(.*flex` also matches
`makedepends=(`, because `.*` spans the entries in between. Anchored to `^depends=`
and paired with a `reject` for each build tool, and verified by putting flex back
into the runtime list and watching the three new checks fail.

## The documented Arch one-liner installed a tmux theme
With the release finally complete, the natural end-to-end test of the primary
install path is to run it. On this machine — Arch with `yay` — it built and
installed **`honeymux-bin` 0.109.1**, *"a new UX layer for the terminal, built on
tmux"*, unprompted, from the README's own one-liner.

The cause is that an AUR helper resolves `-S <name>` by **fuzzy match**, not by
exact name. `hmx` is not in the AUR (nothing is — the submission is still
outstanding), so `yay -S --noconfirm hmx` resolved to the closest thing it could
find and installed it. `--noconfirm` removed the last checkpoint.

The prebuilt tarball is published, needs no AUR, and works today, so the fix is
not to make the AUR path smarter but to stop guessing on its behalf: ask the AUR
RPC whether the exact name exists, and only hand off on a positive answer.
Anything else — absent, or unreachable — installs the verified tarball. Verified
all three states against the real AUR, a blackholed RPC, and a faked
`resultcount:1` response.

The check for `resultcount` had a bug of its own, and an instructive one: it
matched `"resultcount": 1` with a space, which is how `python -m json.tool`
*prints* it. The AUR emits `"resultcount":0` compact, so the pattern matched
nothing — indistinguishable from the AUR being down, and it would have kept
installing the tarball for entirely the wrong reason, forever. The pattern now
tolerates either spacing.

The packaging gate for this asserts the guarded *form* of the hand-off, not the
presence of the word `aur_has_hmx` — which also appears in the function's own
definition, so the first version of the check passed with the guard deleted.
Confirmed by deleting it and watching that one check fail.

- **Hygiene:** native **478/478** (64 / 238 / 143 / 33), valgrind **69/69**,
  ASan+LSan-clean; web vitest **455/455**, `gen-data.mts` parity 0 failures;
  packaging **73/73**.

## Running `makepkg` found three bugs that reading the manifest never would

The AUR manifest had been reviewed, digested against a release, and gated by
`run_packaging_tests.sh` — 91 checks green — and it still could not build. All
three bugs were invisible to review because each one is locally plausible.

**1. The file was not named `PKGBUILD`.** It was committed as `PKBUILD`. Two
distinct consequences: `makepkg` requires the exact filename, so no AUR build
could ever have started; and the submission instructions, both in the manifest's
own header and in the docs, said `cp packaging/arch/PKGBUILD .`, which is a path
that did not exist. The packaging gate agreed with the mistake rather than
catching it, because every check referenced the same wrong path — a gate that
reads the file it is testing cannot notice the file is misnamed. There is now an
explicit check that the file exists under the name `makepkg` wants, built from
`chr(71)`-style construction so the assertion is about bytes and not about
whether anyone typed the letter correctly.

**2. The pinned digest was for a different artifact.** GitHub serves two tarball
endpoints for one tag and they are not the same bytes:

```
/archive/refs/tags/v0.10.0.tar.gz   root hmx-lang-0.10.0/                bafbf002…   <- what the PKGBUILD fetches
/tarball/v0.10.0                   root himanshu-2010-hmx-lang-501188f/   50323ddb…   <- what `gh api` returns
```

The pinned value was `50323ddb`, taken from the `gh api` call, and `makepkg`
rejected the download at `Validating source files with sha256sums`. This also
corrects the previous entry: the top directory it describes,
`himanshu-2010-hmx-lang-500dfa6`, is the `/tarball/` root, not what this
PKGBUILD downloads. The `_src()` fix from that entry is unaffected and still
correct — locating the tree that contains `CMakeLists.txt` is right for either
root — but the reason it was needed was the endpoint, not a bad name.

**3. `package()` passed a flag that does not exist.** It ran
`cmake --install build --destdir "$pkgdir"`. There is no `--destdir`;
`DESTDIR` is an environment variable, and `cmake --install` aborts with
`Unknown argument`. This is the worst of the three, because it is the last step:
the source downloads, the digest verifies, nine objects compile, `hmx` links,
and `check()` reports `packaging check ok` — then packaging fails. Every gate in
this repo is a check on text, and no textual check can see that a flag is
missing from an external tool's CLI.

After all three: `hmx-0.10.0-1-x86_64.pkg.tar.zst` builds, contains
`usr/bin/hmx` plus the licence, declares `depend = gcc`, and that binary
transpiles and runs a program. The manifest's header now carries the extraction
procedure as a runnable snippet, and that snippet was extracted from the document
and executed rather than eyeballed — its first two versions were wrong, pulling
the `url=` line instead of `source=(` (a 14-byte download) and leaving
`${pkgver}` unexpanded.

Reads like a list of unrelated slips, but the shape is identical in all five: a
locally plausible line of code that no review question catches, because a
manifest is read as text and text that looks right is right as far as reading
goes.

## Two more installer bugs, found by reading rather than running

Both are in `install.ps1`, and both are ways of claiming success.

`$ErrorActionPreference = "Stop"` is set at the top of the script, which reads
like blanket protection. It is not: it escalates *cmdlet* errors and does nothing
for a native command's exit code. `winget` and `scoop` are native commands, so a
failed install only set `$? = $false` and fell straight through to
`Write-Hmx "installed via winget!"` and `exit 0`. No preference variable fixes
it — `$PSNativeCommandUseErrorActionPreference` is PowerShell 7.4+, defaults to
`$false`, and the invocation in this file's own header is `powershell`, i.e.
Windows PowerShell 5.1, which does not have the variable at all. Testing
`$LASTEXITCODE` and `throw` does work, because a `throw` is catchable.

Separately, both installers treated a missing `SHA256SUMS` as a warning and
installed anyway — three lines below `install.sh`'s own header promising that
"an unverified binary is never installed". Every release ships the sums and the
release workflow asserts it, so absence is a fault rather than an option. Both
now refuse. Verified against a stub server serving the real asset with the sums
withheld, with sums that lack an entry, and with a tampered asset: all three
refuse, and the clean case still installs.

## This repo is now a real scoop bucket

`scoop bucket add <repo>` registers the repo, and scoop then looks for
`<repo>/bucket/<app>.json`. The manifest lived at `packaging/scoop/hmx.json`, so
`bucket add` registered a bucket that could never resolve — leaving a broken
bucket on any Windows machine that ran the installer with scoop present. Moved
to `bucket/hmx.json`, with a gate that it is there and that no second copy
exists to drift.

## The brew formula: run it, minus the part that needs Homebrew

`himanshu-2010/homebrew-hmx/Formula/hmx.rb` had never been executed in any form.
There is no brew and no ruby on the build box, so reading it was the only option
available — and reading is exactly what let the PKGBUILD's three bugs through.

But the formula is three `system` calls and one `assert_match`. All of that is
runnable without Homebrew, so it was run: `git clone --depth 1 --branch v0.10.0`
(what `url …, tag:` makes brew do), then the three `system` calls from
`def install`, then the `test do` assertion.

```
501188f, matching tag: "v0.10.0"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release   ok
cmake --build build                            [100%] Built target hmx
cmake --install build --prefix <prefix>        bin/hmx + share/doc/hmx/LICENSE
hmx --version                                  hmx 0.10.0     ← test block passes
```

The `test do` block only checks the version string, so the check it omits was
added: the installed binary compiling and running a `for` loop over an array
(`sum of squares: 14`). `--prefix` is a genuine `cmake --install` flag, which is
the sort of thing that is worth knowing rather than assuming given what the
PKGBUILD was doing with `--destdir`.

Two new gates, for the two traps the formula's own comments warn about: the
`caveats` block must keep naming the runtime C compiler (brew's gcc is keg-only,
so `depends_on "gcc"` puts nothing on `PATH` — drop the caveat and the install
succeeds into an `hmx` that cannot compile), and no `revision:` may reappear
(a stale one makes brew fail with "revision is no longer part of the
repository"). The `revision:` control initially did not fire, because the
pattern required a quote and the first version I inserted was unquoted; widened
to `\b` and confirmed against both spellings.

What this still does not cover: it ran on Linux, and it skipped Homebrew's own
wrapper. On a real Mac, brew's prefix is `/opt/homebrew`, there is no bottle so
every install is a source build, and the keg-only gcc means the `caveats` text is
the user's only clue. Five minutes with a Mac closes it.

## "Installed" was never the same claim as "usable"

Chasing the keg-only gcc remark in the brew formula turned up a gap that has
nothing to do with brew. `hmx` does not contain a C compiler — it emits C and
shells out to one on every run. So an install that succeeds on a machine with no
`cc`, `gcc` or `clang` yields a working `hmx --version` and a first program that
will not build.

`install.ps1` carried a static sentence about this, which is the kind of thing
that is technically a warning and practically invisible. `install.sh` said
nothing at all. Both now probe, and `require_cc` in install.sh names the remedy
for the machine it is actually on — `apt`, `dnf`, `pacman`, `apk`,
`xcode-select --install`, or the WinLibs UCRT under msys2 — because the first
draft listed all of them unconditionally and led with macOS advice on Linux,
which makes the reader do the matching themselves. Verified across nine
combinations: each platform gets its own line, and the function stays silent
when any of the three compilers is present.

The gate for it initially did not bite. The pattern matched the tool names, and
the *warning text* contains the tool names, so deleting the probe left the check
passing — the same trap as the AUR hand-off check, and the second time it has
happened in this repo. Asserting the lookup itself (`Get-Command $_` /
`for c in cc gcc clang`) fixed it, and both controls then failed as they should.

- **Hygiene:** native **478/478** (64 / 238 / 143 / 33), packaging **130/130**,
  valgrind **69/69**, ASan+LSan-clean; web vitest **455/455**, `gen-data.mts`
  parity 0 failures. Every new check was confirmed by reintroducing the bug it
  covers.

## Known issues / deferred
- if/loop/while/for/do-while/return block line numbers point at closing brace (cosmetic).
- `return` followed immediately by `IDENTIFIER = ...` or `(a, b) = ...` on next line misparses (return expr wins via shift); acceptable edge case.
- bison emits nine harmless shift/reduce conflicts across 7 states, all resolved by shift:
  the `return expr` vs bare `return` ambiguity (2, on `IDENTIFIER` and `(`), the
  `postfix_index: IDENTIFIER •` indexing/assignment/call ambiguities (4 — 3 on `[`,
  1 on `(`), and the unary `not` / `+` / `-` prefix vs `factor AS` ambiguity (1 each).
- Duplicate declarations and missing definite returns are rejected by the type resolver.
- `else if` chains are implemented and covered by `else_if.hmx`.
- Ternary expressions, explicit numeric casts, and immutable `const` bindings are implemented.
- Closures: calling an immediately-returned function value (`make()(x)`) is not parseable —
  use `let g = make(); g(x)`. Direct forward calls to capturing functions defined later
  are not capture-validated (works when the captured var is in scope at the call site;
  otherwise a gcc-stage error is accepted). Capturing functions can't be recursive refs
  through fn-value types (identical closure types only); recursion works via direct calls.
- Tuple element assignment (`t[0] = x`) is not supported (per SYNTAX.md §5.4).
- Parenthesized arithmetic grouping is fixed (0.A8); empty block bodies `{}` remain
  unparseable — `stmt_list` requires ≥ 1 statement, and the empty production was
  rejected after it inflated bison conflicts 6 → 342 (documented limitation).

## Relevant files
- `src/lexer.l`, `src/parser.y`, `src/ast.hpp/cpp`, `src/type_resolver.hpp/cpp`, `src/codegen.hpp/cpp`, `src/main.cpp`
- `tests/fixtures/*.hmx`, `tests/run_integration.sh`, `tests/run_cli_tests.sh`
- `install/install.sh`, `install/install.ps1`, `packaging/`, `.github/workflows/release.yml`
- `PLAN.md`, `SYNTAX.md`
