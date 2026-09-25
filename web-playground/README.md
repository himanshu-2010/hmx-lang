# HMX Web Playground

A Vite + React + TypeScript playground for testing HMX programs in the browser.
No backend, no native toolchain — the compiler runs entirely client-side.

Status: **M1 scaffold**. The editor → output shell works; the real compiler
(lexer + LALR parser tables + type resolver ported to TypeScript, with a new
JavaScript backend replacing `gcc`) lands in M2–M4. See
[PLAN.md](PLAN.md) for the architecture and milestone gate (parity with the
358 native test cases).

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # vitest (parity harness grows with the port)
npm run build      # type-check + production build
npm run preview    # serve the production build
```

## Project layout

```
src/compiler/   the ported core (pure TS, no React): lexer, LALR tables,
                resolver, JS codegen, runtime, vm — `program.ts` is the front door
src/ui/         React components: Editor, Output, ErrorPanel, runner
tests/          parity.test.ts — reruns the native suite's cases against the
                web compiler (green = web compiler matches `build/hmx`)
```