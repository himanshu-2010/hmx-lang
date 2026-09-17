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
Execution begins in the `main` function.

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

---

## 3. Identifiers

Identifiers name variables and functions.

**Syntax:**
```
identifier  : [a-zA-Z_][a-zA-Z0-9_]*
```

**Rules:**
- Must start with a letter or underscore.
- May contain letters, digits, and underscores.
- Cannot be a reserved keyword (§2).

```hmx
let count = 5
let _private = 10
fn addNumbers() {
    print(1)
}
```

**Out of scope:** unicode/identifiers with non-ASCII characters.

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

An array is an ordered, fixed-size collection of elements of a single primitive type.
Arrays are declared with a `[type]` annotation:

```hmx
let scores: [int] = [10, 20, 30]
let names: [text] = ["alice", "bob"]
let empty: [int] = []
```

Element types may be `int`, `decimal`, `text`, `bool`, `char`, or `byte`. Nested
arrays (`[[int]]`) are **not** supported. An empty array literal (`[]`) requires an
explicit annotation so the compiler can infer the element type; a non-empty literal
infers its element type from its elements.

Arrays are reference values: assigning one array variable to another (`let b = a`)
shares the backing storage, so element writes through either name are visible through
both. The backing storage is heap-allocated by the generated code.

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
- Members may be `int`, `decimal`, `text`, `bool`, `char`, `byte`, or an array
  (`[int]`, etc.). Nested tuples (`((int, int), int)`) and arrays of tuples are
  **not** supported.
- Tuples are value types. Passing a tuple to a function or returning one copies it.
- A tuple index must be an integer constant in range; `t[i]` with a variable `i` is
  rejected at compile time.
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

### 7.5 Explicit Numeric Casts

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
             | IDENTIFIER "[" expression "]" // array index (read)
             | "[" "]"                        // empty array literal
             | "[" args "]"                   // array literal
             | "(" expression ")"
args         : expression ("," expression)*
```

Array indexes must be `int` and are bounds-checked at runtime. Elements of a
one-dimensional array have the array's element type.

Tuple indexing uses the same `t[i]` syntax with a compile-time `int` constant; the
result is the tuple member at that position. A variable index, an out-of-range
index, or indexing a non-array, non-tuple value is a compile error.

```hmx
let pair = divmod(9, 2)
print(pair[0])    // first member
print(pair[1])    // second member
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
| Tuple multi-assignment | `(name, name) = expr` |
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
- `return`, `break`, and `continue` inside a nested function belong to the nested
  function itself, never to the enclosing function's loops.

**Out of scope (roadmap):** currying, multiple return values from function-type
params, closures over captured-array-resizing writes.

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

### 13.3 `input` **[Implemented]**

`input()` reads one line from standard input and returns it as `text` with the
trailing newline (and CRLF) removed. At end of input it returns the empty string.

```hmx
let name = input()       // waits for a line on stdin
print("hi", name)
```

### 13.4 Conversions: `tostr`, `parse_int`, `parse_decimal` **[Implemented]**

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
| Namespaces / modules | Splitting a program across `.hmx` files. |

> **Note:** as features are confirmed and added, they will be moved from this roadmap
> into their proper section above and, where relevant, implemented in the compiler.
