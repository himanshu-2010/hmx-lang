# CURRENTLOG — the next two work items

> The first two items of the *Recommended sequencing* in `PRODUCTION.md`:
> 1. Land the in-flight Site work and fix the packaging gates.
> 2. The Tier 0 safety slice (cycle decision, UBSan in CI, front-end fuzzing).

All commands run from `hmx-lang/`.

---

## Item 1 — Land the in-flight Site work, fix the 12f gates, sync counts ✅ done

### Why it was first
The tree was dirty and the docs had drifted. The new pages were written but
uncommitted, two gates in `tests/run_packaging_tests.sh` §12f were passing
**vacuously**, and the test counts in the docs no longer matched the tree
(docs: packaging 147 / vitest 455; tree: **155 / 459**). Nothing else should be
stacked on top of a red-or-wrong-green baseline.

### Result
Landed. The site now has **install, license, 404 and story** pages with routes,
nav and tests; the two §12f gate bugs are fixed and each was proven to fail on
the bug it covers (6/6 controls fired — including the catch-all control that had
never fired before); and the counts are synced to **native 478, packaging 160,
vitest 463 (448 parity + 15 app), valgrind 69** (638 native + packaging).

- New pages: `web-playground/src/ui/{InstallPage,LicensePage,NotFoundPage,StoryPage}.tsx`
  + `pages.css`.
- New data: `web-playground/src/data/story.{json,ts}` (the page renders the JSON;
  `stats.version` is gated to the canonical `CMakeLists.txt` version).
- New §12f/12g gates: the fixed install-command extractor (and an assertion that
  it found commands at all), the `\|`-normalised README comparison, `story.json`
  shape/version, and the StoryPage-imports-the-data check.
- Modified: `tests/run_packaging_tests.sh`, `web-playground/src/App.tsx`,
  `web-playground/src/ui/Home.tsx`, `web-playground/src/ui/Nav.tsx`,
  `web-playground/tests/app.test.tsx`, `tsconfig.app.json`
  (`resolveJsonModule`), `README.md` (+2 install commands), and the count lines
  in `README.md` / `REMAINING.md` / `TESTRESULT.md` / `PRODUCTION.md`.

### The two §12f gate bugs (diagnosed and fixed)

**Bug 1 — the install-command extractor matched zero lines.**
The pattern `grep -oE '^\s+(curl|brew|…)'` never matched because every page line
starts with `code:` (a JS object property), not the command itself. The gate was
therefore green without testing anything. Fixed by inlining an awk
state-machine extractor (it only lives in the test script — `/tmp` has been wiped
before, so nothing durable is referenced there).

**Bug 2 — the extractor missed `code={\`…\`}` JSX blocks.**
The widened pattern matched only the
`code:` object-property forms; it missed the inline JSX template literals and the
`code: \`…\`` pacman block. Fixed: the extractor now understands all three forms
(`code: "…"`, `code: \`…\``, and JSX `code={\`…\`}`).

### The two genuine extractor results (reconciled)
- `sudo apt install ./hmx_0.10.0_amd64.deb` and
  `curl -fsSLO …/v0.10.0/SHA256SUMS` were on the page but **absent from
  `README.md`**. Both were added to the README's Install section, so the gate is
  honest (the gate is "every install command on the page also appears in the
  docs").
- The `install.ps1` hit was a false positive from a README markdown-table pipe
  escape (`\|`); the comparison now normalises `\|` → `|` first.

### Steps
1. Inline the working awk extractor into `tests/run_packaging_tests.sh` §12f and
   widen it to also match `code={\`…\`}` JSX template literals.
2. Normalise `\|` when searching `README.md`.
3. Add `sudo apt install ./hmx_0.10.0_amd64.deb` and the `SHA256SUMS` curl line
   to `README.md`.
4. **Re-run all six §12f controls**, reintroducing each bug to prove the gate
   fails. In particular re-check **control 4** (catch-all route) — the earlier
   `sed` that should have reintroduced the bug apparently did not apply; verify
   the file actually changed (`App.tsx` must not contain
   `<Route path="*" element={<NotFoundPage />} />` while the control runs).
5. `npx vite-node web-playground/tools/smoke/gen-data.mts` (re-snapshot native +
   run the web compiler against them).
6. `npm run test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`.
7. Run all native + packaging suites + valgrind:
   `./tests/run_{integration,negative_tests,stress_tests,cli_tests,packaging_tests}.sh`
   and `./tests/run_valgrind_tests.sh --fixtures`.
8. Update the counts (**packaging 160, native 478, total 638, vitest 463,
   valgrind 69**) consistently across `README.md`, `TESTRESULT.md`,
   `PROGRESS.md`, `REMAINING.md`, `SYNTAX.md`, `web-playground.md`, `AGENTS.md`.
9. Commit (signed) + push; verify CI `ci` 6/6 and GitHub reports
   `verified=true`.

### Acceptance criteria
- Every §12f gate **fails when its bug is reintroduced** (a gate never seen to
  fail is not known to work). ✅ 6/6 controls fired.
- `npm run test` 463/463; native + packaging + valgrind all green. ✅
- No doc asserts a count the tree does not produce. ✅
- Commit signed and pushed; CI green.

### Risks / watch-outs
- Do **not** stack M17 on top of this until it is committed.
- The retired GPG fingerprint is legitimately allowed in `REMAINING.md` as
  history — the gate excludes it by scope, not by a special-cased failure string.
- `/tmp/opencode` has been wiped twice; never rely on it for anything durable.

---

## Item 2 — Tier 0 safety slice

### Why it is second
These three changes are cheap, independent of each other, and they **de-risk
M17/M18** before any language surface changes. Doing them now means the new
features get fuzzed and UB-checked from day one instead of retrofitted.

### 2a. Decide the cycle-collection strategy (0.3)
The current model (M15) assumes cycles are impossible because closures snapshot
captured values by value. Generics + `Result`/`Option` values + any future
mutable/self-referential data can break that assumption, and a pure refcount
runtime then leaks silently.

**Deliverable:** a short decision record — `docs/adr/0001-cycle-collection.md`
(or a `## Memory` section in `ROADMAP.md`) — choosing one of:

| Option | What it means | Cost |
|---|---|---|
| **A. Keep snapshot semantics + reject cycles statically** | Rust-like: no cycles by construction; compiler errors on self-referential by-value aggregates. | Cheapest; already half-true; constrains the language. |
| **B. Add a cycle collector (trial deletion / Bacon–Rajan) to the refcount runtime** | Keeps refcount's determinism; collects cycles in a periodic pass. | Medium; touches the whole runtime; needs the valgrind matrix extended. |
| **C. Add `Weak` references** | Breaks cycles manually at the API level. | Small runtime change; shifts burden to the programmer; needs a `weak` type. |

**Recommendation:** choose **A** now (it matches the existing design and costs
almost nothing), and document **C** as the escape hatch when cycles genuinely
become expressible. Revisit B only if profiling shows leaked cycles.

**Acceptance:** the chosen option is written down with its trade-off table; if A,
a named negative-test family exists for self-referential by-value types.

### 2b. Add UBSan to CI (0.4)
Add a `ubsan` job to `.github/workflows/ci.yml` mirroring the `asan` job but with
`-fsanitize=undefined -fno-sanitize-recover=all` (via the existing `HMX_*`
build hook, or a new `HMX_UBSAN=1`). Run the integration + stress suites.
Any existing UB found is either fixed or documented as a known issue with a
tracking note.

**Acceptance:** the job exists, runs, and is green; at least one deliberately
introduced UB case proves the job fails (e.g. an `int` overflow fixture under
`-fno-sanitize-recover`).

### 2c. Add a front-end fuzz target (0.5)
Add a libFuzzer harness over **lexer → parser → resolver** (not codegen, so no
`gcc` dependency). Seed the corpus from `tests/fixtures/*.hmx` plus the inline
negative-test sources. Run a bounded iteration count in CI (or nightly) so it
cannot flake the required checks, and a longer run on demand.

**Acceptance:** the target builds, runs N iterations without a crash/leak, and a
known-bad seed (reintroduced bug) is caught.

### Risks / watch-outs
- UBSan may surface real latent UB in the generated C (signed overflow is the
  expected one) — budget time to triage, not just wire up.
- The fuzzer needs the front end factored so it can run in-process without
  writing files; if that is too invasive, start with a subprocess harness.
- Keep both jobs **non-blocking-optional** at first if they would otherwise gate
  unrelated PRs, then promote to required once stable.

---

## Ordering

```
Item 1  →  Item 2a  →  Item 2b  →  Item 2c  →  M17 (generics)
```

Item 1 must land first (clean green baseline). Items 2a–2c are independent and
can land in any order, but all three should precede M17 so the new abstractions
are covered by the new checks from the start.
