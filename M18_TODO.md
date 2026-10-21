# M18 Implementation Todo

## M18.1 — `defer` (landed)

- [x] Lexer keywords `defer`, `try`, `catch` (native + web). `try`/`catch` are
      reserved now so M18.2 can add grammar without another token renumbering.
- [x] AST `DeferStmt` (native `ast.hpp/cpp`, web `ast.ts`) including clone,
      depth/gather traversal and refcount ownership.
- [x] Grammar: re-opened `statement` at the end of `parser.y`
      (`defer { ... }` | `defer expr`) so all pre-existing rule numbers stay
      stable; web tables regenerated (189 rules / 493 states).
- [x] Resolver: per-defer scope resolution; rejects `return`/`break`/`continue`
      inside a defer block; rejects defer inside a loop a nested function exits
      non-locally (longjmp bypasses the loop body's teardown).
- [x] Codegen: per-scope defer list + runtime guard flags (dynamic registration),
      LIFO teardown on fall-through, `return`, `break`, `continue`, and before a
      non-local `longjmp`; `volatile` guards keep setjmp-clobber rules intact.
- [x] Web codegen mirror with the same guard/teardown ordering.
- [x] Fixture `tests/fixtures/defer.hmx`, stress case `m18_defer`, three
      negative tests; valgrind/ASan/UBSan clean; web parity 0 failures.
      Also fixed a pre-existing double release of heap-typed switch-case locals
      (valgrind matrix now includes `switch_case_heap_locals`).

## M18.2 — recoverable faults (`try` / `catch`)

- [ ] Define the catchable value (message text + source line; `catch (e)`).
- [ ] Introduce a per-process handler stack and an `sd_panic` runtime helper;
      convert the ~33 `fprintf(stderr, ...); exit(1)` fault sites to it. With no
      handler installed, behaviour must stay byte-identical (print + exit 1).
- [ ] Emit `try { ... } catch (e) { ... }` with setjmp; restore the previous
      handler on normal exit, early return, and longjmp.
- [ ] Run the enclosing scopes' defers when a caught fault unwinds out of them.
- [ ] Native + web resolver/codegen parity; tests for caught/bubbling faults and
      for default print+exit when uncaught.

## M18.3 — `Option[T]` / `Result[T,E]` and propagation

- [ ] Decide the representation. Preferred: compiler-provided value types
      (not user-declared structs) so `None`/`Err` need no dummy payload and
      matches work by value. Enums are not generic yet, so this is a built-in
      type family in the resolver.
- [ ] Constructors `Some(x)`, `None`, `Ok(x)`, `Err(e)` with expected-type
      inference for `None` (the only untyped position).
- [ ] Propagation spelling: the postfix `?` collides with the existing ternary
      `a ? b : c` at `logical_or . '?'` (LALR(1) must choose one, and shifting
      would break every `?`). Options to settle before implementing:
      1. `try expr` prefix propagation, keeping `?` as ternary (no grammar
         conflict, deviates from the roadmap spelling);
      2. reserve `??` for propagation;
      3. remove/alter ternary (breaking change).
- [ ] Run defers on the `?` early-return path (reuse `emit_all_defers`).
- [ ] Web mirror for the chosen representation and parity tests.

## Docs / validation (each slice)

- [ ] `SYNTAX.md` section + keyword/statement tables.
- [ ] `PROGRESS.md` / `TESTRESULT.md` / `REMAINING.md` counts.
- [ ] `README.md` suite table, `web-playground.md`, `story.json`, `Home.tsx`,
      `app.test.tsx` counts.
- [ ] `node web-playground/tools/extract_parser_table.mjs` after grammar changes.
- [ ] `npx vite-node web-playground/tools/smoke/gen-data.mts` + `npm run test`.
- [ ] All four native suites + `run_valgrind_tests.sh --fixtures` +
      `HMX_ASAN=1` integration/stress + `HMX_UBSAN=1` + UBSan control + fuzzer.
- [ ] GPG-signed commit and push.
