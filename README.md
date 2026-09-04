# Stardance / HMX

Stardance is a small programming language and compiler built for Hack Club. Stardance
source files use the `.hmx` extension. The compiler translates HMX source to C, then
uses GCC to produce a native executable.

The project is intentionally compact and readable: the implementation is a Flex lexer,
a Bison parser, a C++ AST/type resolver/code generator, and a GCC-based backend.

## Status

The current compiler supports:

- Variables with inferred or explicit types
- Integer, decimal, text, and boolean values
- Arithmetic, comparisons, boolean logic, and text concatenation
- `if` / `else` conditionals
- `else if` conditional chains
- `loop`, `while`, `for`, and `do ... while` loops
- Functions with typed parameters and return values
- Function calls, forward calls, and recursion
- Compile-time type checking with line-numbered diagnostics
- Duplicate declaration detection and definite-return checking
- Native executables and propagated `main` exit codes

The compiler is functional, but this is still a small language project rather than a
production compiler. See [SYNTAX.md](SYNTAX.md) for the authoritative reference and
[PLAN.md](PLAN.md) for planned work.

## Quick Start

### Requirements

Linux is the currently tested platform. Install these tools:

- C++17 compiler (`g++`)
- C compiler (`gcc`)
- CMake 3.16 or newer
- Flex
- Bison
- Bash for the test scripts

On Debian or Ubuntu:

```bash
sudo apt install build-essential cmake flex bison
```

### Build

```bash
git clone https://github.com/himanshu-2010/hmx-lang.git
cd hmx-lang
cmake -S . -B build
cmake --build build
```

### Run a program

```bash
./build/stardance run examples/hello.hmx
```

The compiler accepts only `.hmx` source files. `.sd` and other extensions are rejected.
The `run` command creates a temporary C file and executable, runs the program, and
removes both generated files afterward.

### Build without running

```bash
./build/stardance build examples/hello.hmx
```

Keep the generated C file for inspection:

```bash
./build/stardance build examples/hello.hmx -keep-c
```

The generated file is `build_temp.c` in the current working directory. Generated
binaries and temporary files are ignored by Git.

## First Program

```hmx
fn main() {
    let name: text = "HMX"
    let count = 3

    if (count > 0) {
        print("Hello from " + name)
    } else {
        print("Nothing to do")
    }
}
```

HMX does not require semicolons for ordinary statements. The only semicolons in the
language are the two separators in a `for` loop header.

## CLI

```text
Usage: stardance <command> <file.hmx> [options]

Commands:
  run   <file.hmx>        Transpile, compile, execute
  build <file.hmx>        Transpile and compile only

Options:
  -keep-c                Keep intermediate .c file
```

`main` is the entry point. A `main` function without a return type exits with code 0.
A typed main can return an integer exit code:

```hmx
fn main() -> int {
    return 42
}
```

## Keywords

These words are reserved and cannot be used as variable or function names:

| Category | Keywords |
| --- | --- |
| Declarations | `let`, `fn` |
| Control flow | `if`, `else`, `loop`, `while`, `for`, `do` |
| Functions and output | `return`, `print` |
| Boolean values | `true`, `false` |
| Boolean operators | `and`, `or`, `not` |
| Types | `int`, `decimal`, `text`, `bool` |

Keywords are case-sensitive. For example, `loop` is a keyword but `Loop` is an
ordinary identifier.

## Types and Literals

HMX has four primitive types:

| Type | Meaning | Examples |
| --- | --- | --- |
| `int` | Integer value | `0`, `42`, `-1` is not currently supported |
| `decimal` | Double-precision floating-point value | `0.0`, `3.14` |
| `text` | Double-quoted string | `"hello"` |
| `bool` | Boolean value | `true`, `false` |

Types are inferred from initializers:

```hmx
let count = 5
let ratio = 2.5
let message = "hello"
let ready = true
```

Explicit annotations are available when a declaration should document or enforce its
type:

```hmx
let count: int = 5
let ratio: decimal = 2.5
let message: text = "hello"
let ready: bool = true
```

`int` and `decimal` are not implicitly mixed in arithmetic. Text supports `+` with
another text value for concatenation. Other invalid combinations are compile errors.

## Operators

### Arithmetic

| Operator | Meaning |
| --- | --- |
| `+` | Addition, or `text` concatenation |
| `-` | Subtraction |
| `*` | Multiplication |
| `/` | Division |

Arithmetic precedence is `*` and `/`, then `+` and `-`. Parentheses can override it.

### Comparison

`==`, `!=`, `<`, `>`, `<=`, and `>=` compare values of the same type and produce a
`bool`. Text equality and inequality are supported; text ordering is not supported.

### Boolean logic

Both word and symbol forms are accepted:

| Word form | Symbol form | Meaning |
| --- | --- | --- |
| `and` | `&&` | Logical AND |
| `or` | `||` | Logical OR |
| `not` | `!` | Logical NOT |

Precedence from highest to lowest is NOT, comparisons, AND, then OR.

### Assignment

```hmx
let value = 10
value = 12
value += 3
value -= 1
value *= 2
value /= 2
value++
value--
```

Assignments are statements, not expressions. Variables must already exist, and the
assigned value must have the variable's type.

## Control Flow

```hmx
fn main() {
    let total = 0

    loop(3) {
        total += 1
    }

    while (total < 5) {
        total++
    }

    for (let i = 0; i < 3; i++) {
        print(i)
    }

    do {
        total--
    } while (total > 0)
}
```

- `loop(count)` requires an `int` count.
- `while` and `do ... while` conditions require `bool`.
- `for` uses `for (initializer; condition; update)`.
- A variable declared in a `for` initializer is scoped to that loop.
- `else if`, ternary expressions, arrays, and lists are not currently implemented.

## Functions

Parameters and return types are explicitly typed:

```hmx
fn multiply(a: int, b: int) -> int {
    return a * b
}

fn greet(name: text) {
    print("Hello, " + name)
}

fn main() {
    let result = multiply(6, 7)
    print(result)
    greet("HMX")
}
```

Functions can be declared in any order. Calls are checked for an existing function,
matching argument count, and matching argument types. Void functions can be called as
statements but cannot be used as values. Calling `main` is rejected. Direct recursion
is supported.

## Comments and Output

Line comments and non-nesting block comments are supported:

```hmx
// A line comment
/* A block comment
   over multiple lines */
print("comments are ignored")
```

`print` accepts an expression and writes it followed by a newline. Integers, decimals,
text, booleans, variables, and expressions can be printed. Booleans print as `1` or
`0`; decimals use the generated C `%f` formatting.

## Compiler Pipeline

```text
source.hmx
    |
    v
Flex lexer -> Bison parser -> AST -> type resolver -> C code generator -> GCC -O2
    |
    v
native executable
```

The generated C uses a small runtime helper for text concatenation and `strcmp` for
text equality. The compiler does not currently produce a standalone installable
runtime or package.

## Errors

Invalid programs stop before a native executable is produced. Typical diagnostics
include:

```text
Error [line 3]: type mismatch
Error [line 4]: undefined variable 'name'
Parse error [line 2]: ...
Error: expected .hmx file
```

The resolver checks undefined variables and functions, type mismatches, invalid
operators, invalid loop conditions, invalid returns, argument count/type errors, and
calls to `main`. It also rejects duplicate names in the same scope and typed functions
that can reach the end without returning a value.

## Tests

Build and run the complete test suite:

```bash
cmake -S . -B build
cmake --build build
./tests/run_integration.sh
./tests/run_negative_tests.sh
./tests/run_stress_tests.sh
```

The current regression suite contains:

| Suite | Coverage | Result |
| --- | --- | --- |
| Integration | 23 `.hmx` fixtures | 23/23 passed |
| Negative | Type, syntax, and resolver errors | 35/35 passed |
| Stress/output | Recursion, loops, strings, output, exit codes | 14/14 passed |
| Total | 72 test cases | 72/72 passed |

The detailed report is in [TESTRESULT.md](TESTRESULT.md). Test fixtures are in
[tests/fixtures](tests/fixtures), and the example program is
[examples/hello.hmx](examples/hello.hmx).

## Performance and Language Comparisons

Stardance is a source-to-C compiler, so generated numeric code is compiled by GCC with
`-O2`. This gives it a strong runtime baseline and means simple arithmetic and loops
can be close to the performance of equivalent optimized C code. That statement is an
implementation property, not a published benchmark result.

No controlled cross-language benchmark is currently checked into this repository.
Performance depends on the program, compiler version, optimization flags, allocation,
I/O, and how each language is measured. The honest current comparison is:

| Language/runtime | Typical execution model | What to expect compared with Stardance |
| --- | --- | --- |
| C | Native compilation | Closest comparison; generated HMX numeric code is intended to be similar after GCC optimization |
| C++ | Native compilation | Similar class of runtime performance; C++ has a much larger language and library ecosystem |
| Rust | Native compilation | Similar native-performance target; Rust provides stronger safety guarantees and a larger toolchain |
| Go | Native compilation with runtime and garbage collection | Usually fast native execution, with a more mature standard library and runtime |
| Java | JIT-compiled virtual machine | Startup and warm-up differ; optimized hot code can be very fast |
| Python | Interpreted or VM-based execution | Usually slower for tight numeric loops, but far more mature for scripting and libraries |
| JavaScript | JIT-compiled runtime | Performance varies significantly by engine and workload |

These are architectural comparisons, not claims that HMX wins every workload. HMX has
no garbage collector, JIT, standard library, optimizer of its own, or benchmark suite
yet. Its current advantage is a small syntax and a straightforward native compilation
path; its current disadvantages are limited features, diagnostics, portability, and
ecosystem maturity.

To make a future comparison reproducible, benchmark equivalent programs with the same
input and output behavior, use release builds, warm up JIT runtimes where appropriate,
run several repetitions, and report compiler/runtime versions and hardware. Until that
benchmark exists, avoid treating the test-suite pass count as a speed measurement.

## Project Layout

```text
src/                    Lexer, parser, AST, resolver, and code generator
examples/hello.hmx      Example HMX program
tests/fixtures/         Integration fixture programs
tests/*.sh              Integration, negative, and stress test runners
SYNTAX.md               Full language syntax reference
PLAN.md                 Implementation history and roadmap
TESTRESULT.md           Detailed regression report
```

## Remaining Features

The compiler's core milestone is complete. The following language features are listed
as planned and are not implemented yet:

- Arrays and lists
- String methods such as `length` and `substring`
- Ternary expressions (`condition ? a : b`)
- `switch` statements
- Explicit type casting and numeric conversion
- A character or byte type
- Multiple return values or tuples
- Named constants and immutable bindings
- Namespaces and modules across multiple `.hmx` files
- Variadic parameters and default parameter values
- Function pointers, higher-order functions, and closures
- Unicode identifiers

Engineering work still needed around the language includes better source locations,
more complete expressions, improved portability, a standard library, and a reproducible
cross-language benchmark suite. The roadmap is intentionally separate from implemented
syntax; check [SYNTAX.md](SYNTAX.md) before relying on a feature.

## Contributing

Keep changes small and testable. For compiler changes:

1. Update the relevant lexer, parser, AST, resolver, or code generator code.
2. Add or update an `.hmx` fixture and a negative test when behavior can fail.
3. Run the build and all three test scripts.
4. Update [SYNTAX.md](SYNTAX.md) and [TESTRESULT.md](TESTRESULT.md) when the language surface changes.

Please keep the `.hmx` extension strict in new examples and tests.

## License

This project is available under the [MIT License](LICENSE).
