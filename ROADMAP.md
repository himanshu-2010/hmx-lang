# HMX v1.0 Roadmap — M11 → M26 (locked decisions)

> Log of the v1.0 roadmap, decided 2026-09-26 from a full language/complier audit.
> Every claim in the audit was verified against the source AND reproduced by
> execution before planning (see §1). Batches B–F are the log; Batch A is in
> progress. Standing rules: spec-first in SYNTAX.md (`[Spec]` → `[Implemented]`),
> fixture/negative/stress/CLI tests per feature, web↔native parity 1:1
> (regenerate `tests/data/*.json` from native after runtime changes), release
> via the existing `v*` tag pipeline, PROGRESS/TESTRESULT updated per milestone.

## 1. Audit findings (all reproduced)

| # | Finding | Evidence |
|---|---|---|
| 1 | `push()` heap corruption — `sd_make_array` sets `capacity = length + 16` but `malloc(nbytes)` | `codegen.cpp:123-124`; run → `realloc(): invalid next size` |
| 2 | CLI masks crashes — `WEXITSTATUS(system())` with no `WIFEXITED` | `main.cpp:346-347`; abort reported exit 0, SIGSEGV reported as 128 silently |
| 3 | No memory deallocation anywhere in generated runtime | only `free(line)` in `codegen.cpp:53` |
| 4 | Multi-level closure capture broken — captures only registered on `current_fn_` | `type_resolver.cpp:95-107`; run → `error: 'a' undeclared` in `__lam_0` |
| 5 | Modules drop top-level `let`/`const` — only `FunctionDecl` copied | `main.cpp:152-157`; run → `undefined variable 'PI'` |
| 6 | No identifier mangling — C keyword collisions | `codegen.cpp:587-593`; `let static = 5` → gcc error at usage site |
| 7 | Silent integer overflow — `atoi(yytext)` | `lexer.l:62`; `3000000000` → `-1294967296`, exit 0 |
| 8 | `byte` is arithmetic-dead (no `+`/`++`/casts) | `type_resolver.cpp:1164-1170`, `1120-1129` |

## 2. Locked decisions

- **Scope:** everything through v1.0 (M11–M26).
- **Memory model:** reference counting (by-value closure snapshots make cycles
  impossible in HMX today — refcount is simple, deterministic, sound).
- **Language identity:** IR layer + shared native/web VM (M26) — the compiler
  becomes frontend → IR → backends {C, bytecode VM, [LLVM later]}.

## 3. Batch A — Soundness (M11 done; target v0.10.0)

- **M11 Runtime correctness** (#1, #2, #7, #8) — **DONE 2026-09-26**:
  `sd_make_array` allocation + overflow-guarded growth; `fork`/`execlp`/
  `waitpid` run path with `WIFEXITED`/`WIFSIGNALED` crash reporter
  (`Error: program crashed with signal N`, exit 128+N); lexer int range check
  → compile error on overflow; `byte` gains arithmetic (promote to int),
  `++`/`--`, `as byte` runtime bounds-checked casts, `as char` C-wrap casts.
  Mirrored 1:1 in the web compiler (`SD.num`/`SD.toByte`/`SD.toChar`, byte
  wrap in codegen_js, regenerated LALR tables + constants from
  `tables.constants`). Native 396/396 + web 380/380 green.
- **M12 Identifier safety** (#6): global mangling pass for all user identifiers
  → no C keyword/`_` collisions; `#line` keeps errors on `.hmx` lines.
- **M13 Closures: transitive captures** (#4): capture threading through every
  enclosing chain function in resolver + codegen env structs.
- **M14 Modules: top-level state** (#5): ordered module init sections before
  `main`; module `let`/`const` visible to functions.

## 4. Batch B — Memory (v0.10–0.11)

- **M15 Reference-counted allocator**: strings/arrays/closure-envs tracked;
  slice/concat = shared buffer + refcount; ASan CI job; valgrind-clean stress.

## 5. Batch C — Abstractions

- **M16** structs / enums / type aliases (value semantics, parallel C structs).
- **M17** generics via monomorphization (reuse `papp_mangle` instantiation infra).
- **M18** `Option[T]` / `Result[T,E]` + `try`/`?`/`defer` on existing setjmp
  machinery; hard faults stay print+exit(1) by default, recoverable via `catch`.
- **M19** int64 / u32 / u64 / float32 + checked-arithmetic flag; BigInt stretch.

## 6. Batch D — Standard library

- **M20** I/O + OS: `fn main(argv: [text])`, getenv, exit, files
  (open/read/write/append/exists/remove), sleep, now_ms, random (codegen
  hotbuiltins + `use "std.hmx"` facade).
- **M21** math (`abs/min/max/sqrt/pow/floor/ceil/round/sin/cos/tan/log/exp`) +
  `HashMap[K,V]`/`Set` on generics + introsort (kills §3 >100k sort stall).
- **M22** networking (stretch, optional — web parity costs).

## 7. Batch E — Tooling

- **M23** `-g` DWARF debugging story (gdb lands on `.hmx` lines via `#line`).
- **M24** `hmx repl` via the JS parity runtime under Node (instant eval).
- **M25** `hmx fmt` + `hmx lsp` + minimal `hmx pkg add <url>`.

## 8. Batch F — Language identity

- **M26 IR layer + shared VM**: `ir::Module`, codegen → IR → C, `-emit-ir`,
  native bytecode VM (port `vm.ts`). One pipeline: frontend → IR → {C, VM}.
- **Stretch, post-v1.0:** M27 LLVM/JIT backend, M28 self-hosting bootstrap.

## 9. Definition of done for v1.0

Scorecard cells at 1/10 (memory) and 2.5/10 (stdlib/tooling) land at ~8:
leak-free + corruption-free by default, ASan-clean CI, catchable runtime
errors, structs/generics/Option, file/OS/math/collections stdlib, REPL +
formatter + LSP, and a real shared IR backend.