# Stardance Compiler — Progress Log

Last updated: 2026-09-03
## Objective
Implement the Stardance transpiler's 8-phase plan (from `PLAN.md`) so users can write full hello-world-capable programs. Multi-stage pipeline: lexer → parser → type resolution → codegen → gcc.

## Build / Test
- Build: `cd build && cmake .. && make` (workspace: `/home/himanshu/Documents/hack-club/stardance`)
- Tests: `./tests/run_integration.sh` runs `tests/fixtures/*.hmx`; fixtures must exit 0.
- CLI: `./build/stardance run|build <file.hmx> [-keep-c]`
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
  Stardance source.
- Fixtures: `for.hmx`, `for_assignment_init.hmx`, `do_while.hmx`, `loops_nested.hmx`.
- Full regression: 23/23 integration, 35/35 negative, 14/14 stress/output.

## Known issues / deferred
- if/loop/while/for/do-while/return block line numbers point at closing brace (cosmetic).
- `return` followed immediately by `IDENTIFIER = ...` on next line misparses (return expr wins via shift); acceptable edge case.
- bison shift/reduce conflict is only the harmless `return` ambiguity (resolved by shift).
- Duplicate declarations and missing definite returns are rejected by the type resolver.

## Relevant files
- `src/lexer.l`, `src/parser.y`, `src/ast.hpp/cpp`, `src/type_resolver.hpp/cpp`, `src/codegen.hpp/cpp`, `src/main.cpp`
- `tests/fixtures/*.hmx`, `tests/run_integration.sh`
- `PLAN.md`, `SYNTAX.md`
