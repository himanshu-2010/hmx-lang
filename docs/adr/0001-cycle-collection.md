# ADR 0001 — Cycle collection in the reference-counted runtime

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** project owner
- **Affects:** M15 (reference counting), M17 (generics), any future container or
  error-value type

## Context

M15 made `text`, arrays, closure environments and `Node`-style aggregates
reference-counted, with copy-on-write views. Ownership is simple and
deterministic: a **local owns** its value, a **parameter borrows** it, and a
released value drops its count to zero immediately (no GC pauses, no finaliser
ordering surprises). That determinism is a feature, not an accident.

The design also assumed, in `ROADMAP.md` §2 and in the M15 notes, that **cycles
are impossible** — or at least not expressible — so a count can always reach
zero. The specific argument was that closures *snapshot* their captures by value,
so a closure cannot reference its own environment.

That argument is true for closures. It is **not** true for aggregates that hold
reference-typed fields.

## The assumption is false: a reproducible cycle leak

A value-type struct may hold an array field, and arrays are reference values
(aliases share storage). That is enough to build a cycle the runtime cannot
reclaim:

```hmx
struct Node { children: [Node] }

fn main() -> int {
    let kids: [Node] = []
    let n = Node(kids)
    push(n.children, n)   // n's own children array now holds a copy of n
    return 0
}
```

The element stored in `children` is a `Node` whose `children` field *is* the same
array (array fields are shared on copy). The array's count therefore includes a
reference that lives inside the array itself. The count never reaches zero.

Measured, not theorised:

```
$ valgrind --leak-check=full ./hc
definitely lost: 48 bytes in 1 blocks
indirectly lost: 136 bytes in 1 blocks
ERROR SUMMARY: 1 errors from 1 contexts
```

The compiler rejects the **by-value** version of this cycle
(`struct Node { next: Node }` → *"struct type 'Node' cannot contain itself by
value"*). It cannot reject the heap version without also forbidding the
recursive data structures — trees, graphs, linked lists — that are the whole
point of a systems language. `struct Node { children: [Node] }` is idiomatic and
must keep working.

So "reject cycles statically" is **necessary but not sufficient**, and the real
open question is what to do about reference cycles.

## Options

| Option | What it means | Cost | Effect on the language |
|---|---|---|---|
| **A. Reject by-value cycles statically** | Compiler errors on self-referential by-value aggregates (direct or via a cycle of structs). | Already implemented. | None for reference types; `[Node]` fields stay legal. **Does not address the leak above.** |
| **B. Cycle collector (trial deletion / Bacon–Rajan)** | Periodic pass that finds reference cycles and reclaims them, keeping refcount's determinism. | Medium–high: touches the whole runtime; needs its own tests and an extended valgrind matrix. | None. Cycles are collected automatically. |
| **C. `Weak` references** | A `weak T` type that does not own its referent; a weak count does not keep the target alive. Back-edges become `weak`. | Small runtime change; a new type and its rules. | Recursive types gain an ownership/precision split (as in Rust `Rc`/`Weak`, Swift `weak`). Strong cycles still leak if the programmer leaves one. |

## Decision

1. **Keep A.** By-value self-containment stays a compile error, and a named
   negative-test family pins it (direct, mutual, and three-type cycles).
2. **Adopt C as the designated mechanism for reference cycles.** A `weak T` (name
   provisional) is the supported way to break a back-edge, and should arrive with
   the first milestone that makes recursive data structures a first-class use
   case — M17/M18, or a standard-library container, whichever lands first.
3. **Defer B.** Automatic collection is the more "it just works" answer, but it is
   the most expensive and it is not needed to *ship*: the leak is bounded by the
   number of live cycles, not by program duration, and short-lived CLI programs
   reclaim at exit. Revisit B if and only if **both** hold: (a) long-running
   programs become a target, and (b) `Weak` proves insufficient in practice.
4. **Until C lands, the leak is documented, not silent.** This record and
   `PRODUCTION.md` §0.3 name it, the reproduction above is checkable, and the
   behaviour is treated as a known limitation rather than a surprise.

## Enforcement

- `tests/run_negative_tests.sh` — the **by-value cycle family**:
  `m16_struct_value_self_containment` (direct),
  `m16_struct_value_mutual_containment` (A ↔ B), and
  `m16_struct_value_cycle_of_three` (A → B → C → A). All expect
  `cannot contain itself by value`.
- The reference-cycle leak itself is **not** a permanent red gate (a deliberate,
  documented leak would either fail valgrind forever or have to be special-cased,
  and both train people to ignore the gate). It is reproduced in this ADR
  instead.

## Consequences

- Recursive structures are expressible **today** and leak if they contain a
  strong cycle. Programs that build trees/arena-like data and drop the root
  before exit should either avoid cycles or (once available) mark back-edges
  `weak`.
- M17/M18 must not assume "cycles are impossible". Any new owning container or
  error value inherits this ADR.
- The runtime keeps its deterministic, no-GC character for the acyclic case,
  which is the overwhelmingly common one.

## Revisit triggers

- A milestone adds a first-class recursive type or auto-generated back-link.
- A contributor cannot express a needed data structure without a leak and
  `Weak` is not yet available.
- A long-running HMX service or benchmark shows unbounded growth.
