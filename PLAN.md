# HMX — Implementation Plan

**Status: executed** — all 8 phases below are complete. Post-plan features
(string concatenation, the full loop family, arrays, and multiple return
values / tuples) are tracked in [PROGRESS.md](PROGRESS.md); the roadmap is in
[SYNTAX.md](SYNTAX.md) §15.

Incremental plan to take HMX from its current runtime to full
hello-world-capable programs. Each phase is self-contained, builds + passes all
prior fixtures, and lands one complete feature.

---

## Current state (what's already implemented)

- `let` declarations (inferred + annotated types)
- `print(...)` output
- `loop(count)` counted loop
- `fn` (zero-arg, void, uncallable)
- Arithmetic operators `+ - * /`
- Line comments `//`
- Arrays, indexing, element assignment, `length()`
- Full pipeline: lexer → parser → type resolution → codegen → `gcc -O2`

## Spec'd but not yet implemented

- Block comments `/* */`
- Comparison operators `== != < > <= >=`
- Boolean operators `and/or/not` + `&& || !`
- `if (cond) { } else { }`
- Assignment `=` / `+= -= *= /=` / `++ --`
- Function parameters `(a: int, b: text)`
- Function return values `-> TYPE` and `return`
- Function calls

---

## Phase 1 — Block comments `/* */`

**Goal:** recognize and strip `/* ... */` comments (non-nesting).

- **lexer.l:** add non-nesting `/* ... */` rule; error on unterminated comment.
- **Verify:** fixture with inline + multiline comments produces identical
  output; regression on all existing fixtures.

## Phase 2 — Comparison operators `== != < > <= >=`

- **lexer.l:** longest-match rules for `== != <= >=` (flex takes longest match,
  order-independent).
- **parser.y:** two new precedence layers above `term`: `equality`
  (`==`/`!=`) and `relational` (`<`/`>`/`<=`/`>=`).
- **type_resolver:** operands must be same type; result type is `bool`.
  Text `==`/`!=` lower to `strcmp(a, b) == 0`; ordering comparisons on `text`
  are a compile error.
- **codegen:** numeric comparisons pass through; `text` equality emits
  `strcmp`.
- **Verify fixture:** `print(5 > 3)`, `print(2 + 3 == 5)`, `print("a" == "a")`.

## Phase 3 — Boolean operators `and/or/not` + `&&/||/!`

- **lexer.l:** `and or not` keywords; `&& || !` symbols.
- **parser.y:** `logical_or` → `logical_and` → `equality`; unary `not`/`!`
  prefix in `factor`.
- **type_resolver:** operands must be `bool`; result is `bool`.
- **codegen:** store the C symbols (`&&`/`||`/`!`) in the AST at parse time,
  emit directly.
- **Verify fixture:** `print(true and false)`, `print(not true or (5 > 3))`.

## Phase 4 — `if (cond) { } else { }`

- **lexer.l:** `if`, `else`.
- **parser.y:** new statement; optional `else`.
- **type_resolver:** condition must be `bool`; each branch gets its own scope.
- **codegen:** C `if`/`else` blocks.
- **Verify fixture:** ifelse.hmx exercising both branches.

## Phase 5 — Assignment `=` / `+= -= *= /=` / `++ --`

- **lexer.l:** compound-assign tokens `+= -= *= /=`; postfix `++ --`.
- **parser.y:** new `AssignStmt` as a **statement only** (no chained
  `a = b = c`, no assignments inside expressions).
- **type_resolver:** lhs must be a defined variable; rhs type must match lhs
  for `=` and compound ops; `++`/`--` and compound ops require `int`/`decimal`.
- **codegen:** `name = rhs;`, `name += rhs;`, `name++;`.
- **Verify fixture:** assignment inside a `loop`.

## Phase 6 — Function parameters & return values

- **lexer.l:** `return`, `->` arrow, `,` comma.
- **ast:** `FunctionDecl` gains `params` (name + type) and optional return
  type; new `ReturnStmt`.
- **parser.y:** `fn name(a: int, b: text) -> int { return expr }`.
- **type_resolver:** function signature table (name → params + return);
  params defined in fn scope; `return expr` type must match declared return;
  bare `return` allowed in void functions; `main() -> int { return N }` maps to
  C `return N` (exit code).
- **codegen:** emit properly typed C functions (`int add(int a, int b)`).
- **Verify fixture:** typed params/returns compile end-to-end.

## Phase 7 — Function calls (capstone)

- **parser.y:** `factor → IDENTIFIER '(' args? ')'`.
- **ast:** new `CallExpr` (name + arguments).
- **type_resolver:** arg count must match param count; each arg type must match
  its param; call's type = function return type; calling `main` is an error.
- **codegen:** emit all function **prototypes first**, then definitions (safe
  for any call order); `main` remains the entry point.
- **Verify fixture:** `print(add(3, 4))`, `greet("Boss")` end-to-end — the full
  "hello" milestone.

## Phase 8 — Docs & full regression

- Move implemented sections from `[Spec]` → `[Implemented]` in `SYNTAX.md`.
- Run all fixtures + `hello.hmx`.
- Clean build with no warnings.

## Known codegen quirks (tracked)

- **FIXED (2026-09):** decimal literals with integral values (`6.0`, `3.0`)
  were emitted to C as bare ints (`6`, `3`) because `operator<< double` strips
  the trailing `.0`; `printf("%f", 6 * 2)` then passed an `int` to `%f` (UB →
  `0.000000`). Fixed in `codegen.cpp` by emitting shortest-round-trip double
  literals via `std::to_chars`, appending `.0` when the text has no dot or
  exponent. Caught by the doc-example validator
  (`web-playground/tools/validate_docs.mjs`); all 358 native tests still pass.
- **NOT FIXED:** HMX identifiers that are C keywords (e.g. `double`, `long`,
  `static`, `struct`) still collide with generated C — codegen writes variable
  and parameter names verbatim, so `let double = 2` fails in gcc with a
  confusing error. The JS backend (web playground, M2–M4, shipped 2026-09-26)
  targets JS identifiers and is unaffected — it passes a 358-case verbatim
  parity gate (`web-playground/tests/parity.test.ts`); a generalized
  identifier-mangling pass in `codegen.cpp` would close the gap for the native
  binary.

## Web playground UI (shipped 2026-09-26)

- **M2–M4 web compiler:** full native-parity compiler in the browser (see
  PROGRESS.md milestone).
- **M6 site shell:** react-router multi-page app (`/` home, `/playground`,
  `/docs` — HashRouter for static-host deep links), a landing page in the
  red/black brand palette, and a first-time-user guided tour restricted to
  desktop (`matchMedia` pointer:fine + ≥1024px, localStorage-gated, replayable
  from the playground toolbar). Details + verification notes in
  PROGRESS.md / TESTRESULT.md.
- **M7 production UX pass:** typography roles (Waterlily script self-hosted;
  Outfit headings; Inter body/UI; JetBrains Mono code), boot splash until
  webfonts are ready, light/dark theme toggle (system default on first visit,
  persisted to localStorage), Dark Reader detection + themed disable prompt,
  and 250ms debounce on every compile-carrying button. Details + verification
  in PROGRESS.md / TESTRESULT.md.
- **M8 mouse follower + light-theme colour pass:** desktop-only cursor trail
  (dot + lerped halo, one rAF loop, ref-only writes, `pointer: fine` gating,
  reduced-motion + vitest guards) and a rebuilt light palette + forced
  light-on-dark text inside the surfaces that stay dark in light mode
  (`.doc-intro` hidden-text bug fixed). Details in PROGRESS.md.
- **M9 CLI hardening:** bare `hmx <file.hmx>` runs by default; `-h/--help`,
  `-v/--version` (`0.9.0` from `project(VERSION)`), `hmx new <name>`,
  `build -o <output>`, gcc → cc → clang compiler probe, `_WIN32` shims
  (sys/wait fallback, `.exe` suffix, run prefix); new `tests/run_cli_tests.sh`
  (23 tests). All native suites green (52/190/116).
- **M10 distribution:** `cmake --install` target, CPack `.deb`, GitHub Actions
  `release.yml` (ubuntu/macos-Arm/windows-MinGW → tar.gz + zip + `.deb` on a
  `v*` tag), distro-aware `install/install.sh` (apt/pacman+paru+yay/dnf/brew/
  generic binary) + `install/install.ps1` (winget→scoop→zip), and repo
  packaging manifests (`packaging/arch/PKBUILD`, `packaging/brew/hmx.rb`,
  `packaging/scoop/hmx.json`, `packaging/winget/hmx.installer.yaml`) for the
  first release, **v0.9.0**. External submissions (AUR, Homebrew tap, Scoop
  bucket, winget-pkgs, Launchpad PPA, and the `REPLACE_WITH_TAG_SHA` brew
  revision) are documented in `packaging/` headers and the README.