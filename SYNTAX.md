# HMX — Language Syntax Reference

**Version 1.0 (core spec)**

A custom programming language that transpiles to C. This document is the authoritative
syntax reference for the HMX language. It follows the same structural layout as the
standard C reference documentation, but uses HMX's own syntax, types, and conventions.

> **Scope note:** Sections marked **[Implemented]** are features the compiler currently
> compiles and runs end-to-end. Sections marked **[Spec]** are fully designed syntax that is
> part of the core language specification but not yet wired into the compiler. Anything not
> listed here, or listed under **[Roadmap]**, is not part of the current language.

---

## Contents

1. [Basic Concepts](#1-basic-concepts)
2. [Keywords](#2-keywords)
3. [Identifiers](#3-identifiers)
4. [Comments](#4-comments)
5. [Types](#5-types)
6. [Literals](#6-literals)
7. [Variables and Declarations](#7-variables-and-declarations)
8. [Operators](#8-operators)
9. [Expressions](#9-expressions)
10. [Statements](#10-statements)
11. [Control Flow](#11-control-flow)
12. [Functions](#12-functions)
13. [Built-in Functions & Output](#13-built-in-functions--output)
14. [Error Handling](#14-error-handling)
15. [Roadmap (planned features)](#15-roadmap-planned-features)

---

## 1. Basic Concepts

### 1.1 Program Structure

A HMX program is a sequence of statements and function declarations in a `.hmx` file.
`use` statements at the very top of the file pull in top-level functions from other
`.hmx` modules (§1.6). Execution begins in the `main` function.

```hmx
fn main() {
    print("Hello, HMX!")
}
```

### 1.2 Translation Model

HMX source is transpiled to C, then compiled with `gcc -O2` to a native executable:

```
yourfile.hmx  --[HMX Compiler]-->  build_temp.c  --[gcc -O2]-->  native executable
```

### 1.3 Blocks

Braces `{ }` delimit every block: function bodies, `if`/`else` bodies, and loop bodies.
There is no significant indentation; whitespace is ignored.

```hmx
fn main() {
    let count = 5
    if (count > 0) {
        print("positive")
    }
}
```

### 1.4 Case Sensitivity

Identifiers and keywords are case-sensitive. `Loop`, `LOOP`, and `loop` are three
different tokens; only `loop` is a keyword.

### 1.5 Type Inference

HMX prefers type inference. Variables infer their type from their initializer.
Explicit annotations are optional and additive.

### 1.6 Modules **[Implemented]**

A program can span multiple `.hmx` files. The entry file (the file passed to the
compiler) is compiled together with every file it imports, transitively.

**Syntax:**

```
use "<relative or absolute path>"
```

**Rules:**
- `use` statements must appear at the very top of a file, before any declarations.
- Module paths are relative to the directory of the importing file; `.hmx` extension
  is required.
- Each file is loaded at most once per program (imports are deduplicated by canonical
  path), so a diamond `a → b,c → d` layout compiles `d` once.
- Import cycles (including a module `use`-ing the entry file) are a compile error.
- Top-level functions from all modules join the same namespace as the entry file; the
  existing duplicate-function check applies across modules, and `main` must come from
  the entry file.
- Diagnostics from imported modules are tagged with the module's path and line, e.g.
  `Error [lib/math.hmx:12]: ...`. Errors in the entry file use the plain
  `Error [line 12]: ...` form.
- Imported modules may themselves use other modules, define closures, capture state,
  and use non-local `break`/`continue`, with no restrictions.

```hmx
// main.hmx
use "lib/math.hmx"

fn main() {
    print(area_of_circle(2.0))
}
```

```hmx
// lib/math.hmx
fn area_of_circle(r: decimal) -> decimal {
    return 3.14159 * r * r
}
```

When the entry file fails to parse, the compiler reports `Error: parsing failed`;
when an imported module fails to parse, it reports
`Error: parsing failed in module '<path>'`.

---

## 2. Keywords

The following words are reserved and cannot be used as identifiers:

| Keyword | Use |
|---|---|
| `let` | Variable declaration |
| `fn` | Function declaration |
| `if` | Conditional branch |
| `else` | Alternative branch |
| `loop` | Counted loop |
| `while` | Conditional loop |
| `foreach` | Element-wise iteration |
| `for` | Header-controlled loop |
| `do` | Post-condition loop |
| `break` | Exit the enclosing loop early |
| `continue` | Skip to the next iteration of the enclosing loop |
| `print` | Output statement |
| `in` | `foreach` iterable separator |
| `return` | Function return value |
| `true` / `false` | Boolean literals |
| `and` / `or` / `not` | Boolean operators (word forms) |
| `int` / `decimal` / `text` / `bool` | Type names |
| `char` / `byte` | Integer-like types |
| `switch` / `case` / `default` | Multi-way branch |
| `as` | Explicit numeric cast |
| `use` | Import a module (§1.6) |

---

## 3. Identifiers

Identifiers name variables and functions.

**Syntax:**
```
identifier  : [a-zA-Z_][a-zA-Z0-9_]*            (ASCII identifiers)
            : any sequence of non-ASCII (UTF-8) bytes  (Unicode identifiers)
```

**Rules:**
- An identifier starts with a letter or underscore, or is a sequence of non-ASCII
  (UTF-8) bytes.
- May contain ASCII letters, digits, and underscores; Unicode identifiers may contain
  any non-ASCII byte.
- Unicode identifiers are treated as opaque UTF-8: no normalization or case folding.
  They are emitted verbatim into the generated C (gcc accepts them verbatim too).
- Cannot be a reserved keyword (§2).

```hmx
let count = 5
let _private = 10
let número = 7
let 日本語 = "text"
fn addNumbers() {
    print(1)
}
```

---

## 4. Comments

Both line comments and block comments are supported. Comments are stripped during
lexing and never affect program behavior.

### 4.1 Line Comments

`//` begins a line comment that runs to the end of the line.

```hmx
let count = 5   // this is a line comment
```

### 4.2 Block Comments

`/* ... */` begins a block comment and runs to the matching `*/`. Block comments
may span multiple lines. They do **not** nest.

```hmx
/*
   A multi-line
   block comment
*/
let name = "Boss"
```

---

## 5. Types

HMX has four primitive types. Each maps to a C type and a `print` format
specifier.

| HMX type | Meaning | C type | Format specifier |
|---|---|---|---|
| `int` | integer | `int` | `%d` |
| `decimal` | floating-point | `double` | `%f` |
| `text` | string | `char*` | `%s` |
| `bool` | boolean (0/1) | `int` | `%d` |

### 5.1 Type Inference

Types are inferred from initializers unless explicitly annotated:

```hmx
let count = 5          // int
let ratio = 2.5        // decimal
let name = "Boss"      // text
let flag = true        // bool
```

### 5.2 Explicit Type Annotation

Use `:` followed by a type name to annotate a declaration:

```hmx
let total: int = 0
let pi: decimal = 3.14
let greeting: text = "hi"
let ready: bool = false
```

When annotated, the initializer's type must match the annotation. A mismatch is a
compile error:

```hmx
let x: int = "hello"   // Error: type mismatch
```

### 5.3 Array Types **[Implemented]**

An array is an ordered collection of elements of a single type, held in
heap-allocated growable storage. Arrays are declared with a `[type]` annotation
(or inferred from a non-empty literal):

```hmx
let scores: [int] = [10, 20, 30]
let names: [text] = ["alice", "bob"]
let empty: [int] = []
```

Element types may be any type including nested arrays or tuples: `int`,
`decimal`, `text`, `bool`, `char`, `byte`, another array type, or a tuple type
(`[(int, int)]`). Nested arrays
(`[[int]]`) are supported: element type descriptors are recursive, so
multi-dimensional arrays can be annotated, inferred from nested literals
(`let m = [[1, 2], [3, 4]]`), indexed (`m[i][j]`), assigned (`m[i][j] = v`),
and walked with nested `foreach`. An empty array literal (`[]`) requires an
explicit annotation so the compiler can infer the element type; a non-empty
literal infers its element type from its elements.

Arrays are reference values: assigning one array variable to another (`let b = a`)
shares the backing storage, so element writes or structural changes (`push`,
`pop`, `sort`) through either name are visible through both. The backing storage
is heap-allocated by the generated code; arrays are growable (`push`) and carry
spare capacity so repeated growth does not re-allocate on every push. The
growable built-ins are described in §13.4.

### 5.4 Tuple Types **[Implemented]**

A tuple is an ordered, fixed-size group of 2+ values of possibly different types.
Tuples exist only as first-class values produced by functions — there is no tuple
literal expression.

```hmx
fn divmod(a: int, b: int) -> (int, int) {
    return a / b, a - (a / b) * b
}

fn make_pair() -> (int, text) {
    return 7, "hi"
}

fn main() {
    let (q, r) = divmod(17, 5)   // destructuring let
    let pair = divmod(10, 3)     // whole-tuple variable
    let annotated: (int, int) = divmod(5, 2)

    print(pair[0])               // constant index access
    print(pair[1])

    (q, r) = divmod(20, 7)       // multi-assignment
}
```

Rules:

- A tuple must have at least two members.
- Members may be `int`, `decimal`, `text`, `bool`, `char`, `byte`, an array
  (`[int]`, etc.), or another tuple — nested tuples (`((int, int), int)`) and
  arrays of tuples (`[(int, int)]`) are supported.
- Tuples are value types. Passing a tuple to a function or returning one copies it.
- A tuple index may be a compile-time `int` constant (`t[0]`, resolved directly to
  that member). A runtime `int` index (`t[i]`) is also supported **when every member
  has the same type**; the result has that type and the index is bounds-checked at
  runtime. Dynamic indexing of a heterogeneous tuple is a compile error.
- Tuple element assignment (`t[0] = x`) is not supported.
- Tuples cannot be `print`ed, compared, combined arithmetically, used in `length`,
  or used as a ternary branch — destructure them or index their elements instead.
- A function with a tuple return type must return exactly the right number of values,
  each matching the declared member type. A bare `return` requires a void function.
- Destructuring requires `let` and cannot appear in `for` loop headers or update
  clauses.

---

## 6. Literals

### 6.1 Integer Literals

Sequences of digits, non-negative.

```hmx
0
5
42
```

### 6.2 Decimal Literals

A fraction of a decimal point. Must have digits on both sides of the point.

```hmx
2.5
3.14
0.0
```

### 6.3 Text (String) Literals

Double-quoted sequences. `"..."`.

```hmx
"hello"
"HMX active!"
```

### 6.4 Boolean Literals

`true` and `false`.

```hmx
true
false
```

### 6.5 Character Literals

Single-quoted literals represent one character and infer the `char` type. `byte` is
an unsigned 8-bit value and is commonly declared with an annotation.

```hmx
let initial: char = 'H'
let code: byte = 72
print(initial)
print(code)
```

Byte values must be between `0` and `255`. `char` and `byte` can be explicitly cast
to numeric types with `as`, but they are not arithmetic operands.

---

## 7. Variables and Declarations

### 7.1 Declaration

`let` introduces a variable. Its type is inferred or annotated (§5).

**Syntax:**
```
var_decl  : "let" IDENTIFIER (":" param_type)? "=" expression
          | "let" "(" id_list ")" "=" expression
param_type : TYPE | "[" param_type "]" | "(" elem_list ")"
           | "fn" "(" fn_type_params? ")" "->" param_type
elem_list : param_type ("," param_type)+
id_list   : pattern_item ("," pattern_item)+
pattern_item : IDENTIFIER | "..." IDENTIFIER | "(" id_list ")"
```

```hmx
let count = 5
let total: int = 0
let pair: (int, int) = divmod(9, 2)
let (q, r) = divmod(9, 2)    // destructuring declaration
let doubler: fn(int) -> int = twice   // function value (see §12.5)
```

`const` declares an immutable value. Constants can be read but cannot be assigned,
incremented, or changed with compound assignment.

```hmx
const limit: int = 10
print(limit)
```

### 7.2 Assignment

Variables can be reassigned after declaration with the plain assignment operator.

```hmx
let count = 5
count = 10
```

A parenthesized list of existing variables can be assigned a tuple in one
multi-assignment statement. The target count and member types must match the tuple.
Arrays and text use the same syntax with a length check and optional `...rest` —
see §7.5.

```hmx
let (q, r) = divmod(9, 2)
(q, r) = divmod(20, 7)    // both variables updated
```

### 7.3 Compound Assignment

Shorthand that combines assignment with arithmetic:

| Operator | Meaning |
|---|---|
| `+=` | `a = a + b` |
| `-=` | `a = a - b` |
| `*=` | `a = a * b` |
| `/=` | `a = a / b` |
| `%=` | `a = a % b` (int only) |

```hmx
let count = 5
count += 3       // count is now 8
count *= 2       // count is now 16
let leftover = 17
leftover %= 5    // leftover is now 2
```

### 7.4 Increment / Decrement

`++` increments by one; `--` decrements by one. Postfix form only (the value used in
an expression is the pre-incremented value).

```hmx
let count = 5
count++          // count is now 6
count--          // count is now 5
```

### 7.5 Array and Text Destructuring **[Implemented]**

Arrays and text values support destructuring declarations and multi-assignment
in the same parenthesized form as tuples. Each name binds the element at its
position (arrays) or the character at that index (text); a trailing `...name`
binds everything from that position onward — an array of the same element type,
or a text substring. The runtime abort shown on the last line terminates the
generated program when the source has fewer elements than the number of fixed
targets.

```hmx
let scores: [int] = [10, 20, 30, 40]
let (high1, high2, ...rest) = scores
print(high1)             // 10
print(high2)             // 20
print(rest[0])           // 30
print(length(rest))      // 2

let name = "ada"
let (c0, c1, ...tail) = name
print(c0)                // a
print(c1)                // d
print(tail)              // a
print(length(tail))      // 1

let (a, b) = [1, 2, 3]   // extra elements are ignored
print(a, b)              // 1 2

let (x, y) = [9]         // Error: cannot destructure array of length 1 into 2 targets
```

Patterns nest: any slot of a parenthesized list may itself be a parenthesized
list. A nested slot takes its value from that position (the corresponding tuple
member, array element, or text character) and destructures it the same way —
so nested tuples, arrays of tuples, arrays of arrays, and text-array elements
all compose. `...rest` may appear at any nesting level.

```hmx
fn mk_pair(x: int) -> (int, int) { return x, x * 10 }
fn mk_nested() -> ((int, int), int) { return mk_pair(1), 2 }
fn mk_deep() -> (((int, int), int), int) { return mk_nested(), 4 }
fn main() {
    let (((a, b), c), d) = mk_deep()      // deep nesting
    let pairs: [(int, int)] = [mk_pair(5), mk_pair(6)]
    let ((p, q), second) = pairs          // tuple inside an array element
    let grid: [[int]] = [[1, 2, 3], [4, 5]]
    let ((x, y, ...row_rest), row1) = grid // ...rest inside a nested group
    let words: [text] = ["hi", "ok"]
    let (w0, (c1, c2)) = words            // nested pattern on a text element
    ((p, q), second) = mk_nested()        // nested multi-assignment
}
```

A nested slot's value must itself be a tuple, array, or text — destructuring a
scalar (`int`, `decimal`, `char`, …) into a nested pattern is a compile error.
`...rest` must be the last slot of its list.

Rules:

- Tuple destructuring requires an exact member-count match and rejects `...rest`.
- Array/text destructuring binds the first `N` elements (or characters) and
  requires at least `N` at runtime; `...rest` captures the remainder (possibly
  empty) as a new `[element-type]` array or `text`.
- Multi-assignment forms (`(a, b, ...rest) = expr`) are supported with the same
  semantics; all targets must already exist and be mutable, and the element
  type of the source must match the declared types of the targets (`...rest`
  targets must be arrays of the source's element type, or `text`).
- The whole thing applies to any array- or text-valued expression:
  `(first, ...tail) = split("a,b", ",")` and `(head, ...rest) = grid[i]` work.
- Slots nest: a slot's value (tuple member, array element, or text character)
  may itself be destructured if it is a tuple, array, or text; each nested list
  follows these same rules, including its own optional trailing `...rest`.
- Destructuring on any other type is a compile error, as is using `...rest`
  when destructuring a tuple.

### 7.6 Explicit Numeric Casts

Use `as` for explicit conversion between `int` and `decimal`. There is no implicit
numeric promotion, and casts involving `text` or `bool` are rejected.

```hmx
let precise = 7 as decimal
let whole = precise as int
```

---

## 8. Operators

### 8.1 Arithmetic Operators

Work on `int` and `decimal` operands. Both operands must be the same type; mixing
`int` and `decimal` in one operation is a compile error. The `%` operator is `int` only.

| Operator | Meaning | Example |
|---|---|---|
| `+` | addition (int/decimal), concatenation (text), unary plus (int/decimal) | `a + b`, `+x` |
| `-` | subtraction; unary negation (int/decimal) | `a - b`, `-x` |
| `*` | multiplication | `a * b` |
| `/` | division | `a / b` |
| `%` | modulo (remainder) — int only | `a % b` |

```hmx
7 % 3         // 1
10 % 2        // 0
-5            // unary minus, value -5
-100 % 7      // -2
5.5 % 2.5     // ERROR: '%' only works on int
```

When an operator combines two `text` operands, only `+` is allowed and it performs
string concatenation (lowered to a runtime `sd_concat`, left-associative for chained
concatenation). All other arithmetic operators require `int`/`decimal` operands.

**Operator precedence** (highest to lowest):

| Precedence | Operators | Associativity |
|---|---|---|
| 1 (highest) | `( )` grouping | — |
| 2 | unary `+` `-` `not`/`!` | right |
| 3 | `*` `/` `%` | left |
| 4 | `+` `-` | left |

```hmx
let result = 2 + 3 * 4   // 14, multiplication first
let x = (2 + 3) * 4      // 20, grouping first
```

### 8.2 Comparison Operators

Compare two values of the same type and produce a `bool`.

| Operator | Meaning |
|---|---|
| `==` | equal to |
| `!=` | not equal to |
| `<` | less than |
| `>` | greater than |
| `<=` | less than or equal |
| `>=` | greater than or equal |

```hmx
5 == 5       // true
5 < 3        // false
"a" != "b"   // true
```

### 8.3 Boolean Operators

Compose `bool` values. Both word forms and C-style symbol forms are valid.

| Word | Symbol | Meaning |
|---|---|---|
| `and` | `&&` | logical AND |
| `or` | `\|\|` | logical OR |
| `not` | `!` | logical NOT (unary) |

```hmx
true and false      // false
true or  false      // true
not true            // false
true && false       // false
true || false       // true
!true               // false
```

**Precedence** (highest to lowest): `not`/`!` → comparisons → `and`/`&&` → `or`/`||`.

```hmx
if (a > 0 and b > 0) { }    // parens optional but recommended
if (not ready) { }
```

### 8.4 Ternary Operator

The ternary operator evaluates one of two expressions. Its condition must be `bool`,
and both branches must have the same type. Ternaries associate from right to left.

```hmx
let label = score >= 60 ? "pass" : "fail"
let value = ready ? 1 : enabled ? 2 : 3
```

---

## 9. Expressions

An expression is any combination of literals, identifiers, and operators that
evaluates to a value.

**Grammar (core):**
```ebnf
expression   : conditional
conditional  : logical_or "?" expression ":" expression
             | logical_or
logical_or   : logical_or ("or" | "||") logical_and
             | logical_and
logical_and  : logical_and ("and" | "&&") equality
             | equality
equality     : equality ("==" | "!=") relational
             | relational
relational   : relational ("<" | ">" | "<=" | ">=") additive
             | additive
additive     : additive ("+" | "-") term
             | term
term         : term ("*" | "/" | "%") factor
             | factor
factor       : NUMBER | DECIMAL | STRING
             | "true" | "false"
             | "not" factor | "!" factor
             | "+" factor        // unary plus (identity)
             | "-" factor        // unary minus
             | IDENTIFIER
             | IDENTIFIER "(" args? ")"      // function call
             | postfix_index                  // index chains, e.g. a[0][1]
             | "[" "]"                        // empty array literal
             | "[" args "]"                   // array literal
             | "(" expression ")"
args         : expression ("," expression)*

postfix_index : IDENTIFIER "[" expression "]"
             | postfix_index "[" expression "]"
```

Array indexes must be `int` and are bounds-checked at runtime. Elements of a
one-dimensional array have the array's element type. Index expressions chain:
`a[i][j]` indexes element `j` of row `i`, and a chained indexed element can
be assigned: `grid[0][1] = 99`.

Tuple indexing uses the same `t[i]` syntax. With a compile-time `int` constant the
result is the tuple member at that position. With a runtime `int` expression the
tuple's members must all be the same type; the result has that type and the index is
bounds-checked at runtime (an out-of-range `t[i]` aborts with a tuple index error). A
non-`int` index, an out-of-range constant, a dynamic index on a heterogeneous tuple,
or indexing a non-array, non-tuple value is a compile error.

```hmx
let pair = divmod(9, 2)
print(pair[0])    // first member
print(pair[1])    // second member

let weights = triple(1, 2, 3)   // (int, int, int)
let i = 1
print(weights[i])               // runtime index -> 2
```

Comparison of `text` values is limited: `==` and `!=` are supported (via `strcmp`);
ordering comparisons (`<`, `>`, `<=`, `>=`) on `text` are a compile error.

---

## 10. Statements

A statement is one of the following. Statements execute in sequence.

| Statement | Keyword / form |
|---|---|
| Variable declaration | `let ...` |
| Assignment | `name = expr` / `name op= expr` / `name++` / `name--` |
| Destructuring (tuple / array / text, nestable) | `let ((a, b), ...name) = expr` / `((a, b), ...name) = expr` |
| Array element assignment | `name[index] = expr` |
| Function call | `name(args...)` |
| Output | `print(...)` |
| Conditional | `if (...) { } else { }` |
| Counted loop | `loop(...) { }` |
| Conditional loop | `while (...) { }` |
| Header-controlled loop | `for (init; condition; update) { }` |
| Post-condition loop | `do { } while (...)` |
| Loop control | `break` / `continue` |
| Function declaration | `fn name() { }` |
| Return | `return expr...` or `return` |

### 10.1 Semicolons

HMX does **not** use semicolons for normal statements. Statements are
terminated by the structure of the grammar, and whitespace/newlines are insignificant
(identical to how the parser distinguishes statements). The only semicolons in the
core language are the two separators inside a `for (...)` loop header.

```hmx
let a = 1
let b = 2
print(a + b)
```

---

## 11. Control Flow

### 11.1 The `loop` Statement **[Implemented]**

Repeats a block a fixed number of times, bounded by an `int` expression.

**Syntax:**
```
loop_stmt  : "loop" "(" expression ")" "{" statement+ "}"
```

```hmx
let count = 5
loop(count) {
    print("hello")
}
```

The count expression must evaluate to `int`; otherwise a compile error is raised.

```hmx
let name = "Boss"
loop(name) { }   // Error: loop count must be int, got text
```

### 11.2 The `while` Statement **[Implemented]**

Repeats a block while a boolean condition remains true.

**Syntax:**
```
while_stmt : "while" "(" expression ")" "{" statement+ "}"
```

```hmx
let i = 0
while (i < 5) {
    print(i)
    i++
}
```

The condition expression must evaluate to `bool`; otherwise a compile error is raised.

```hmx
while (5) { }   // Error: while condition must be bool, got int
```

### 11.3 The `for` Statement **[Implemented]**

Runs a loop with an initializer, boolean condition, and update operation in the header.
The initializer may be a `let` declaration or assignment; the update must be an
assignment, compound assignment, `++`, or `--`.

**Syntax:**
```
for_stmt : "for" "(" for_init ";" expression ";" assign_stmt ")" "{" statement+ "}"
for_init : var_decl | assign_stmt
```

```hmx
let total = 0
for (let i = 0; i < 5; i++) {
    total += i
}
```

The condition expression must evaluate to `bool`. A variable declared in the initializer
is scoped to the loop header and body.

```hmx
for (let i = 0; 5; i++) { }   // Error: for condition must be bool, got int
```

### 11.4 The `do-while` Statement **[Implemented]**

Runs a block once, then repeats it while a boolean condition remains true.

**Syntax:**
```
do_while_stmt : "do" "{" statement+ "}" "while" "(" expression ")"
```

```hmx
let i = 3
do {
    print(i)
    i--
} while (i > 0)
```

The condition expression must evaluate to `bool`; otherwise a compile error is raised.
There is no trailing semicolon after the condition.

### 11.5 `break` and `continue` **[Implemented]**

`break` exits the innermost enclosing loop immediately; `continue` skips the rest of
the current iteration and jumps to the loop update / condition.

- Legal only inside `loop`, `while`, `for`, or `do-while` bodies.
- A `switch` case is **not** a loop: a `break`/`continue` directly inside a case
  requires an enclosing loop *within that case*. Since switch cases automatically
  break, a bare `break` in a case with no inner loop is a compile error.
- The `for` loop update runs after `continue`; in `do-while`, `continue` still runs
  the post-body condition check.

```hmx
let i = 0
loop (10) {
    i = i + 1
    if (i == 3) {
        continue      // skip printing 3
    }
    print(i)
    if (i == 5) {
        break         // stop after 5
    }
}                       // prints 1 2 4 5

switch (mode) {
    case 1: loop (10) {
        break           // OK: breaks the inner loop
    }
}
```

```hmx
while (true) {
    if (done) {
        break
    }
}
switch (x) {
    case 1: break       // Error: break inside a switch case requires an enclosing loop
}
```

### 11.6 The `if` Statement

Conditionally executes a block based on a `bool` condition.

**Syntax:**
```
if_stmt   : "if" "(" expression ")" "{" statement+ "}"
          | "if" "(" expression ")" "{" statement+ "}" "else" "{" statement+ "}"
```

```hmx
let score = 75
if (score >= 60) {
    print("passed")
} else {
    print("failed")
}
```

The condition must evaluate to `bool`; otherwise a compile error is raised.

```hmx
if (5) { }   // Error: if condition must be bool, got int
```

`else if` chains are supported and may contain a final `else` branch:

```hmx
if (score < 50) {
    print("fail")
} else if (score < 60) {
    print("pass")
} else {
    print("excellent")
}
```

Each condition must evaluate to `bool`.

### 11.7 The `switch` Statement **[Implemented]**

`switch` selects one matching literal case. Cases automatically break, so execution
does not fall through. The optional `default` branch runs when no case matches.

```hmx
switch (value) {
    case 0:
        print("zero")
    default:
        print("other")
}
```

The switch value and cases must use the same `int`, `byte`, or `char` type. Duplicate
case values and multiple `default` branches are compile errors.

### 11.8 The `foreach` Statement **[Implemented]**

`foreach` iterates over every element of an array or over the characters of a text
value. Both forms accept an optional index variable.

**Syntax:**
```
foreach_stmt : "foreach" "(" IDENTIFIER "in" expression ")" "{" statement+ "}"
             | "foreach" "(" IDENTIFIER "," IDENTIFIER "in" expression ")" "{" statement+ "}"
```

The iterable must be an array or a text value; anything else is a compile error.

```hmx
let scores = [3, 7, 2, 8]
foreach (s in scores) {
    print(s)
}

let words = ["a", "bb", "ccc"]
foreach (i, w in words) {          // i is the 0-based index, w the element copy
    print(i, w)
}

foreach (ch in "abc") {            // iterates chars of the text
    print(ch)
}
```

The loop variable is a **copy** of each element (arrays) or a `char` (text): assigning
to it inside the body never modifies the underlying collection. `break` and
`continue` work inside `foreach` bodies exactly like other loops, and the loop
variable is scoped to the body (referencing it after the loop is an error).

```hmx
let a = [10, 20, 30]
foreach (x in a) {
    x = x * 2              // modifies x only; a[0] stays 10
}
print(a[0])                // 10
```

---

## 12. Functions

### 12.1 Declaration

A function groups a block of statements under a name. `main` is the program entry
point. Its exit code is the integer it returns: if `main` declares `-> int` and
returns a value, that value becomes the process exit code; a `main` without `-> int`
implicitly returns `0`.

```hmx
fn greet() {
    print("hi")
}

fn main() -> int {
    return 7
}
```

### 12.2 Parameters

Functions may declare parameters with explicit types, annotated with `:` to match
the variable-annotation style.

**Syntax:**
```
fn_decl  : "fn" IDENTIFIER "(" param_list? ")" ("->" param_type)? "{" statement+ "}"
param_list : param ("," param)*
param    : IDENTIFIER ":" param_type
         | IDENTIFIER ":" param_type "=" expression
         | IDENTIFIER ":" "... " param_type
param_type : TYPE | "[" param_type "]" | "(" elem_list ")"
           | "fn" "(" fn_type_params? ")" "->" param_type
fn_type_params : param_type ("," param_type)*
elem_list : param_type ("," param_type)+
```

A `param_type` of `fn(<param_types>) -> <type>` is a **function type** (see
§12.5); it may be used for parameter annotations, return types, and
`let`/`const` annotations (writing `let f: fn(int) -> int = ...`).

```hmx
fn add(a: int, b: int) -> int {
    return a + b
}

fn greet(name: text) {
    print(name)
}

fn divmod(a: int, b: int) -> (int, int) {
    return a / b, a - (a / b) * b
}
```

A parameter annotated with a tuple type `(int, int)` receives the tuple by value.

#### Default parameter values

A parameter may declare a default value after `=`; the default must be a literal
that matches the parameter's type.

```hmx
fn greet(name: text, greeting: text = "hello") {
    print(greeting, name)
}

fn retry(count: int = 3) {
    loop (count) {
        print("trying")
    }
}
```

Rules:
- Parameters with defaults must be **trailing**: once a parameter has a default, every
  following parameter must also have one (or be the variadic tail).
- Callers may omit trailing arguments; omitted parameters receive their default.
- The default must be a **constant literal** matching the declared type (`byte`
  defaults are limited to `0..255`).
- Inside the function, a defaulted parameter behaves like a normal parameter.

```hmx
greet("world")        // "hello world"
greet("bob", "hi")    // "hi bob"
retry()               // 3 retries
retry(1)              // 1 retry
```

#### Variadic parameters

A single **trailing** parameter may be marked variadic with `...` before its element
type. Inside the body it is an array whose elements receive the extra call arguments.

```hmx
fn sum(rest: ...int) -> int {
    let total = 0
    foreach (x in rest) {
        total = total + x
    }
    return total
}

sum()            // rest = []     -> 0
sum(1, 2, 3, 4)  // rest = [1,2,3,4] -> 10
```

Rules:
- There may be at most one variadic parameter, and it must be the **last** parameter.
- The element type must be a **scalar** type (`int`, `decimal`, `text`, `bool`,
  `char`, `byte`); it cannot be an array or tuple.
- Inside the body the parameter is a normal array value: indexing, `length(...)`, and
  `foreach` all work, and it is read-only.
- A variadic parameter cannot have a default value.

### 12.3 Return Values

A function declares its return type after `->`. The `return` statement provides the
value.

```hmx
fn double(x: int) -> int {
    return x * 2
}
```

A `return` with no value is valid in a function with no declared return type.

```hmx
fn stop() {
    return
    print("never reached")
}
```

A function returning a tuple provides multiple comma-separated values, and the
count and types must match the declared members exactly.

```hmx
fn divmod(a: int, b: int) -> (int, int) {
    return a / b, a - (a / b) * b
}

fn bad() -> (int, int) {
    return 1, "x"      // Error: member 2 type mismatch
}

fn bad2() -> (int, int) {
    return 1           // Error: wrong number of values
}
```

The type of `return expr` must match the declared return type.

```hmx
fn bad() -> int {
    return "oops"   // Error: type mismatch
}
```

Returning a function value requires the exact function type, and a closure that
is returned carries its captured environment (see §12.5).

### 12.4 Function Calls

Call a function by name with a parenthesized argument list. Functions may be called
in any order relative to their definition (calls resolve to prototypes emitted first).

```hmx
let result = add(3, 4)     // 7
greet("Boss")
```

Every argument must match its parameter's type. A call may supply fewer arguments
when the trailing parameters have defaults, and extra arguments are collected by a
trailing variadic parameter. Passing **more** arguments than a non-variadic function
declares, or fewer than its required (default-less) parameters, is a compile error.

```hmx
add(3)          // Error: expected 2 arguments, got 1
add(3, "x")     // Error: type mismatch on argument 2
```

Calling `main` is not allowed. A function that returns nothing (`void`) may be called
as a statement but not used as a value.

### 12.5 Function Types and Closures **[Implemented]**

A **function type** is written `fn(<param_types...>) -> <return_type>`:

```hmx
fn apply(f: fn(int) -> int, x: int) -> int {
    return f(x)
}

fn twice(a: int) -> int {
    return a * 2
}

fn main() {
    print(apply(twice, 21))       // 42
}
```

- A defined function's name (other than `main`) is a **value** of its function
  type. It may be passed as an argument, returned, or stored in a variable.
- Calling a variable of function type performs a **higher-order call**:
  `f(x)` where `f: fn(int) -> int` invokes the stored function. Argument count
  and exact function types are checked at compile time.
- There are no anonymous function literals; a function value is always a named
  function declared with `fn`.
- A function must be **declared before it is used as a value** (bare-name
  references and higher-order calls); ordinary by-name calls to later functions
  remain allowed.
- `print` and `?:` (ternary) reject function values.

A **closure** is a nested function that references a variable of its enclosing
function's scope. The referenced variables are *captured*:

```hmx
fn make_mult(m: int) -> fn(int) -> int {
    fn mult(a: int) -> int {
        return a * m          // m is captured
    }
    return mult
}

fn main() {
    let by3 = make_mult(3)
    print(by3(5))             // 15
    let by10 = make_mult(10)
    print(by10(6))            // 60
}
```

A function may reference the locals and parameters of **any** enclosing function
(its direct parent, its grandparent, and so on) and of its own parent's scope
up to program scope:

```hmx
fn main() {
    let x = 100
    fn inner() -> int { return x }        // captures x
    fn outer() -> int {
        let y = 7
        fn inn2() -> int { return x + y } // captures x and y
        return inn2() + inner()
    }
    print(outer())                        // 207
}
```

Capture rules:

- Capturing functions are compiled with a hidden environment parameter; the
  environment is built automatically at every call site and captured variables
  are read back through it.
- Captures are **snapshots**: the captured value is copied when a closure value
  is created (passed, returned, stored, or assigned), so the closure sees the
  value at creation time. A closure stored in a variable or returned from a
  function survives long after the enclosing function returns; a closure called
  directly (never stored) reads the variable's current value.
- Captured variables are **read-only** inside the capturing function; assigning
  to a captured variable is a compile error
  (`cannot assign to captured variable 'x'`).
- Captured **arrays** share their backing storage with the enclosing scope.
- `main` cannot be called or used as a value, and it never captures.
- A function value may only be created where the referenced function's captures
  are in scope; using a capturing function where one of its captured variables
  is not visible is a compile error
  (`cannot call 'g' from here: captured variable 'x' is not in scope`).

Nested functions are otherwise **hoisted to program scope**:

- A nested function name must not collide with any other function in the program
  (top-level or nested); duplicates are rejected with
  `duplicate declaration of function`.
- `main` remains reserved for the program entry point and cannot be declared
  (nested or otherwise).
- `return` inside a nested function belongs to the nested function itself, never
  to the enclosing function. `break` and `continue`, however, may non-locally
  target an enclosing function's nearest loop when the nested function has no
  loop of its own enclosing it (see §12.6).

**Out of scope (roadmap):** currying, multiple return values from function-type
params, closures over captured-array-resizing writes.

---

### 12.6 Non-local `break` / `continue` **[Implemented]**

A `break` or `continue` written inside a **nested function** that has no loop of
its own enclosing it targets the **nearest enclosing loop** in the enclosing
function chain at the point where the nested function is declared. This is a
**non-local exit**: the nested function's call terminates that loop even though
the loop lives in an enclosing function.

```hmx
fn main() {
    let total = 0
    loop (5) {
        fn bail() {          // declared inside the loop
            break            // non-locally breaks `loop (5)`
        }
        total = total + 1
        if (total == 2) {
            bail()           // call arms the exit
        }
    }
    print(total)             // 2
}
```

Semantics:

- The target loop is the nearest loop lexically enclosing the **nested
  function's declaration** (skipping any intermediate nested functions that have
  their own "in-between" but no loop).
- A non-local `break` terminates the target loop; a non-local `continue` jumps to
  the target loop's condition (or update step for `for`, `foreach`, and `loop`).
- A function may use non-local exit even if it has parameter/return types; only
  `main` may not be a breaker's caller (it cannot be a breaker itself, since
  breakers can never be called indirectly).

Call-site restriction (compile error):

- A breaker function may be called **only directly from the function that owns
  its target loop, at a call site lexically inside that loop**. Calling it from
  any other place is rejected with
  `cannot call 'bail' from here: its non-local break/continue target loop is not active here`.

Consequences of the restriction:

- **No forwarding:** a breaker cannot be invoked from a wrapper nested function.
- **No function values:** a breaker cannot be assigned, passed, or stored; using
  it as a value is rejected with
  `cannot use function 'bail' as a value because it has a non-local break/continue target`.
- **No indirect/higher-order calls** of breakers, and no recursion through a
  breaker (a breaker's own body is not inside its target loop).
- Inside a loop whose function also declares breakers, ordinary local
  `break`/`continue` in the loop body behave exactly as before; the local form is
  chosen whenever the statement appears directly in a loop body rather than in a
  nested function.

Lowering: the target loop is re-armed each iteration via `setjmp`/`longjmp`
(`longjmp(..., 1)` = break, `longjmp(..., 2)` = continue). A breaker function
receives a hidden extra argument carrying the target loop's setjmp buffer, so its
signature is not user-observable (no overload or call-site syntax change).

---

## 13. Built-in Functions & Output

### 13.1 `print`

The `print` statement outputs one or more values on a single line, space-separated
and terminated by a newline. It requires at least one argument.

**Syntax:**
```
print_stmt  : "print" "(" expression ("," expression)* ")"
```

```hmx
print("hello")                 // hello
print(42)                      // 42
print(2.5)                     // 2.500000
print(true)                    // 1
print(count + 1, "left")       // 15 left
print("a", "b", "c")           // a b c
```

The format specifier is selected automatically from each argument's type:

| Expression type | Output format |
|---|---|
| `int` | integer |
| `decimal` | floating-point (`%f`) |
| `text` | string |
| `bool` | `1` or `0` |
| `char` | single character |
| `byte` | integer |

Arrays and tuples cannot be printed directly; index or destructure them first.

```hmx
let total = 10
print(total + 5)     // prints 15
```

### 13.2 String Built-ins

`length(text)` returns the number of bytes in a string. `substring(text, start, end)`
returns the half-open range `[start, end)`. Both indexes must be `int`; invalid
negative, reversed, or out-of-range indexes terminate the generated program.

```hmx
let message = "hello world"
print(length(message))
print(substring(message, 0, 5))
```

`length(array)` also returns the element count of an array:

```hmx
let values: [int] = [3, 5, 7]
print(length(values))     // prints 3
```

### 13.3 Character Indexing and `ord` / `chr` / `split` **[Implemented]**

A `text` value can be indexed with an `int` to read the character at that byte
position, yielding a `char`:

```hmx
let s = "hello"
print(s[0])              // h
print(s[length(s) - 1])  // o
```

Indexes use the same bounds checking as arrays; an index at or beyond the length
terminates the generated program. Characters in `text` are read-only: assigning
to `s[i]` is rejected at compile time.

Character conversion built-ins:

- `ord(char)` returns the byte value of a character as `int`.
- `chr(int)` returns the character with the given byte value. The code must
  satisfy `0 <= code <= 255`; out-of-range codes terminate the generated program.

```hmx
print(ord(names[0][0]))   // 97
print(chr(65))            // A
print(chr(ord('b') + 1))  // c
```

`split(text, separator)` returns a new `[text]` array containing the pieces of
the first argument split on every occurrence of `separator`. Empty and
missing pieces are preserved, so `split("a,,b", ",")` yields three elements and
`split("")` yields one empty element. The separator must not be empty; a runtime
error terminates the program otherwise.

```hmx
let parts: [text] = split("a,b,,c", ",")
print(length(parts))      // 4
print(parts[0])           // a
print(index_of(parts, "c"))  // 3
```

### 13.4 Array Built-ins **[Implemented]**

Arrays are growable. The following built-ins operate on arrays; the array
argument must be a mutable array variable or array expression in the current
scope (`push`, `pop`, and `sort` reject immutable arrays).

- `push(array, element)` appends `element` to the end of `array`. The element
  type must match the array's element type (arrays-of-arrays push whole rows).
  It returns nothing and is used as a statement.
- `pop(array)` removes the last element and returns it (an element of the
  array's element type). `pop` on an empty array terminates the program with a
  runtime error.
- `sort(array)` sorts the array in place, ascending. Element types are limited
  to `int`, `decimal`, `byte`, `char`, or `text` (text sorts lexicographically).
  It returns nothing.
- `slice(array, start, end)` returns a new array holding the half-open range
  `[start, end)` of `array`. Duplicate growth: the copy is independent of the
  source. Out-of-range or reversed bounds terminate the program at runtime.
- `concat(array_a, array_b)` returns a new array holding the elements of
  `array_a` followed by those of `array_b`. Both arrays must share an element
  type; nested-array elements are shared by reference.
- `index_of(array, value)` returns the index of the first element equal to
  `value`, or `-1` if absent. Only scalar and `text` element types are
  supported; `text` compares by string content.
- `contains(array, value)` returns true if `value` appears in `array`, false
  otherwise. Same element-type restrictions as `index_of`.

```hmx
let values: [int] = [3, 1, 2]
push(values, 9)
sort(values)                 // [1, 2, 3, 9]
print(pop(values))           // 9
let mid: [int] = slice(values, 1, 3)       // [2, 3]
let all: [int] = concat(values, mid)       // [1, 2, 3, 2, 3]
print(index_of(all, 3))      // 2
print(contains(all, 9))      // 0
```

`concat` is the only way to join arrays: the binary `+` operator remains
text-concatenation only (§8.1).

### 13.5 `input` **[Implemented]**

`input()` reads one line from standard input and returns it as `text` with the
trailing newline (and CRLF) removed. At end of input it returns the empty string.

```hmx
let name = input()       // waits for a line on stdin
print("hi", name)
```

### 13.6 Conversions: `tostr`, `parse_int`, `parse_decimal` **[Implemented]**

`tostr(value)` converts an `int`, `decimal`, `bool`, `char`, or `byte` into its
text form, matching how `print` renders that type. Passing `text` returns it
unchanged. It accepts exactly one argument.

```hmx
print(tostr(42))          // 42
print(tostr(2.5))         // 2.500000
print(tostr(false))       // 0
print(tostr('Z'))         // Z
print(tostr(7) + "!")     // 7!
```

`parse_int(text)` parses a decimal integer into an `int`; `parse_decimal(text)`
parses a floating-point number into a `decimal`. Trivial whitespace is not
accepted (the whole string must parse). Malformed input terminates the program
at runtime with a message on stderr and exit code 1.

```hmx
let n = parse_int("100")
print(n - 1)              // 99
let d = parse_decimal("3.5")
print(d + 0.5)            // 4.000000
```

```hmx
parse_int("12abc")   // runtime error: parse_int: invalid int '12abc'
```

---

## 14. Error Handling

The compiler reports errors with line numbers and stops before producing invalid
output.

### 14.1 Error Message Format

Two standard formats are used across all stages:

```
Error [line N]: <description>
Parse error [line N]: <description> near '<token>'
```

### 14.2 Lexing / Parsing Errors

A syntax error stops compilation immediately and prints a `Parse error` with the
source line and offending token.

```
Parse error [line 3]: syntax error near '}'
```

### 14.3 Type Errors

A type mismatch or invalid operation prints a type error with the line and the
conflicting types.

```
Error [line 3]: type mismatch: variable 'x' declared as int but initialized with text
Error [line 5]: type mismatch in binary expression: int + text
Error [line 4]: if condition must be bool, got int
Error [line 8]: for condition must be bool, got int
Error [line 6]: undefined variable 'nope'
```

### 14.4 Compile-Time Checks

- **Type mismatch** on annotated declarations (§5.2).
- **Type mismatch** in binary/comparison/boolean operators (§8).
- **Undefined variable** references.
- **Duplicate declarations** of variables in the same scope or functions at program scope.
- **Loop count** must be `int`; `if`, `while`, `for`, and `do-while` conditions
  must be `bool`.
- **Function call** argument count and type matching (§12.4): too few (below the
  required default-less prefix), too many (for non-variadic), and every supplied
  argument — including the variadic tail — is type-checked.
- **Parameter defaults**: must be constant literals matching the declared type
  (byte `0..255`), must form a trailing run, and the variadic parameter cannot have
  a default.
- **Variadic parameters**: at most one, must be last, and collects a scalar element
  type.
- **Definite returns** for typed functions: every reachable path must return a value.
- **Loop control**: `break`/`continue` outside a loop, or directly inside a switch
  case without an enclosing loop, is a compile error.
- **`foreach`** iterable must be an array or `text`; the loop variable is scoped to
  the body.
- **Built-ops**: `print` requires ≥ 1 argument and rejects arrays/tuples; builtin
  call arity and argument types are checked (`input` takes 0 args, `tostr` takes
  one supported scalar, `parse_int`/`parse_decimal` take one `text`).
- **Operator domains**: `%` / `%=` require `int`; unary `-`/`+` require `int` or
  `decimal`.

### 14.5 Compiler Emergencies (CLI)

- **Lex/parse failure** → print syntax error, do not proceed.
- **Type-resolution failure** → print type error, do not proceed to codegen.
- **`gcc` compile failure** → print `gcc`'s stderr as-is (it references `.hmx` lines
  via `#line` directives); preserve `build_temp.c` for inspection.
- **Runtime** → execute the binary and pass through its exit code.

---

## 15. Roadmap (planned features)

The following features are designed or under consideration for future versions but
are **not** part of the current core spec or compiler. None of them are usable yet.

| Feature | Notes |
|---|---|

> **Note:** as features are confirmed and added, they will be moved from this roadmap
> into their proper section above and, where relevant, implemented in the compiler.
