# ADR 0002 — Generics by monomorphization

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** project owner
- **Affects:** M17 (generics), M18 (`Option[T]` / `Result[T, E]`),
  M21 (`HashMap[K, V]` / `Set`), `SYNTAX.md` §20

## Context

HMX has concrete types only. Every reusable data structure has to be written
once per element type, which is fine for the current stdlib-free language but
blocks the two things the roadmap wants next: generic algorithms
(`map`/`filter`/`find`) and a single implementation of the collection types
(`HashMap[K, V]`, `Set[T]`) that M21 calls for.

Two facts from the existing codebase shape the decision:

1. The language already uses `[ ... ]` for types (`[int]`, `[[int]]`), and its
   parser builds named-type references as a *name* that a later resolver pass
   expands (`SYNTAX.md` §17–19). Generics can reuse both without new tokens.
2. Generic instantiation has a precedent: partial application already
   **monomorphizes** a specialized wrapper per argument-type combination, with a
   mangled name (`CodeGen::papp_mangle`). The instantiation plumbing the roadmap
   points at is real and small.

There is also a constraint from ADR 0001: any new owning container inherits the
reference-cycle rules, and generics are what make recursive containers
expressible in the first place (`struct Node[T] { kids: [Node[T]] }`).

## Options

| Option | What it means | Cost | Effect |
|---|---|---|---|
| **A. Monomorphization** | Every distinct type-argument list produces its own concrete function/struct; each is compiled and type-checked independently. C++-template semantics. | Medium: needs AST cloning + a per-instantiation resolution pass. No runtime change. | No constraints needed. Specializations are as fast as hand-written code. Compile time and code size grow with the number of distinct instantiations. Errors surface at the instantiation site. |
| **B. Type erasure / boxing** | One generic implementation over boxed values with a runtime type tag; casts at boundaries. | Medium–high: touches codegen and the runtime type representation, and reclaims ownership/copy semantics on the boxed path. | Smaller code, but boxing breaks value semantics (structs become pointers), complicates refcounting, and is slower on the common `int`/`text` instantiations. |
| **C. Constraints-first (traits/bounds)** | Require `T: Numeric`-style constraints, check the body generically once. | High: needs a trait system first (`PRODUCTION.md` 1.6). | Best diagnostics, but it makes M17 depend on a milestone that does not exist. |
| **D. Hand-written per-type structs** | No language feature; write `IntMap`, `TextMap`, … by hand. | Low now, unbounded later. | Not reusable; the opposite of the goal. |

## Decision

1. **Syntax: `[T]` after the declaration name.** `fn identity[T](x: T) -> T`,
   `struct Box[T] { value: T }`, `struct Pair[A, B] { ... }`. The parser already
   treats `[ ]` as type syntax, so this adds no tokens and (verified during
   M17.1) no new Bison conflicts.
2. **Adopt A — monomorphization.** Each distinct set of type arguments is its own
   concrete specialization, type-checked and compiled independently, with a
   mangled name that extends `papp_mangle_type` (e.g. `identity_int`,
   `Box_int`). The generic declaration emits nothing.
3. **No constraints.** Generic bodies are checked **per instantiation** (the
   C++ template model): `fn add_one[T](x: T) -> T { return x + 1 }` is valid for
   `int` and a compile error for `text`. The declaration is not validated in
   isolation. This is what makes B unnecessary and C deferrable — a constraints
   system can be layered on later without changing the lowering.
4. **Inference at call sites; no explicit instantiation.** `identity(5)` infers
   `T = int`; a constructor call infers from its arguments. There is no
   `identity[int](5)` form, because `[` after a name in expression position is
   array indexing. Explicit type arguments appear only in type position.
5. **Scope of M17.** Generic **functions** first, then generic **structs**, plus
   `alias`es that name an instantiation. Generic `alias`/`enum` declarations,
   variadic generic parameters, explicit instantiation, and constraints/traits
   are explicitly out of scope.
6. **Cycles.** Generic structures inherit ADR 0001 unchanged: by-value
   self-containment (`struct Node[T] { next: Node[T] }`) is rejected; heap
   self-reference (`struct Node[T] { kids: [Node[T]] }`) is legal. `weak T`
   (ADR 0001 option C) is the designated back-edge mechanism when recursive
   containers become a first-class use case, and is **not** part of M17.

## Consequences

- **Code size / compile time** scale with the number of distinct instantiations,
  not with the number of generic declarations. Dropping an unused generic
  function emits nothing, because specializations are created on demand.
- **Diagnostics point at the instantiation.** A body error is reported against
  the template's source line, and the negative family pins the inference-failure
  and wrong-arity messages. Richer "instantiated from here" notes are a possible
  follow-up, not a requirement.
- **New machinery is confined to the front end.** The one genuinely new
  subsystem is AST cloning (the template body is resolved once per
  instantiation). It runs after the existing `HMX_MAX_NESTING` guard, so a
  recursive clone is stack-safe. Codegen only needs to skip templates and mangle
  instantiated struct names.
- **Web parity is mandatory.** The grammar changes, so
  `web-playground/tools/extract_parser_table.mjs` must be regenerated and the
  web `ast`/`resolver`/`codegen_js` mirror the native clone-and-instantiate pass;
  `gen-data.mts` + `npm run test` stay byte-identical.
- **ADR 0001 is reaffirmed, not weakened.** Generics add no new owning semantics.

## Enforcement

- `tests/fixtures/` — programs exercising generic function inference, generic
  structs, nested instantiation, recursive generic structs with array fields,
  and generic functions over aggregate types.
- `tests/run_negative_tests.sh` — a generics family: duplicate type parameter,
  too few / too many type arguments, type arguments on a non-generic name,
  missing type arguments, inference failure, an instantiation the body does not
  type-check, and by-value self-containment of a generic struct.
- `tests/run_stress_tests.sh` — exact output for the fixture specializations.
- `tests/run_valgrind_tests.sh --fixtures` — the generic struct
  retain/release helpers under the ownership matrix.
- `web-playground/tools/smoke/gen-data.mts` + `npm run test` — native↔web
  parity on every new case.

## Revisit triggers

- A user cannot use a generic function as a first-class value because its type
  arguments are ambiguous.
- Instantiation count makes compile time or binary size a problem on a real
  program (would motivate erasure for a subset, or an explicit-instantiation
  syntax).
- Constraint errors become the dominant diagnostic complaint — the signal to
  start the traits work (option C).
- A generic container becomes the first real need for `weak T` (ADR 0001 C).
