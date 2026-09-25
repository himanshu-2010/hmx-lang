# HMX Compiler — Progress Log

Last updated: 2026-09-25
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
- Closures: calling an immediately-returned function value (`make()(x)`) is not parseable —
  use `let g = make(); g(x)`. Bare tuple literals (`let t = (1, 2)`) are not in the grammar;
  get tuples from function returns. Direct forward calls to capturing functions defined later
  are not capture-validated (works when the captured var is in scope at the call site;
  otherwise a gcc-stage error is accepted). Capturing functions can't be recursive refs
  through fn-value types (identical closure types only); recursion works via direct calls.

## Relevant files
- `src/lexer.l`, `src/parser.y`, `src/ast.hpp/cpp`, `src/type_resolver.hpp/cpp`, `src/codegen.hpp/cpp`, `src/main.cpp`
- `tests/fixtures/*.hmx`, `tests/run_integration.sh`
- `PLAN.md`, `SYNTAX.md`
