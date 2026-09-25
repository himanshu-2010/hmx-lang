# HMX Web Playground — Plan (0.B1)

Goal: a **Vite + React-only** single-page app where anyone can open HMX source in
a browser, hit Run, and see stdout / stderr / exit code — no install, no server,
no native toolchain. Users should be able to test every language feature that the
native compiler implements (through milestone 0.A8).

Hard constraints from the project:

- **Vite + React + TypeScript, nothing else.** No backend server, no WASM, no
  CodeMirror/Monaco unless we decide the editor shell needs it (see "Editor").
- The only source of truth for language behavior is the native compiler in
  `src/`. The web compiler must pass **the same 358 test cases** (52 integration
  fixtures, 190 negative, 116 stress) before it ships — parity is the contract.
- `.hmx` extension and the error-message strings (grep-able by the negative
  suite) must match the native compiler so the negative suite can run verbatim.

---

## 1. Why not just compile to WASM in the browser?

The native pipeline is `lexer → LALR parser → resolver → C codegen → gcc -O2`.
The last stage (`gcc`) cannot run in the browser. Shipping a browser C compiler
(clang/wasm) would dwarf the whole playground in size and complexity, and serves
no user need here. So the web compiler replaces the backend, not the front half.

## 2. Recommended architecture: full TypeScript port + JS backend

```
             hmx source (.hmx)
                    │
        ┌───────────▼────────────┐
        │   lexer.ts (flex port) │
        └───────────┬────────────┘
                    │ tokens
        ┌───────────▼──────────────────────────────┐
        │   lalr.ts  (generic driver)              │
        │   tables/  (bison LALR tables, JSON)     │   ← extracted from bison, verbatim
        │   actions.ts (rule → AST, parser.y port) │
        └───────────┬──────────────────────────────┘
                    │ AST (ast.ts — mirrors ast.hpp)
        ┌───────────▼──────────────┐
        │   resolver.ts (type ref) │   ← port of type_resolver.cpp
        └───────────┬──────────────┘
        ┌───────────▼────────────────┐
        │   codegen_js.ts            │   ← NEW backend: emits JavaScript
        │   runtime.ts (sd_* helpers)│      instead of C
        └───────────┬────────────────┘
                    │ compiled JS ("build_temp.js")
        ┌───────────▼──────────┐
        │   vm.ts               │   ← new Function + sandboxed globals
        │   iostdout/stderr     │
        └───────────┬──────────┘
                    ▼
         stdout lines · stderr errors · exit code
```

Key decisions:

1. **Parser: drive the real bison LALR table, don't hand-write a parser.**
   The grammar has 6 deliberate shift/reduce conflicts whose resolution
   (shift, always) *is* part of the language. A hand-written recursive-descent
   parser would silently re-decide those ambiguities and drift. Instead:
   - Add a small build step (`tools/extract_parser_table.py` or a bison
     `--output` callback) that reads the generated `parser.cpp` and emits
     `web-playground/src/compiler/tables/*.json` carrying `yypact, yypgoto,
     yydefact, yydefgoto, yytable, yycheck, yystos, yyr1, yyr2, yyrline` and the
     action-number → AST-builder mapping keyed by rule number.
   - `lalr.ts` is a ~200-line generic LALR(1) driver with bison's exact
     default-conflict resolution (shift wins) and the same error path
     (`Parse error [line N]: ... near 'tok'`).
   - The action blocks in `parser.y` are ported one-to-one into `actions.ts`
     (this is the mechanical part — one ported action per rule, ~50 rules).

2. **Lexer: hand-ported flex.** The lexer rules in `lexer.l` are small and
   regular; port them to a prioritized list of JS regexes with the same
   longest-match/priority behavior. Keep the integer/decimal/char/string
   literal rules byte-identical, including the `.hmx`-only extension check.

3. **Resolver: direct port of type_resolver.cpp.** Same file/message strings,
   same rule ordering. This is the largest single port (~1,900 lines of C++) but
   it is pure, deterministic logic — low design risk, high volume. Keep a
   checkable diff discipline: port function-by-function with the same names.

4. **NEW backend: emit JavaScript, not C.** This is the one place the web
   compiler intentionally differs. JS is close enough to the generated C that
   most `emit_expr`/`emit_stmt` bodies map straight across (string output,
   `if`/`while`/`for`, array ops, tuple structs → JS arrays). The C runtime
   helpers (`sd_concat`, `sd_*_index` bounds checks, `sd_make_closure`,
   `sd_papp_*`) become `runtime.ts` functions with identical semantics.

5. **Semantics parity — the dangerous corners** (each needs a dedicated parity
   test, not just a smoke check):

   | Native (C) behavior | JS pitfall | Mitigation |
   |---|---|---|
   | C `int` division truncates toward zero | JS `/` is float | emit `Math.trunc(a / b)` |
   | C `%` sign follows the dividend (e.g. `-100 % 7` = `-2`) | JS `%` differs for negatives | `((a % b) + b) % b`-style fixup helper, or bit-level emulation of the C semantics used in tests |
   | decimal prints as C `%f` | JS `toString` differs | port the `%f` formatting (`runtime.ts`) |
   | closures **capture by snapshot** (copy of enclosing locals at definition) | JS closures capture by reference | at closure creation, deep-copy the captured env entries the resolve step listed |
   | arrays are reference values (aliases share storage) | JS arrays naturally share | matches natively — just don't break it copying |
   | tuples are value types (copied on pass/return) | JS arrays pass by reference | codegen copies tuple arrays at boundaries |
   | non-local `break`/`continue` from nested functions | no equivalent in JS | codegen throws a tagged control object; the loop's `catch` consumes it |
   | `main` exit code / exit-1 runtime errors | JS can't exit | vm returns `{ exit }`; abort-style helpers throw a `RuntimeExit` |
   | `text[i]` returns `char`; `byte` range checks | JS strings/chars fine | range checks in `runtime.ts` |
   | Unicode identifiers | JS identifiers are ASCII | keep a symbol mapping (intern table) or normalize identifiers to `\uXXXX` escapes |

6. **The parity harness is the deliverable's spine.** A vitest suite inside the
   web project (`web-playground/tests/parity.test.ts`) that:
   - runs the 52 `tests/fixtures/*.hmx` programs and asserts exit 0,
   - runs the 116 stress snippets asserting exact stdout,
   - runs the 190 negative snippets asserting exit ≠ 0 and the regex match,
   - runs the grouping-precedence stress (`20 14 -4 7`) and the 0.A8
     tuple-literal cases explicitly.
   Milestone gate: **parity.test.ts green before the UI is "done".**

7. **Editor choice.** To honor "React only", start with a plain `<textarea>`
   (tab-handling + line numbers if cheap). If editing UX becomes a blocker,
   the first — and only — addition is `@monaco-editor/react` (a component, not
   a framework, but an explicit deviation). Do not add state libraries;
   `useState`/`useReducer` + a tiny `run` service are enough.

8. **IO in the browser.**
   - `print` → buffered stdout lines shown in an Output pane (same `a b c\n`
     layout, spaces between args, `1`/`0` booleans, `%f` decimals).
   - `input()` → a stdin text-box: pause, capture a line, resume (or "End of
     input" → empty string like EOF, matching the native runner).
   - `main` return code shown as `Exit: N`.

9. **Share/UX niceties (post-parity, optional).**
   - Example menu: `hello.hmx`, fixture programs, curry lambda demos.
   - Source in the URL hash (LZ-string → base64url) for shareable snippets.
   - Line-numbered type/syntax errors inline + a stderr pane.

## 3. Project layout

```
hmx-lang/web-playground/           ← Vite + React + TS app (its own package.json)
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx  app.css
    compiler/                  ← the ported core (no React imports; pure TS)
      lexer.ts
      lalr.ts
      tables/                  ← extracted bison tables (JSON, generated)
      actions.ts  ast.ts
      resolver.ts
      codegen_js.ts  runtime.ts  vm.ts
      program.ts               ← runProgram(source, {stdin}) → {stdout, stderr, exit}
    ui/
      Editor.tsx  Output.tsx  ErrorPanel.tsx  ExamplesMenu.tsx  SharePanel.tsx
      runner.ts                ← wires Editor → program.ts → Output (useReducer)
    examples/                  ← .hmx texts mirrored from examples/ + fixtures/
  tests/
    parity.test.ts             ← the 358-case parity suite (vitest)
    unit.test.ts               ← lexer/table/resolver units
  tools/
    extract_parser_table.py    ← bison parser.cpp → tables/*.json
README.md                      ← how to run: `npm i && npm run dev; npm test`
```

Generated-table checkin: commit the JSON tables so `npm i && npm run dev` works
without a C toolchain; the extract script only runs when the grammar changes.

## 4. Milestones

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| M1 | Scaffold | Vite + React + TS app, textarea editor ↔ Output pane, `runProgram` stub | `npm run dev` serves; Run shows "compiler: not yet" |
| M2 | Front half | lexer.ts + lalr.ts + tables/ + actions.ts + ast.ts | syntax errors with native-identical line numbers; `fn main(){}`-style snippets parse |
| M3 | Resolver | resolver.ts | type errors match native messages (grep-able) |
| M4 | Backend | codegen_js.ts + runtime.ts + vm.ts | hello + arithmetic + closures run in-page |
| M5 | Parity gate | parity.test.ts (vitest) green for all 358 cases | **358/358 in Node**, then in the browser via a DOM test |
| M6 | Polish | examples menu, share URL, stdin box, exit-code line, mobile layout | demo-ready |
| M7 | Ship | static deployment (GitHub Pages or Vercel) | `npm run build && npm run preview` |

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Bison table extraction produces wrong tables | Diff the JSON against a tiny C harness that dumps the same tables from `parser.cpp`; parity suite catches any drift |
| Conflict resolution behavior differs (the 6 shift/reduce conflicts) | We drive the exact resolved tables + bison's "shift on conflict" default; a dedicated negative test pins each conflict state |
| Ported resolver diverges (message text, ordering) | Run the 190 negative cases verbatim — they grep the exact stderr text |
| Integer/`%`/division semantics off-by-one in JS | Dedicated parity tests for `-5`, `-100 % 7`, `5 / 2`, big numbers |
| Snapshot-capture closures vs JS reference capture | Golden test: the `currying.hmx` + `main capture` closed-over-variable mutation cases |
| Non-local break/continue semantics | Golden tests from `non_local_*` fixtures (they exist in the suite) |
| Unicode identifiers | Intern-table mapping; verify `unicode_identifiers` fixture |
| Decimal print formatting | Port C `%f` exactly; stress decimals equal native output |

## 6. Explicitly out of scope (0.B1)

- Bracketing/parenthesized **chained calls** (`add(1)(2)`) — not in the native
  grammar (7th conflict), so not in the web compiler either.
- A browser `gcc`/WASM backend.
- `use "file.hmx"` multi-file modules (native `use` resolves files at
  compile time and needs a file system; web `use` becomes an import from an
  in-memory + URL-share module store — separate milestone if wanted).
- Performance benchmarking in-page; crypto/RNG; a full IDE.

## 7. First concrete tasks (after this plan is approved)

1. `npm create vite@latest web-playground -- --template react-ts`, prune to React
   only (no router/state libs), delete boilerplate.
2. Write `tools/extract_parser_table.py` and generate `tables/*.json`; commit.
3. Implement `lexer.ts` + `lalr.ts` + `actions.ts`; parse the fixture programs.
4. Port `type_resolver.cpp` → `resolver.ts` (largest single task).
5. Stand up the parity harness early and keep it green as the port progresses.