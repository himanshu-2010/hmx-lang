# ADR 0003 — `try` / `catch` recoverable faults (M18.2)

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** project owner
- **Affects:** M18 (`Option[T]` / `Result[T, E]`), M18.1 (`defer`), `src/parser.y`,
  `src/type_resolver.cpp`, `src/codegen.cpp`, `web-playground/src/compiler/`,
  `SYNTAX.md` §11.10

## Context

HMX runtime faults (index out of bounds, bad `parse_int`, `chr` out of range,
etc.) historically print to stderr and `exit(1)` with no recovery. M18.2 adds
`try { ... } catch (e) { ... }` so a fault can be caught and the message bound
as `text` to `e`. The native front end already uses `setjmp`/`longjmp` for
non-local `break`/`continue`, so `try`/`catch` is built on that machinery: a
fault calls `_sd_panicf`, which longjmps to the innermost installed `try`
handler or, with none, preserves the old `fprintf(stderr, …); exit(1)`
behavior byte-for-byte.

## Decision

- Syntax: `try { statement+ } catch (identifier) { statement+ }`. The catch
  variable is `text` holding the fault message without its trailing newline.
  `catch` is required (no bare `catch`), and the message binding is required.
- `try` frames form a dynamic handler stack (`sd_try_top` → `prev`). A function
  containing `try` marks its locals `volatile` (setjmp clobber). Handlers are
  deactivated on `return`/`break`/`continue`/fall-through so a fault after a
  structured exit never jumps into a dead frame.
- A `try` body may not declare a local or contain `defer`: a caught fault
  unwinds by `longjmp` and would skip the body's teardown, leaking owning
  storage. Declare storage before the `try`.
- A caught fault does **not** unwind refcounted retains live at the fault site
  (e.g. a text lvalue read inside the body is retained then never released).
  Keep fault-prone reads out of a `try` body, or read them before entering it.
  This is a documented M18.2 limitation, accepted to ship recoverable faults
  without a full exception-unwinding implementation.
- Uncaught faults keep the exact previous `fprintf(stderr, …); exit(1)` output
  and exit code, so existing behavior and tests are unchanged.

## Consequences

### Positive
- Recoverable faults with byte-identical uncaught behavior.
- Minimal native/web change: one parser rule, resolver restriction, codegen
  handler stack, and a small runtime helper (`_sd_panicf` / `SD.fail` + `SD.isFault`).

### Negative
- `try` bodies cannot own storage, so they are unsuitable for fault-prone
  allocation; users stage storage outside.
- Fault paths may leak retains on heap lvalues read inside the body (documented
  above). Valgrind-clean tests therefore avoid text/heap reads at fault sites.

## Enforcement

- `tests/fixtures/trycatch.hmx` — caught/nested/uncaught faults, defer outside
  `try`.
- `tests/run_stress_tests.sh` — `m18_try_caught`, `m18_try_return`,
  `m18_try_uncaught`.
- `tests/run_negative_tests.sh` — `try_defer_forbidden`, `try_local_forbidden`,
  `try_without_catch`.
- `tests/run_valgrind_tests.sh --fixtures` — `trycatch.hmx` under the ownership
  matrix.
- `web-playground/tools/smoke/gen-data.mts` + `npm run test` — native↔web
  parity byte-identical.

## Revisit triggers

- A full unwinding implementation (C++-style destructors or per-scope cleanup
  frames) that lets `try` bodies own storage and release retains on fault.
- `M18.3` (`Option[T]` / `Result[T, E]` + `try expr` propagation) builds on
  this handler stack.
