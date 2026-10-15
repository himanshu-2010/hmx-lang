# HMX — Production-Readiness Gap Analysis

> Companion to `ROADMAP.md` (the feature milestones) and `REMAINING.md` (the
> packaging/distribution state). This is the honest gap between HMX and
> "production-level", grouped by pillar and prioritized. `[roadmap]` marks gaps
> the existing M17–M28 roadmap already tracks; `[new]` marks gaps nothing
> currently tracks. The immediate work is sequenced in `CURRENTLOG.md`.

---

## Framing

HMX today is a **solid small language with an unusually mature packaging story**:
485 native + 160 packaging + 466 vitest tests, ASan/UBSan/valgrind/fuzz-gated
reference counting, signed releases, working installers for
Linux/macOS/Windows, and a byte-identical browser compiler.

What it is **not** yet is a language you would drop into a team's production
use. The existing roadmap (M17–M28) is a good *feature* list, but it is **not a
production checklist** — it omits roughly half of what production actually
means. The biggest omissions are: FFI, UTF-8 string semantics, traits and
visibility, a test runner / doc generator / warnings, fuzzing + UBSan +
coverage, benchmarks, the cycle-collection decision, and the community /
governance files.

---

## Tier 0 — Correctness, safety, and trust (must land before "production")

| # | Gap | Evidence | Status |
|---|---|---|---|
| 0.1 | **Runtime `int` overflow is unchecked C UB.** Literal overflow is a compile error, but `a + b` on `int` is emitted raw. | no `__builtin_add_overflow` / checked emit in `codegen.cpp` | `[roadmap M19]` checked-arithmetic flag |
| 0.2 | **No recoverable errors.** Every runtime fault is `fprintf(stderr,…); exit(1)` (parse_int, slice OOB, split, index OOB, allocation). No `Option`/`Result`, no `try`/`catch`/`?`/`defer`. | `codegen.cpp` ~40 bare `exit(1)` sites; setjmp exists only for non-local break/continue | `[roadmap M18]` |
| 0.3 | **Refcounting cannot collect cycles.** Safe *today* only because closures snapshot by value. Generics + error values + any mutable/self-referential data can reintroduce cycles → leaks, with no GC and no `Weak`. | `ROADMAP.md` §2 assumes "cycles impossible"; M15 refcount only | `[new]` — decide *before* M17/M18 |
| 0.4 | **No UBSan / TSan in CI.** Only ASan+LSan+valgrind. Signed overflow, divide-by-zero, bad shifts, and races are uncaught. | `.github/workflows/ci.yml` jobs: build-test / asan / valgrind | `[new]` |
| 0.5 | **No fuzzing, no coverage gate.** Lexer/parser/resolver are hand-written and only exercised by fixed fixtures. | no fuzz target, no coverage job | `[new]` |
| 0.6 | **Allocation failure is silent** (`if (!p) exit(1);` with no message) — undiagnosable in production. | `codegen.cpp` runtime preamble | `[new]` |

---

## Tier 1 — Language completeness

| # | Gap | Status |
|---|---|---|
| 1.1 | **Generics / parametric polymorphism** — no `[T]` on functions, structs, or enums. Blocks reusable containers. | `[roadmap M17]` |
| 1.2 | **Error handling** — `Option[T]`/`Result[T,E]`, `try`/`?`/`defer`, catchable faults. | `[roadmap M18]` |
| 1.3 | **Numeric tower** — only `int`(i32) / `decimal`(f64) / `bool` / `char` / `byte`. No i64/u32/u64/float32/usize, no BigInt. | `[roadmap M19]` |
| 1.4 | **Strings are byte arrays.** `length` = bytes, `text[i]` = a byte, `split` = bytes; identifiers are Unicode but string *values* get no UTF-8 length/index/slice/trim. A production text language needs this. | `[new]` |
| 1.5 | **No pattern matching beyond enum `switch`** — no match on structs/tuples, no ranges, no guards, no exhaustiveness. | `[new]` |
| 1.6 | **No traits/interfaces or dynamic dispatch**; no generic constraints. | `[new]` |
| 1.7 | **No visibility or namespaces.** `use` merges everything into one flat namespace; no `pub`/`private`; cross-module name clashes are just errors. | `[new]` |
| 1.8 | **No references/pointers or ownership annotations.** Value-vs-reference is implicit and asymmetric (arrays share, structs copy, params borrow). Painful for systems work and for reasoning about aliasing. | `[new]` |
| 1.9 | **No methods/UFCS, no `defer`/RAII, no labeled loops, no `assert`; closures cannot capture mutable state** (captures are read-only). | `[new]` |
| 1.10 | **Grammar quirks that are language bugs:** empty block `{}` is unparseable; `return` + next-line assignment misparses; no tuple element assignment; `make()(x)` unparseable; 9 unresolved SR conflicts. | `[new]` (documented in `PROGRESS.md`) |
| 1.11 | **No formal versioned grammar / language versioning policy.** | `[new]` |

---

## Tier 2 — Standard library (there is **no stdlib at all** today)

`find` for `.hmx` outside `tests/` and `examples/` returns nothing; there is no
`std.hmx`. Planned, but it is the single biggest practical gap.

| # | Gap | Status |
|---|---|---|
| 2.1 | **I/O + OS:** files (open/read/write/append/exists/remove), `argv`, getenv, exit, sleep, `now_ms`, random, process. | `[roadmap M20]` |
| 2.2 | **Math:** abs/min/max/sqrt/pow/floor/ceil/round/trig/log/exp. | `[roadmap M21]` |
| 2.3 | **Collections:** `HashMap`/`Set` (dependent on 1.1), and introsort to kill the >100k stall. | `[roadmap M21]` |
| 2.4 | **Text utilities:** trim, replace, starts_with/ends_with, find, upper/lower, join, repeat, format. | `[new]` |
| 2.5 | **Serialization / parsing:** JSON, CSV; regex; date/time formatting. | `[new]` |
| 2.6 | **Networking.** | `[roadmap M22, stretch]` |
| 2.7 | **No stdlib versioning / namespacing.** | `[new]` |

---

## Tier 3 — Tooling & developer experience

| # | Gap | Status |
|---|---|---|
| 3.1 | **No debugger story** — `-g` DWARF (gdb on `.hmx` lines), no stack trace on panic (just a signal number). | `[roadmap M23]` |
| 3.2 | **No REPL.** Documented honestly as absent. | `[roadmap M24]` |
| 3.3 | **No formatter `hmx fmt`.** | `[roadmap M25]` |
| 3.4 | **No LSP** — no completion, inline diagnostics, or goto-definition for editors. | `[roadmap M25]` |
| 3.5 | **No package manager / manifest / lockfile.** `hmx pkg add <url>` alone; `hmx new` scaffolds a single file. No `hmx.toml`, no deps, no registry. | `[roadmap M25]` + `[new]` for manifest/registry |
| 3.6 | **No test runner (`hmx test`) or assert framework.** | `[new]` |
| 3.7 | **No doc generator (`hmx doc`).** | `[new]` |
| 3.8 | **No `hmx check` (typecheck-only), no incremental compile, no watch mode.** | `[new]` |
| 3.9 | **Diagnostics are one-error-at-a-time** with line numbers but no spans/carets/suggestions/error recovery, and **no warnings at all** (unused vars, shadowing, unreachable code). | `[new]` |

---

## Tier 4 — Compiler & backend

| # | Gap | Status |
|---|---|---|
| 4.1 | **No IR.** Codegen is direct AST→C, which blocks clean multi-backend work and HMX-level optimization. | `[roadmap M26]` |
| 4.2 | **Only one backend (C via gcc/cc/clang).** No bytecode VM, no LLVM/JIT, no self-hosting. | `[roadmap M26/M27/M28]` |
| 4.3 | **No HMX-level optimization** — everything rides on `gcc -O2`. | `[new]` |
| 4.4 | **Only 3 prebuilt targets** (linux-x86_64, macos-arm64, windows-x86_64). No aarch64 Linux, musl/static, cross-compile flags, FreeBSD. | `[new]` |
| 4.5 | **A C toolchain is required at run time** — the compiler is not self-contained. | `[new]` (documented) |
| 4.6 | **`clang` path exists but is never exercised in CI** (CI builds with gcc only). | `[new]` |

---

## Tier 5 — Interop (biggest ecosystem gap; not on the roadmap at all)

| # | Gap |
|---|---|
| 5.1 | **No FFI / `extern "C"`.** You cannot call OpenSSL, libcurl, SQLite, zlib, GUI toolkits, or any existing C library. For a C-transpiling language this is the highest-leverage missing feature. `[new]` |
| 5.2 | No way to consume/build a C library as a package. `[new]` |
| 5.3 | No ABI / calling-convention stability statement. `[new]` |

---

## Tier 6 — Ecosystem, governance, community

| # | Gap |
|---|---|
| 6.1 | **Missing community/legal files:** no `CHANGELOG`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `AUTHORS`. (Only `LICENSE` = MIT.) `[new]` |
| 6.2 | No RFC / decision process; no semver & deprecation policy for the *language*. `[new]` |
| 6.3 | Docs: `SYNTAX.md` is excellent, but there is no tutorial/book, no stdlib reference, no migration guide, no examples gallery, no FAQ. `[new]` |
| 6.4 | No published benchmarks or performance claims. `[new]` |
| 6.5 | Bus factor 1; no maintainer/architecture docs. `[new]` |

---

## Tier 7 — QA & performance (beyond the current suites)

| # | Gap |
|---|---|
| 7.1 | **No benchmark suite / perf-regression gate.** Compile-time scaling on large programs is unknown. `[new]` |
| 7.2 | No property/differential testing beyond web↔native parity and the libFuzzer front-end harness; no coverage metric. `[new]` |
| 7.3 | No TSan matrix, no 32-bit/big-endian checks (UBSan + the `HMX_MAX_NESTING` resolver guard now land in CI). `[new]` |
| 7.4 | Error-message surface is covered by 245 negatives, but there is no golden-diagnostics snapshot for message drift. `[new]` |

---

## Recommended sequencing

The roadmap's order is *roughly* right, but Tier 0 and FFI must be inserted:

1. **Done:** the Site work landed — `InstallPage` / `LicensePage` /
   `NotFoundPage` / `StoryPage` plus routes, nav and tests — and the two broken
   section-12f packaging gates were fixed and proven to fail on the bug they
   cover. See `CURRENTLOG.md`.
2. **Done:** the Tier 0 slice landed — the cycle-collection ADR
   (`docs/adr/0001-cycle-collection.md`), UBSan in CI (plus its control gate),
   and a libFuzzer front-end harness (which found and fixed four bugs). The
   counts were re-synced (native 485, packaging 160, vitest 466, valgrind 69,
   UBSan 3). See `CURRENTLOG.md`.
3. **M17 generics** (1.1) — the hard dependency for collections and half the stdlib.
4. **M18 error handling** (1.2) + the refcount-cycle decision from step 2.
5. **M19 numeric tower + checked arithmetic** (1.3, 0.1).
6. **M20/M21 stdlib** — once generics exist, so `HashMap`/`Set` land without a
   rewrite; add text utilities (2.4) alongside.
7. **FFI** (5.1) — pull this *earlier* than M26: it is what makes HMX usable in
   real projects, and it is far cheaper than an IR/VM.
8. **Tooling:** M23 debug → M24 REPL → M25 fmt/LSP/pkg → `hmx test` / `hmx doc`
   / warnings (3.6–3.9).
9. **M26 IR + VM**, then M27/M28 — architecture work best done after the
   language surface stops moving.
10. **Governance/docs/benchmarks** (6.x, 7.1) as a continuous background track,
    not a milestone.

**Biggest omissions the roadmap does not mention at all:** FFI, UTF-8 string
semantics, traits/visibility, a test runner + doc generator + warnings,
fuzzing/UBSan/coverage, benchmarks, the cycle-collection decision, and the
community/governance files. Those are the items most likely to be forgotten if
only M17–M28 are tracked.
