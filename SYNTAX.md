# Stardance — Language Syntax Reference

**Version 1.0 (core spec)**

A custom programming language that transpiles to C. This document is the authoritative
syntax reference for the Stardance language. It follows the same structural layout as the
standard C reference documentation, but uses Stardance's own syntax, types, and conventions.

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

A Stardance program is a sequence of statements and function declarations in a `.sd` file.
Execution begins in the `main` function.

```stardance
fn main() {
    print("Hello, Stardance!")
}
```

### 1.2 Translation Model

Stardance source is transpiled to C, then compiled with `gcc -O2` to a native executable:

```
yourfile.sd  --[Stardance Compiler]-->  build_temp.c  --[gcc -O2]-->  native executable
```

### 1.3 Blocks

Braces `{ }` delimit every block: function bodies, `if`/`else` bodies, and loop bodies.
There is no significant indentation; whitespace is ignored.

```stardance
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

Stardance prefers type inference. Variables infer their type from their initializer.
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
| `for` | Header-controlled loop |
| `do` | Post-condition loop |
| `print` | Output statement |
| `return` | Function return value |
| `true` / `false` | Boolean literals |
| `and` / `or` / `not` | Boolean operators (word forms) |
| `int` / `decimal` / `text` / `bool` | Type names |

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

```stardance
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

```stardance
let count = 5   // this is a line comment
```

### 4.2 Block Comments

`/* ... */` begins a block comment and runs to the matching `*/`. Block comments
may span multiple lines. They do **not** nest.

```stardance
/*
   A multi-line
   block comment
*/
let name = "Boss"
```

---

## 5. Types

Stardance has four primitive types. Each maps to a C type and a `print` format
specifier.

| Stardance type | Meaning | C type | Format specifier |
|---|---|---|---|
| `int` | integer | `int` | `%d` |
| `decimal` | floating-point | `double` | `%f` |
| `text` | string | `char*` | `%s` |
| `bool` | boolean (0/1) | `int` | `%d` |

### 5.1 Type Inference

Types are inferred from initializers unless explicitly annotated:

```stardance
let count = 5          // int
let ratio = 2.5        // decimal
let name = "Boss"      // text
let flag = true        // bool
```

### 5.2 Explicit Type Annotation

Use `:` followed by a type name to annotate a declaration:

```stardance
let total: int = 0
let pi: decimal = 3.14
let greeting: text = "hi"
let ready: bool = false
```

When annotated, the initializer's type must match the annotation. A mismatch is a
compile error:

```stardance
let x: int = "hello"   // Error: type mismatch
```

---

## 6. Literals

### 6.1 Integer Literals

Sequences of digits, non-negative.

```stardance
0
5
42
```

### 6.2 Decimal Literals

A fraction of a decimal point. Must have digits on both sides of the point.

```stardance
2.5
3.14
0.0
```

### 6.3 Text (String) Literals

Double-quoted sequences. `"..."`.

```stardance
"hello"
"Stardance active!"
```

### 6.4 Boolean Literals

`true` and `false`.

```stardance
true
false
```

---

## 7. Variables and Declarations

### 7.1 Declaration

`let` introduces a variable. Its type is inferred or annotated (§5).

**Syntax:**
```
var_decl  : "let" IDENTIFIER (":" TYPE)? "=" expression
```

```stardance
let count = 5
let total: int = 0
```

### 7.2 Assignment

Variables can be reassigned after declaration with the plain assignment operator.

```stardance
let count = 5
count = 10
```

### 7.3 Compound Assignment

Shorthand that combines assignment with arithmetic:

| Operator | Meaning |
|---|---|
| `+=` | `a = a + b` |
| `-=` | `a = a - b` |
| `*=` | `a = a * b` |
| `/=` | `a = a / b` |

```stardance
let count = 5
count += 3       // count is now 8
count *= 2       // count is now 16
```

### 7.4 Increment / Decrement

`++` increments by one; `--` decrements by one. Postfix form only (the value used in
an expression is the pre-incremented value).

```stardance
let count = 5
count++          // count is now 6
count--          // count is now 5
```

---

## 8. Operators

### 8.1 Arithmetic Operators

Work on `int` and `decimal` operands. Both operands must be the same type; mixing
`int` and `decimal` in one operation is a compile error.

| Operator | Meaning | Example |
|---|---|---|
| `+` | addition (int/decimal) or concatenation (text) | `a + b` |
| `-` | subtraction | `a - b` |
| `*` | multiplication | `a * b` |
| `/` | division | `a / b` |

When an operator combines two `text` operands, only `+` is allowed and it performs
string concatenation (lowered to a runtime `sd_concat`, left-associative for chained
concatenation). All other arithmetic operators require `int`/`decimal` operands.

**Operator precedence** (highest to lowest):

| Precedence | Operators | Associativity |
|---|---|---|
| 1 (highest) | `( )` grouping | — |
| 2 | `*` `/` | left |
| 3 | `+` `-` | left |

```stardance
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

```stardance
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

```stardance
true and false      // false
true or  false      // true
not true            // false
true && false       // false
true || false       // true
!true               // false
```

**Precedence** (highest to lowest): `not`/`!` → comparisons → `and`/`&&` → `or`/`||`.

```stardance
if (a > 0 and b > 0) { }    // parens optional but recommended
if (not ready) { }
```

---

## 9. Expressions

An expression is any combination of literals, identifiers, and operators that
evaluates to a value.

**Grammar (core):**
```ebnf
expression   : logical_or
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
term         : term ("*" | "/") factor
             | factor
factor       : NUMBER | DECIMAL | STRING
             | "true" | "false"
             | "not" factor | "!" factor
             | IDENTIFIER
             | IDENTIFIER "(" args? ")"      // function call
             | "(" expression ")"
args         : expression ("," expression)*
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
| Function call | `name(args...)` |
| Output | `print(...)` |
| Conditional | `if (...) { } else { }` |
| Counted loop | `loop(...) { }` |
| Conditional loop | `while (...) { }` |
| Header-controlled loop | `for (init; condition; update) { }` |
| Post-condition loop | `do { } while (...)` |
| Function declaration | `fn name() { }` |
| Return | `return expr` or `return` |

### 10.1 Semicolons

Stardance does **not** use semicolons for normal statements. Statements are
terminated by the structure of the grammar, and whitespace/newlines are insignificant
(identical to how the parser distinguishes statements). The only semicolons in the
core language are the two separators inside a `for (...)` loop header.

```stardance
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

```stardance
let count = 5
loop(count) {
    print("hello")
}
```

The count expression must evaluate to `int`; otherwise a compile error is raised.

```stardance
let name = "Boss"
loop(name) { }   // Error: loop count must be int, got text
```

### 11.2 The `while` Statement **[Implemented]**

Repeats a block while a boolean condition remains true.

**Syntax:**
```
while_stmt : "while" "(" expression ")" "{" statement+ "}"
```

```stardance
let i = 0
while (i < 5) {
    print(i)
    i++
}
```

The condition expression must evaluate to `bool`; otherwise a compile error is raised.

```stardance
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

```stardance
let total = 0
for (let i = 0; i < 5; i++) {
    total += i
}
```

The condition expression must evaluate to `bool`. A variable declared in the initializer
is scoped to the loop header and body.

```stardance
for (let i = 0; 5; i++) { }   // Error: for condition must be bool, got int
```

### 11.4 The `do-while` Statement **[Implemented]**

Runs a block once, then repeats it while a boolean condition remains true.

**Syntax:**
```
do_while_stmt : "do" "{" statement+ "}" "while" "(" expression ")"
```

```stardance
let i = 3
do {
    print(i)
    i--
} while (i > 0)
```

The condition expression must evaluate to `bool`; otherwise a compile error is raised.
There is no trailing semicolon after the condition.

### 11.5 The `if` Statement

Conditionally executes a block based on a `bool` condition.

**Syntax:**
```
if_stmt   : "if" "(" expression ")" "{" statement+ "}"
          | "if" "(" expression ")" "{" statement+ "}" "else" "{" statement+ "}"
```

```stardance
let score = 75
if (score >= 60) {
    print("passed")
} else {
    print("failed")
}
```

The condition must evaluate to `bool`; otherwise a compile error is raised.

```stardance
if (5) { }   // Error: if condition must be bool, got int
```

**Out of scope (roadmap):** `else if` chaining, ternary conditional.

---

## 12. Functions

### 12.1 Declaration

A function groups a block of statements under a name. `main` is the program entry
point. Its exit code is the integer it returns: if `main` declares `-> int` and
returns a value, that value becomes the process exit code; a `main` without `-> int`
implicitly returns `0`.

```stardance
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
fn_decl  : "fn" IDENTIFIER "(" param_list? ")" ("->" TYPE)? "{" statement+ "}"
param_list : param ("," param)*
param    : IDENTIFIER ":" TYPE
```

```stardance
fn add(a: int, b: int) -> int {
    return a + b
}

fn greet(name: text) {
    print(name)
}
```

### 12.3 Return Values

A function declares its return type after `->`. The `return` statement provides the
value.

```stardance
fn double(x: int) -> int {
    return x * 2
}
```

A `return` with no value is valid in a function with no declared return type.

```stardance
fn stop() {
    return
    print("never reached")
}
```

The type of `return expr` must match the declared return type.

```stardance
fn bad() -> int {
    return "oops"   // Error: type mismatch
}
```

**Out of scope (roadmap):** variadic parameters, default parameter values.

### 12.4 Function Calls

Call a function by name with a parenthesized argument list. Functions may be called
in any order relative to their definition (calls resolve to prototypes emitted first).

```stardance
let result = add(3, 4)     // 7
greet("Boss")
```

The number of arguments must match the number of parameters, and each argument's
type must match the corresponding parameter type.

```stardance
add(3)          // Error: expected 2 arguments, got 1
add(3, "x")     // Error: type mismatch on argument 2
```

Calling `main` is not allowed. A function that returns nothing (`void`) may be called
as a statement but not used as a value.

**Out of scope (roadmap):** function pointers / higher-order functions, closures.

---

## 13. Built-in Functions & Output

### 13.1 `print`

The `print` statement outputs a value followed by a newline.

**Syntax:**
```
print_stmt  : "print" "(" expression ")"
```

```stardance
print("hello")
print(42)
print(2.5)
print(true)
print(count + 1)
```

The format specifier is selected automatically from the expression's type:

| Expression type | Output format |
|---|---|
| `int` | integer |
| `decimal` | floating-point (`%f`) |
| `text` | string |
| `bool` | `1` or `0` |

```stardance
let total = 10
print(total + 5)     // prints 15
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
- **Loop count** must be `int`; `if`, `while`, `for`, and `do-while` conditions
  must be `bool`.
- **Function call** argument count and type matching (§12.4).

### 14.5 Compiler Emergencies (CLI)

- **Lex/parse failure** → print syntax error, do not proceed.
- **Type-resolution failure** → print type error, do not proceed to codegen.
- **`gcc` compile failure** → print `gcc`'s stderr as-is (it references `.sd` lines
  via `#line` directives); preserve `build_temp.c` for inspection.
- **Runtime** → execute the binary and pass through its exit code.

---

## 15. Roadmap (planned features)

The following features are designed or under consideration for future versions but
are **not** part of the current core spec or compiler. None of them are usable yet.

| Feature | Notes |
|---|---|
| `else if` chaining | Multiple branches in an `if` chain. |
| Arrays / lists | Ordered collections of values. |
| String methods | `length`, `substring`, case conversion, etc. |
| Ternary / conditional operator | `cond ? a : b`. |
| `switch` statement | Multi-way branch on a value. |
| Type casting / conversion | Explicit converts between types (e.g., `int` ↔ `decimal`). |
| Character / byte type | A single character type distinct from `text`. |
| Multiple return values | Functions returning tuples. |
| Named constants | `const` / immutable bindings. |
| Namespaces / modules | Splitting a program across `.sd` files. |

> **Note:** as features are confirmed and added, they will be moved from this roadmap
> into their proper section above and, where relevant, implemented in the compiler.
