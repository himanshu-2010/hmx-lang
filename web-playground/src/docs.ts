// ---------------------------------------------------------------------------
// HMX language documentation — source of truth for the in-app Docs view.
//
// Every `code` string is a COMPLETE, runnable program validated against the
// native compiler by `web-playground/tools/validate_docs.mjs`. `expected` is
// the exact stdout when run with no stdin; `exit` defaults to 0.
// ---------------------------------------------------------------------------

export interface DocExample {
  name: string;
  description: string;
  /** A complete .hmx program (entry point). Vite shows an extra block per moduleFiles entry. */
  code: string;
  /** Exact stdout when the program runs with no stdin. */
  expected?: string;
  /** Expected process exit code. Default 0. */
  exit?: number;
  /** Extra files needed for `use "..."` examples: path -> file contents. */
  moduleFiles?: Record<string, string>;
  /** Optional callout shown under the example. */
  note?: string;
}

export interface DocItem {
  id: string;
  title: string;
  /** Compact notation of the syntax, for scanners. */
  syntax: string;
  /** A few sentences explaining the topic. */
  intro: string;
  examples: DocExample[];
}

export interface DocSection {
  id: string;
  title: string;
  intro?: string;
  items: DocItem[];
}

export const docsData: DocSection[] = [
  {
    id: "basics",
    title: "Getting Started",
    intro: "Every HMX program is a text file with the .hmx extension. Execution starts at fn main().",
    items: [
      {
        id: "first-program",
        title: "Your first program",
        syntax: 'fn main() {   print("hello")   }',
        intro:
          "A file starts with function declarations. `main` is the entry point: the compiler builds it and runs it. `print` writes values to standard output, space-separated, on one line. Blocks use braces; statements do not need semicolons (the only semicolons in the language are the two separators inside a `for` header).",
        examples: [
          {
            name: "Hello, world",
            description: "The classic greeting, in HMX.",
            code: 'fn main() {\n    print("Hello, world")\n}',
            expected: "Hello, world",
          },
          {
            name: "Several values on one line",
            description: "print accepts any number of arguments and separates them with spaces.",
            code: 'fn main() {\n    print("score", 42, "ok")\n}',
            expected: "score 42 ok",
          },
        ],
      },
      {
        id: "comments",
        title: "Comments",
        syntax: "// line comment\n/* block\n   comment */",
        intro:
          "Line comments start with `//` and run to the end of the line. Block comments use `/* ... */` and may span lines, but they do not nest. Comments are stripped by the lexer and never affect behavior.",
        examples: [
          {
            name: "Line comments",
            description: "Explain a single line or the end of a line.",
            code: 'fn main() {\n    let answer = 42        // the meaning of everything\n    // double-check the variable\n    print(answer)\n}',
            expected: "42",
          },
          {
            name: "Block comments",
            description: "A multi-line block comment ignored by the compiler.",
            code: 'fn main() {\n    /*\n       Contributed by the docs team.\n       Still ignored: block comments do not nest.\n    */\n    print("comment-free")\n}',
            expected: "comment-free",
          },
        ],
      },
      {
        id: "main-exit",
        title: "main and exit codes",
        syntax: "fn main() { ... }        // exits 0\nfn main() -> int { return N }  // exits N",
        intro:
          "A `main` that declares no return type finishes with exit code 0. A `main` that declares `-> int` must return an integer, and that integer becomes the process exit code — handy for shell scripting (0 = success).",
        examples: [
          {
            name: "Void main",
            description: "Returns exit code 0 automatically.",
            code: 'fn main() {\n    print("all good")\n}',
            expected: "all good",
          },
          {
            name: "Exit code from main",
            description: "The returned integer is the process exit code. This program exits 42.",
            code: "fn main() -> int {\n    return 42\n}",
            exit: 42,
            note: "On the command line, `echo $?` after running gives 42.",
          },
        ],
      },
    ],
  },

  {
    id: "types",
    title: "Types & Literals",
    intro: "HMX has six primitive types: int, decimal, text, bool, char and byte.",
    items: [
      {
        id: "int",
        title: "int",
        syntax: "0  42  -5",
        intro:
          "Integers are whole numbers. Division of two integers truncates toward zero (`7 / 2` is 3, `-7 / 2` is -3) and `%` keeps the sign of the dividend, matching C.",
        examples: [
          {
            name: "Integer arithmetic",
            description: "Addition, division truncation and modulo.",
            code: 'fn main() {\n    print(10 + 3)\n    print(7 / 2)\n    print(10 % 3)\n}',
            expected: "13\n3\n1",
          },
          {
            name: "Negative numbers",
            description: "Unary minus and C-style truncation/modulo for negatives.",
            code: 'fn main() {\n    print(-5)\n    print(-7 / 2)\n    print(-100 % 7)\n}',
            expected: "-5\n-3\n-2",
          },
        ],
      },
      {
        id: "decimal",
        title: "decimal",
        syntax: "0.0  3.14  -2.5",
        intro:
          "Decimals are double-precision floats. print renders them with C's `%f` format: six digits after the point. Integers and decimals do not mix implicitly — use an explicit `as` cast to combine them.",
        examples: [
          {
            name: "Decimal printing",
            description: "Decimals always print with six decimal places.",
            code: 'fn main() {\n    print(2.5)\n    print(1.0 / 3.0)\n}',
            expected: "2.500000\n0.333333",
          },
          {
            name: "Decimal arithmetic",
            description: "Standard float arithmetic.",
            code: 'fn main() {\n    let total = 19.99 + 0.01\n    let half = total / 2.0\n    print(total, half)\n}',
            expected: "20.000000 10.000000",
          },
        ],
      },
      {
        id: "text",
        title: "text",
        syntax: '"double quoted"',
        intro:
          "Text is the string type, written with double quotes. `+` concatenates two text values. length, substring, indexing, ord, chr and split are covered under Text & I/O.",
        examples: [
          {
            name: "Concatenation",
            description: "Joining text with +.",
            code: 'fn main() {\n    print("Hello, " + "HMX")\n}',
            expected: "Hello, HMX",
          },
          {
            name: "Conversions into text",
            description: "tostr turns other scalars into text; then + works.",
            code: 'fn main() {\n    print(tostr(6) + " * " + tostr(7) + " = " + tostr(42))\n}',
            expected: "6 * 7 = 42",
          },
        ],
      },
      {
        id: "bool",
        title: "bool",
        syntax: "true  false",
        intro:
          "Booleans are `true` / `false`. Comparisons and logical operators produce them. print renders a bool as 1 or 0.",
        examples: [
          {
            name: "Direct printing",
            description: "Booleans print as 1 or 0.",
            code: 'fn main() {\n    print(true)\n    print(false)\n}',
            expected: "1\n0",
          },
          {
            name: "Computed booleans",
            description: "Compare values and combine with logic.",
            code: 'fn main() {\n    let score = 85\n    print(score >= 60 and score < 90)\n    print(score == 100 or score == 85)\n    print(not (score < 0))\n}',
            expected: "1\n1\n1",
          },
        ],
      },
      {
        id: "char",
        title: "char",
        syntax: "'H'  '\\n'",
        intro:
          "A char is a single character in single quotes. Chars are not valid arithmetic operands; convert with ord / chr when you need their byte value. A char prints as itself, and tostr('Z') gives the one-character text \"Z\".",
        examples: [
          {
            name: "Chars print as themselves",
            description: "A char is its own output.",
            code: 'fn main() {\n    let grade: char = \'A\'\n    print(grade)\n    print(\'Z\')\n}',
            expected: "A\nZ",
          },
          {
            name: "Char conversions",
            description: "ord turns a char into its byte value; tostr wraps it as text.",
            code: 'fn main() {\n    print(ord(\'A\'))\n    print(tostr(\'B\') + "ee")\n}',
            expected: "65\nBee",
          },
        ],
      },
      {
        id: "byte",
        title: "byte",
        syntax: "let b: byte = 200",
        intro:
          "A byte is an unsigned 8-bit value (0..255), useful for binary data. Like char, it is not a valid arithmetic operand by itself — cast it to int first. Annotate it explicitly; there is no byte literal syntax.",
        examples: [
          {
            name: "Storing and printing a byte",
            description: "A byte prints as its integer value.",
            code: 'fn main() {\n    let b: byte = 200\n    print(b)\n}',
            expected: "200",
          },
          {
            name: "Casting a byte to int",
            description: "Run arithmetic after an explicit cast.",
            code: 'fn main() {\n    let b: byte = 200\n    let n = b as int\n    print(n + 55)\n}',
            expected: "255",
          },
        ],
      },
    ],
  },

  {
    id: "variables",
    title: "Variables & Constants",
    items: [
      {
        id: "let-inferred",
        title: "let with inferred types",
        syntax: "let name = value",
        intro:
          "`let` declares a mutable variable. The type is inferred from the initializer: an integer literal makes an int, a decimal literal a decimal, and so on.",
        examples: [
          {
            name: "Inference from literals",
            description: "Each variable takes the type of its initializer.",
            code: 'fn main() {\n    let count = 5\n    let ratio = 2.5\n    let name = "HMX"\n    let ready = true\n    print(count, ratio, name, ready)\n}',
            expected: "5 2.500000 HMX 1",
          },
          {
            name: "Inference from expressions",
            description: "The type of an expression flows into the variable.",
            code: 'fn main() {\n    let total = 10 + 20\n    let doubled = total * 2\n    print(total, doubled)\n}',
            expected: "30 60",
          },
        ],
      },
      {
        id: "let-annotated",
        title: "let with explicit types",
        syntax: "let name: type = value",
        intro:
          "Annotations document intent and enforce the type: the initializer must match, or it is a compile error. They are required for types that cannot be inferred, like an empty array.",
        examples: [
          {
            name: "Annotated scalars",
            description: "The annotation must agree with the initializer.",
            code: 'fn main() {\n    let total: int = 0\n    let pi: decimal = 3.14\n    let greeting: text = "hi"\n    let done: bool = false\n    print(total, pi, greeting, done)\n}',
            expected: "0 3.140000 hi 0",
          },
          {
            name: "Why annotation is needed",
            description: "An empty array cannot infer its element type — annotate it.",
            code: 'fn main() {\n    let todo: [text] = []\n    push(todo, "write docs")\n    print(length(todo))\n}',
            expected: "1",
          },
        ],
      },
      {
        id: "const",
        title: "const",
        syntax: "const name[: type] = value",
        intro:
          "`const` declares a binding that cannot be reassigned. Reassigning it is a compile error. Use const for values that must not change.",
        examples: [
          {
            name: "A true constant",
            description: "Fixed values stay fixed.",
            code: 'fn main() {\n    const tax_rate = 0.18\n    let price = 100.0\n    print(price * tax_rate)\n}',
            expected: "18.000000",
          },
          {
            name: "Constants in logic",
            description: "Named thresholds read better than magic numbers.",
            code: 'fn main() {\n    const legal_age = 18\n    let age = 21\n    if (age >= legal_age) {\n        print("allowed")\n    }\n}',
            expected: "allowed",
          },
        ],
      },
    ],
  },

  {
    id: "operators",
    title: "Operators & Expressions",
    items: [
      {
        id: "arithmetic",
        title: "Arithmetic",
        syntax: "+ - * / %  (unary) - +",
        intro:
          "Precedence is unary minus/plus, then * / %, then + -. Parentheses override it. `/` on two ints truncates toward zero; `%` keeps the dividend's sign. int and decimal do not mix implicitly.",
        examples: [
          {
            name: "Precedence and grouping",
            description: "Parentheses change the result.",
            code: 'fn main() {\n    print(2 + 3 * 4)\n    print((2 + 3) * 4)\n}',
            expected: "14\n20",
          },
          {
            name: "Division and modulo",
            description: "Integer truncation and remainder behaviour.",
            code: 'fn main() {\n    print(17 / 5)\n    print(17 % 5)\n    print(-17 % 5)\n}',
            expected: "3\n2\n-2",
          },
        ],
      },
      {
        id: "comparison",
        title: "Comparison",
        syntax: "==  !=  <  >  <=  >=",
        intro:
          "Comparisons need matching types and produce a bool. Text supports == and !=; ordering (<, >) is not supported for text.",
        examples: [
          {
            name: "Numeric comparisons",
            description: "Each comparison is a boolean.",
            code: 'fn main() {\n    print(3 < 5)\n    print(10 >= 10)\n    print(4 != 4)\n}',
            expected: "1\n1\n0",
          },
          {
            name: "Text equality",
            description: "Text compares by content.",
            code: 'fn main() {\n    print("hmx" == "hmx")\n    print("hmx" == "Hmx")\n}',
            expected: "1\n0",
          },
        ],
      },
      {
        id: "boolean",
        title: "Boolean logic",
        syntax: "and/or/not   or   &&/||/!",
        intro:
          "Word and symbol forms are interchangeable: `and` = `&&`, `or` = `||`, `not` = `!`. Precedence from tightest to loosest: not, comparison, and, or.",
        examples: [
          {
            name: "Word forms",
            description: "The HMX-native style.",
            code: 'fn main() {\n    print(true and false)\n    print(false or true)\n    print(not true)\n}',
            expected: "0\n1\n0",
          },
          {
            name: "Symbol forms",
            description: "Identical semantics, C-like spelling.",
            code: 'fn main() {\n    let a = 5\n    let b = 9\n    print(a < b && b > 0)\n    print(a == 0 || b == 0)\n}',
            expected: "1\n0",
          },
        ],
      },
      {
        id: "text-concat",
        title: "Text concatenation",
        syntax: '"a" + "b"',
        intro:
          "The `+` operator on two text values joins them. It is the textual meaning of +; adding a number to text requires tostr first. Arrays are joined with the `concat` built-in instead.",
        examples: [
          {
            name: "Joining parts",
            description: "Simple and chained concatenation.",
            code: 'fn main() {\n    print("red" + "black")\n    print("hmx" + " " + "lang")\n}',
            expected: "redblack\nhmx lang",
          },
          {
            name: "Build a line from values",
            description: "tostr bridges numbers into text lines.",
            code: 'fn main() {\n    let n = 7\n    print("7 times 6 is " + tostr(n * 6))\n}',
            expected: "7 times 6 is 42",
          },
        ],
      },
      {
        id: "ternary",
        title: "Ternary",
        syntax: "condition ? when-true : when-false",
        intro:
          "A conditional expression: picks one of two values from a bool condition. Both branches must have the same type. Use it inside larger expressions or straight to print.",
        examples: [
          {
            name: "Assigning a ternary result",
            description: "Pick a value by condition.",
            code: 'fn main() {\n    let score = 72\n    let label = score >= 60 ? "pass" : "fail"\n    print(label)\n}',
            expected: "pass",
          },
          {
            name: "Nested ternaries",
            description: "Ternaries nest for multi-way picks.",
            code: 'fn main() {\n    let n = 5\n    print(n > 0 ? (n > 10 ? "big" : "small") : "negative")\n}',
            expected: "small",
          },
        ],
      },
    ],
  },

  {
    id: "assignment",
    title: "Assignment",
    items: [
      {
        id: "basic-assignment",
        title: "Plain assignment",
        syntax: "variable = expression",
        intro:
          "Assignments are statements, not expressions, and the variable must already exist. The assigned value must match the variable's type exactly.",
        examples: [
          {
            name: "Update a counter",
            description: "Reassign with a fresh expression.",
            code: 'fn main() {\n    let score = 10\n    score = score + 5\n    print(score)\n}',
            expected: "15",
          },
          {
            name: "Swap two variables",
            description: "A classic with a temporary.",
            code: 'fn main() {\n    let a = 1\n    let b = 2\n    let t = a\n    a = b\n    b = t\n    print(a, b)\n}',
            expected: "2 1",
          },
        ],
      },
      {
        id: "compound-assignment",
        title: "Compound assignment",
        syntax: "+=  -=  *=  /=  %=",
        intro:
          "Compound operators combine an operation with assignment: `x += 3` means `x = x + 3`. All five arithmetic operators have a compound form.",
        examples: [
          {
            name: "Int accumulation",
            description: "The standard loop-accumulation idiom.",
            code: 'fn main() {\n    let total = 0\n    total += 10\n    total += 5\n    total *= 2\n    print(total)\n}',
            expected: "30",
          },
          {
            name: "Modulo compound",
            description: "Keep a value wrapped in a range.",
            code: 'fn main() {\n    let turn = 0\n    turn += 1\n    turn += 1\n    turn %= 3\n    print(turn)\n}',
            expected: "2",
          },
        ],
      },
      {
        id: "incdec",
        title: "Increment and decrement",
        syntax: "variable++   variable--",
        intro:
          "Postfix `++` and `--` add or subtract 1 in place. They are statements, not expressions.",
        examples: [
          {
            name: "Counting",
            description: "Bump a counter one at a time.",
            code: 'fn main() {\n    let n = 0\n    n++\n    n++\n    n--\n    print(n)\n}',
            expected: "1",
          },
          {
            name: "Loop counters",
            description: "The classic decrementing loop.",
            code: 'fn main() {\n    let fuel = 3\n    while (fuel > 0) {\n        fuel--\n        print("go", fuel)\n    }\n}',
            expected: "go 2\ngo 1\ngo 0",
          },
        ],
      },
    ],
  },

  {
    id: "conversions",
    title: "Conversions & Casts",
    items: [
      {
        id: "as-casts",
        title: "Explicit numeric casts",
        syntax: "value as int|decimal|char|byte",
        intro:
          "`as` converts explicitly among int, decimal, char and byte. decimal to int truncates; casts to byte require the value to stay in 0..255. int to decimal makes float math legal.",
        examples: [
          {
            name: "decimal from int",
            description: "Cast before mixing in decimal math.",
            code: 'fn main() {\n    let precise = 7 as decimal\n    print(precise / 2.0)\n}',
            expected: "3.500000",
          },
          {
            name: "int from decimal",
            description: "Truncation, not rounding.",
            code: 'fn main() {\n    print(2.9 as int)\n    print(2.1 as int)\n}',
            expected: "2\n2",
          },
        ],
      },
      {
        id: "tostr-parse",
        title: "tostr, parse_int, parse_decimal",
        syntax: "tostr(v)   parse_int(text)   parse_decimal(text)",
        intro:
          "tostr renders an int, decimal, bool, char or byte exactly as print would. parse_int and parse_decimal read text; the whole string must parse, and malformed input stops the program at runtime.",
        examples: [
          {
            name: "tostr renders values",
            description: "The same formatting print uses, as text.",
            code: 'fn main() {\n    print(tostr(42))\n    print(tostr(2.5))\n    print(tostr(false))\n    print(tostr(\'Z\'))\n}',
            expected: "42\n2.500000\n0\nZ",
          },
          {
            name: "Parsing text into numbers",
            description: "Strings become numbers for computation.",
            code: 'fn main() {\n    let n = parse_int("100")\n    let d = parse_decimal("3.5")\n    print(n - 1)\n    print(d + 0.5)\n}',
            expected: "99\n4.000000",
          },
        ],
      },
    ],
  },

  {
    id: "conditionals",
    title: "Conditionals",
    items: [
      {
        id: "if-else",
        title: "if and else",
        syntax: 'if (condition) { ... } else { ... }',
        intro:
          "The condition must be a bool. The else branch is optional. Bodies are blocks; there is no single-statement form.",
        examples: [
          {
            name: "Without else",
            description: "Do something only when the condition holds.",
            code: 'fn main() {\n    let temp = 31\n    if (temp > 30) {\n        print("hot")\n    }\n}',
            expected: "hot",
          },
          {
            name: "With else",
            description: "Pick one of two branches.",
            code: 'fn main() {\n    let temp = 20\n    if (temp > 30) {\n        print("hot")\n    } else {\n        print("fine")\n    }\n}',
            expected: "fine",
          },
        ],
      },
      {
        id: "else-if",
        title: "else if chains",
        syntax: 'if (a) { } else if (b) { } else { }',
        intro:
          "Chain any number of `else if` branches; the first true one runs. A final else is optional.",
        examples: [
          {
            name: "Grade bands",
            description: "Mutually exclusive ranges.",
            code: 'fn main() {\n    let score = 75\n    if (score >= 90) { print("A")\n    } else if (score >= 70) { print("B")\n    } else if (score >= 50) { print("C")\n    } else { print("F") }\n}',
            expected: "B",
          },
          {
            name: "Fall-through default",
            description: "The trailing else catches everything else.",
            code: 'fn main() {\n    let kind = "wolf"\n    if (kind == "cat") { print("feline")\n    } else if (kind == "dog") { print("canine")\n    } else { print("unknown", kind) }\n}',
            expected: "unknown wolf",
          },
        ],
      },
      {
        id: "switch",
        title: "switch",
        syntax: "switch (v) { case 1: ...  default: ... }",
        intro:
          "switch matches literal cases of the same int, byte or char type as the value. Cases auto-break — no fallthrough. A default branch runs when nothing matches. Duplicate cases are compile errors.",
        examples: [
          {
            name: "Exact match",
            description: "Only the matching case runs.",
            code: 'fn main() {\n    let day = 2\n    switch (day) {\n        case 1:\n            print("monday")\n        case 2:\n            print("tuesday")\n        default:\n            print("later")\n    }\n}',
            expected: "tuesday",
          },
          {
            name: "Default branch",
            description: "Fallback when no case matches.",
            code: 'fn main() {\n    let status = 99\n    switch (status) {\n        case 200:\n            print("ok")\n        case 404:\n            print("missing")\n        default:\n            print("unexpected", status)\n    }\n}',
            expected: "unexpected 99",
          },
        ],
      },
    ],
  },

  {
    id: "loops",
    title: "Loops",
    intro: "HMX has five loop forms: loop(count), while, do...while, for and foreach.",
    items: [
      {
        id: "loop",
        title: "loop (counted)",
        syntax: "loop (n) { ... }",
        intro:
          "`loop` repeats its body exactly n times. The count must be a non-negative int.",
        examples: [
          {
            name: "Fixed repetitions",
            description: "Three identical passes.",
            code: 'fn main() {\n    loop (3) {\n        print("go")\n    }\n}',
            expected: "go\ngo\ngo",
          },
          {
            name: "Count from a variable",
            description: "The count can be any int expression.",
            code: 'fn main() {\n    let rounds = 2\n    loop (rounds) {\n        print("round")\n    }\n}',
            expected: "round\nround",
          },
        ],
      },
      {
        id: "while",
        title: "while",
        syntax: "while (condition) { ... }",
        intro:
          "Runs the body while the bool condition is true, checking before every pass. Zero passes are fine.",
        examples: [
          {
            name: "Countdown",
            description: "Classic decrementing loop.",
            code: 'fn main() {\n    let n = 3\n    while (n > 0) {\n        print(n)\n        n = n - 1\n    }\n}',
            expected: "3\n2\n1",
          },
          {
            name: "May run zero times",
            description: "A false condition skips the body entirely.",
            code: 'fn main() {\n    let light = false\n    while (light) {\n        print("never seen")\n    }\n    print("done")\n}',
            expected: "done",
          },
        ],
      },
      {
        id: "do-while",
        title: "do ... while",
        syntax: "do { ... } while (condition)",
        intro:
          "Runs the body once, then keeps going while the bool condition is true. The body always runs at least once.",
        examples: [
          {
            name: "Runs at least once",
            description: "Even a false condition executes one pass.",
            code: "fn main() {\n    let n = 0\n    do {\n        n++\n    } while (n < 0)\n    print(n)\n}",
            expected: "1",
          },
          {
            name: "Draining until a limit",
            description: "A halving loop.",
            code: "fn main() {\n    let n = 16\n    do {\n        n = n / 2\n    } while (n >= 2)\n    print(n)\n}",
            expected: "1",
          },
        ],
      },
      {
        id: "for",
        title: "for",
        syntax: "for (let i = 0; i < n; i++) { ... }",
        intro:
          "The header holds an initializer, a bool condition and an update, separated by semicolons (the only semicolons in the language). The initializer variable is scoped to the loop.",
        examples: [
          {
            name: "Upward count",
            description: "Index from 0 while under a bound.",
            code: 'fn main() {\n    for (let i = 0; i < 3; i++) {\n        print(i)\n    }\n}',
            expected: "0\n1\n2",
          },
          {
            name: "Step by two",
            description: "The update can be any statement.",
            code: 'fn main() {\n    for (let i = 10; i > 0; i -= 4) {\n        print(i)\n    }\n}',
            expected: "10\n6\n2",
          },
        ],
      },
      {
        id: "foreach",
        title: "foreach (elements)",
        syntax: "foreach (x in array_or_text) { ... }",
        intro:
          "foreach yields a copy of each element of an array, or each char of a text. Assigning to the loop variable never touches the collection. break and continue work here too.",
        examples: [
          {
            name: "Over an array",
            description: "Visit every element.",
            code: 'fn main() {\n    let scores = [3, 7, 2]\n    foreach (s in scores) {\n        print(s)\n    }\n}',
            expected: "3\n7\n2",
          },
          {
            name: "Over text",
            description: "Iterate characters.",
            code: 'fn main() {\n    foreach (ch in "abc") {\n        print(ch)\n    }\n}',
            expected: "a\nb\nc",
          },
        ],
      },
      {
        id: "foreach-indexed",
        title: "foreach with index",
        syntax: "foreach (i, x in array) { ... }",
        intro:
          "The two-variable form adds the 0-based index before the element. The element is still a copy; the index is an int.",
        examples: [
          {
            name: "Print the position",
            description: "Index and value side by side.",
            code: 'fn main() {\n    let words = ["a", "bb", "ccc"]\n    foreach (i, w in words) {\n        print(i, w)\n    }\n}',
            expected: "0 a\n1 bb\n2 ccc",
          },
          {
            name: "Sum the elements",
            description: "The index is an ordinary int you can compute with.",
            code: 'fn main() {\n    let total = 0\n    let values = [10, 20, 30]\n    foreach (i, v in values) {\n        total = total + v * i\n    }\n    print(total)\n}',
            expected: "80",
          },
        ],
      },
      {
        id: "break-continue",
        title: "break and continue",
        syntax: "break   continue",
        intro:
          "break exits the enclosing loop immediately; continue jumps to the next iteration. Both require an enclosing loop. They are rejected directly inside a switch case unless that case has its own loop.",
        examples: [
          {
            name: "Early exit",
            description: "Stop once a boundary is passed.",
            code: 'fn main() {\n    let sum = 0\n    for (let i = 1; i <= 10; i++) {\n        if (i > 5) {\n            break\n        }\n        sum = sum + i\n    }\n    print(sum)\n}',
            expected: "15",
          },
          {
            name: "Skipping iterations",
            description: "Continue skips the rest of this pass.",
            code: 'fn main() {\n    let sum = 0\n    for (let i = 1; i <= 5; i++) {\n        if (i % 2 == 0) {\n            continue\n        }\n        sum = sum + i\n    }\n    print(sum)\n}',
            expected: "9",
          },
        ],
      },
    ],
  },

  {
    id: "functions",
    title: "Functions",
    items: [
      {
        id: "declare-call",
        title: "Declaring and calling",
        syntax: "fn name() { ... }\nname()",
        intro:
          "Functions group statements under a name. Declare them anywhere at top level; call them as statements (void) or as values. order does not matter — see forward calls.",
        examples: [
          {
            name: "Void function",
            description: "A function with no return value.",
            code: 'fn greet() {\n    print("hi there")\n}\n\nfn main() {\n    greet()\n    greet()\n}',
            expected: "hi there\nhi there",
          },
          {
            name: "Returning a value",
            description: "A function that computes something.",
            code: 'fn answer() -> int {\n    return 42\n}\n\nfn main() {\n    print(answer())\n}',
            expected: "42",
          },
        ],
      },
      {
        id: "params-return",
        title: "Parameters and returns",
        syntax: "fn name(a: int, b: text) -> type { ... }",
        intro:
          "Parameters are explicitly typed with `name: type`. Returns are declared with `-> type` and produce values with `return`. Multiple return values come from tuples (see Tuples).",
        examples: [
          {
            name: "Two typed parameters",
            description: "Arguments are type-checked at call sites.",
            code: 'fn multiply(a: int, b: int) -> int {\n    return a * b\n}\n\nfn main() {\n    print(multiply(6, 7))\n}',
            expected: "42",
          },
          {
            name: "Text parameter",
            description: "Functions over text values.",
            code: 'fn shout(name: text) -> text {\n    return name + "!"\n}\n\nfn main() {\n    print(shout("hmx"))\n}',
            expected: "hmx!",
          },
        ],
      },
      {
        id: "default-params",
        title: "Default parameter values",
        syntax: "fn f(name: text, greeting: text = \"hi\") { ... }",
        intro:
          "Trailing parameters may declare literal defaults. Callers omit them and the caller that omits gets the default. Once a parameter has a default, all later ones must too (except the variadic tail).",
        examples: [
          {
            name: "Default greeting",
            description: "One call omits, one overrides.",
            code: 'fn greet(name: text, greeting: text = "hello") {\n    print(greeting, name)\n}\n\nfn main() {\n    greet("world")\n    greet("bob", "hi")\n}',
            expected: "hello world\nhi bob",
          },
          {
            name: "Default retry count",
            description: "A literal default used when omitted.",
            code: 'fn flash(count: int = 2) {\n    loop (count) {\n        print("beep")\n    }\n}\n\nfn main() {\n    flash()\n    flash(1)\n}',
            expected: "beep\nbeep\nbeep",
          },
        ],
      },
      {
        id: "variadic",
        title: "Variadic parameters",
        syntax: "fn sum(rest: ...int) -> int { ... }",
        intro:
          "A single trailing parameter marked `...type` collects extra arguments into an array inside the body. The element type must be scalar. Inside the body it behaves like a read-only array: length, indexing, foreach.",
        examples: [
          {
            name: "Sum the extras",
            description: "Zero or more arguments become an array.",
            code: 'fn sum(rest: ...int) -> int {\n    let total = 0\n    foreach (x in rest) {\n        total = total + x\n    }\n    return total\n}\n\nfn main() {\n    print(sum())\n    print(sum(1, 2, 3, 4))\n}',
            expected: "0\n10",
          },
          {
            name: "Mixed fixed and varargs",
            description: "Required parameters come first.",
            code: 'fn main() {\n    let tag = "net"\n    fn msg(first: text, rest: ...text) {\n        print("[" + first + "] len", length(rest))\n    }\n    msg("net")\n    msg("db", "a", "b", "c")\n}',
            expected: "[net] len 0\n[db] len 3",
          },
        ],
      },
      {
        id: "recursion",
        title: "Recursion",
        syntax: "fn fact(n: int) -> int { ... fact(n - 1) ... }",
        intro:
          "Functions may call themselves. Guard recursion with a base case, exactly as in other languages.",
        examples: [
          {
            name: "Factorial",
            description: "n! by recursion.",
            code: 'fn fact(n: int) -> int {\n    if (n <= 1) {\n        return 1\n    }\n    return n * fact(n - 1)\n}\n\nfn main() {\n    print(fact(5))\n}',
            expected: "120",
          },
          {
            name: "Fibonacci",
            description: "Classic two-branch recursion.",
            code: 'fn fib(n: int) -> int {\n    if (n < 2) {\n        return n\n    }\n    return fib(n - 1) + fib(n - 2)\n}\n\nfn main() {\n    print(fib(10))\n}',
            expected: "55",
          },
        ],
      },
      {
        id: "forward-calls",
        title: "Forward calls",
        syntax: "use before define",
        intro:
          "Declaration order does not matter at the top level — a function can call functions declared later in the file (or in another module).",
        examples: [
          {
            name: "Call before definition",
            description: "main is first, its helpers come after.",
            code: 'fn main() {\n    print(twice(21))\n}\n\nfn twice(x: int) -> int {\n    return x * 2\n}',
            expected: "42",
          },
          {
            name: "Mutually recursive pair",
            description: "Each helper calls the other.",
            code: 'fn is_even(n: int) -> bool {\n    if (n == 0) { return true }\n    return is_odd(n - 1)\n}\n\nfn is_odd(n: int) -> bool {\n    if (n == 0) { return false }\n    return is_even(n - 1)\n}\n\nfn main() {\n    print(is_even(10))\n    print(is_odd(9))\n}',
            expected: "1\n1",
          },
        ],
      },
      {
        id: "function-values",
        title: "Functions as values",
        syntax: "let f: fn(int) -> int = name",
        intro:
          "A function name is itself a value of function type, written `fn(<params>) -> <ret>`. Such values can be stored, passed, returned and called through variables — except main, which cannot be called.",
        examples: [
          {
            name: "Store and call",
            description: "A function reference in a variable.",
            code: 'fn add(a: int, b: int) -> int {\n    return a + b\n}\n\nfn main() {\n    let f: fn(int, int) -> int = add\n    print(f(5, 7))\n}',
            expected: "12",
          },
          {
            name: "Reassign the function",
            description: "Point a variable at different functions.",
            code: 'fn add(a: int, b: int) -> int { return a + b }\nfn mul(a: int, b: int) -> int { return a * b }\n\nfn main() {\n    let op: fn(int, int) -> int = add\n    print(op(3, 4))\n    op = mul\n    print(op(3, 4))\n}',
            expected: "7\n12",
          },
        ],
      },
    ],
  },

  {
    id: "closures",
    title: "Closures & Lambdas",
    intro: "Nested functions capture their enclosing scope; lambdas make anonymous functions.",
    items: [
      {
        id: "nested-capture",
        title: "Nested functions capture state",
        syntax: "fn outer() { let x = ...;  fn inner() -> int { return x } }",
        intro:
          "A function declared inside another can read the enclosing function's locals and parameters — it becomes a closure. Copies are captured at definition, so the closure is a snapshot.",
        examples: [
          {
            name: "Capture a local",
            description: "inner reads base through the enclosing scope.",
            code: 'fn main() {\n    let base = 100\n    fn add(a: int) -> int {\n        return a + base\n    }\n    print(add(5))\n}',
            expected: "105",
          },
          {
            name: "Closure stored in a typed value",
            description: "The closure is a first-class fn value.",
            code: 'fn main() {\n    let offset = 10\n    fn shift(x: int) -> int {\n        return x + offset\n    }\n    let f: fn(int) -> int = shift\n    print(f(32))\n}',
            expected: "42",
          },
        ],
      },
      {
        id: "lambda",
        title: "lambda",
        syntax: "let f = lambda(x: int) -> int { return x * 2 }",
        intro:
          "`lambda` declares an anonymous function value with the full fn parameter syntax. Omit `-> type` for a void lambda. Lambdas may also capture their enclosing scope.",
        examples: [
          {
            name: "Anonymous doubling",
            description: "A one-off function bound to a name.",
            code: 'fn main() {\n    let dbl = lambda(x: int) -> int {\n        return x * 2\n    }\n    print(dbl(21))\n}',
            expected: "42",
          },
          {
            name: "Void lambda",
            description: "A lambda used for its side effects.",
            code: 'fn main() {\n    let greet = lambda(name: text) {\n        print("hi", name)\n    }\n    greet("HMX")\n}',
            expected: "hi HMX",
          },
        ],
      },
      {
        id: "partial-application",
        title: "Partial application (currying)",
        syntax: "let add_one = add(1)\nadd_one(2)",
        intro:
          "Calling a function value with fewer arguments than its arity returns a closure waiting for the rest — but only for functions without defaults and without varargs. Bind the intermediate closure to a name; chained-call syntax like `add(1)(2)` is not parseable yet.",
        examples: [
          {
            name: "Build up the arguments",
            description: "One, then two, then all three arguments.",
            code: 'fn add(a: int, b: int, c: int) -> int {\n    return a + b + c\n}\n\nfn main() {\n    let add_one = add(1)\n    let add_three = add_one(2)\n    print(add_three(39))\n}',
            expected: "42",
          },
          {
            name: "Fixed first argument",
            description: "Partially apply to make a specialized function.",
            code: 'fn scale(x: int, f: int) -> int {\n    return x * f\n}\n\nfn main() {\n    let doubler = scale(2)\n    print(doubler(21))\n}',
            expected: "42",
          },
        ],
      },
      {
        id: "nonlocal-exit",
        title: "Non-local break / continue",
        syntax: "loop (...) { fn bail() { break }  bail() }",
        intro:
          "A nested function with no loop of its own may `break`/`continue` the nearest loop of the function that calls it, when called directly from inside that loop. Breakers cannot be stored, forwarded, or called indirectly.",
        examples: [
          {
            name: "Break from a helper",
            description: "The break inside bail() stops the outer loop.",
            code: 'fn main() {\n    let total = 0\n    loop (5) {\n        fn bail() {\n            break\n        }\n        total = total + 1\n        if (total == 2) {\n            bail()\n        }\n    }\n    print(total)\n}',
            expected: "2",
          },
          {
            name: "Continue from a helper",
            description: "Skip the rest of the iteration from inside a function.",
            code: 'fn main() {\n    let shown = 0\n    loop (5) {\n        fn skip() {\n            continue\n        }\n        shown = shown + 1\n        if (shown == 3) {\n            skip()\n        }\n        print("tick")\n    }\n    print("count", shown)\n}',
            expected: "tick\ntick\ntick\ntick\ncount 5",
          },
        ],
      },
    ],
  },

  {
    id: "arrays",
    title: "Arrays",
    intro: "Arrays are ordered, growable, single-type collections with reference semantics.",
    items: [
      {
        id: "array-literals",
        title: "Array literals",
        syntax: "let xs = [1, 2, 3]   let empty: [int] = []",
        intro:
          "Literals use square brackets. A non-empty literal infers its element type; the empty literal `[]` needs an annotation. Element types can be scalars, tuples or other arrays.",
        examples: [
          {
            name: "Inferred and annotated",
            description: "Type comes from the literal or the annotation.",
            code: 'fn main() {\n    let nums = [1, 2, 3]\n    let names: [text] = ["ada", "grace"]\n    print(length(nums), length(names))\n}',
            expected: "3 2",
          },
          {
            name: "Empty array with annotation",
            description: "Grow it later with push.",
            code: 'fn main() {\n    let todo: [text] = []\n    print(length(todo))\n    push(todo, "first")\n    print(length(todo))\n}',
            expected: "0\n1",
          },
        ],
      },
      {
        id: "array-indexing",
        title: "Indexing and element assignment",
        syntax: "xs[i]   xs[i] = v",
        intro:
          "Index with `[i]` to read or write. Indexes are bounds-checked at runtime: an out-of-range index terminates the program.",
        examples: [
          {
            name: "Read and write",
            description: "Elements at arbitrary positions.",
            code: 'fn main() {\n    let xs: [int] = [10, 20, 30]\n    print(xs[1])\n    xs[1] = 99\n    print(xs[1])\n}',
            expected: "20\n99",
          },
          {
            name: "Compute the index",
            description: "The index is any int expression.",
            code: 'fn main() {\n    let xs = [5, 10, 15, 20]\n    let i = 0\n    print(xs[i])\n    print(xs[length(xs) - 1])\n}',
            expected: "5\n20",
          },
        ],
      },
      {
        id: "array-iteration",
        title: "length and foreach",
        syntax: "length(xs)   foreach (x in xs) { ... }",
        intro:
          "length(array) returns the element count. foreach visits a copy of each element — writes to the loop variable never change the array.",
        examples: [
          {
            name: "Sum with for",
            description: "A classical indexed accumulation.",
            code: 'fn main() {\n    let xs = [4, 8, 15, 16, 23, 42]\n    let total = 0\n    for (let i = 0; i < length(xs); i++) {\n        total = total + xs[i]\n    }\n    print(total)\n}',
            expected: "108",
          },
          {
            name: "foreach is read-only",
            description: "Doubling the loop variable leaves the array alone.",
            code: 'fn main() {\n    let xs = [1, 2, 3]\n    foreach (x in xs) {\n        x = x * 10\n    }\n    print(xs[0])\n}',
            expected: "1",
          },
        ],
      },
      {
        id: "push-pop",
        title: "push and pop",
        syntax: "push(xs, v)   let v = pop(xs)",
        intro:
          "push appends an element; pop removes and returns the last. pop on an empty array is a runtime error. Arrays grow their backing storage as needed.",
        examples: [
          {
            name: "A stack",
            description: "Push three, pop them off in reverse.",
            code: 'fn main() {\n    let stack: [int] = []\n    push(stack, 1)\n    push(stack, 2)\n    push(stack, 3)\n    print(pop(stack))\n    print(pop(stack))\n    print(length(stack))\n}',
            expected: "3\n2\n1",
          },
          {
            name: "Typed elements",
            description: "Text works too.",
            code: 'fn main() {\n    let log: [text] = []\n    push(log, "boot")\n    push(log, "ready")\n    print(pop(log))\n}',
            expected: "ready",
          },
        ],
      },
      {
        id: "sort-slice-concat",
        title: "sort, slice, concat",
        syntax: "sort(xs)   slice(xs, i, j)   concat(a, b)",
        intro:
          "sort rearranges in place ascending (scalar and text elements). slice copies a half-open range [i, j) into a new independent array. concat joins two arrays of the same element type into a new array — the only way to join arrays; `+` stays text-only.",
        examples: [
          {
            name: "Sort then slice",
            description: "Ordered range extraction.",
            code: 'fn main() {\n    let nums: [int] = [5, 3, 8, 1]\n    sort(nums)\n    print(nums[0], nums[3])\n    let head: [int] = slice(nums, 0, 2)\n    print(length(head), head[1])\n}',
            expected: "1 8\n2 3",
          },
          {
            name: "Concat two arrays",
            description: "Join and read the merged result.",
            code: 'fn main() {\n    let a: [int] = [1, 2]\n    let b: [int] = [3, 4]\n    let all: [int] = concat(a, b)\n    print(length(all))\n    print(all[2])\n}',
            expected: "4\n3",
          },
        ],
      },
      {
        id: "array-search",
        title: "index_of and contains",
        syntax: "index_of(xs, v)   contains(xs, v)",
        intro:
          "index_of returns the first matching index or -1; contains returns a bool. Scalar and text element types are supported; text compares by content.",
        examples: [
          {
            name: "Find a position",
            description: "Locate an element in a text array.",
            code: 'fn main() {\n    let names: [text] = ["ada", "grace", "ada"]\n    print(index_of(names, "grace"))\n    print(index_of(names, "linus"))\n}',
            expected: "1\n-1",
          },
          {
            name: "Membership check",
            description: "contains as a boolean test.",
            code: 'fn main() {\n    let nums = [4, 8, 15]\n    print(contains(nums, 15))\n    print(contains(nums, 16))\n}',
            expected: "1\n0",
          },
        ],
      },
      {
        id: "nested-arrays",
        title: "Nested arrays",
        syntax: "let m: [[int]] = [[1, 2], [3, 4]]   m[i][j]",
        intro:
          "Element types can be arrays, giving multi-dimensional matrices with chained indexing and assignment. foreach nests naturally.",
        examples: [
          {
            name: "Matrix access",
            description: "Index row then column.",
            code: 'fn main() {\n    let m: [[int]] = [[1, 2], [3, 4]]\n    print(m[1][0])\n    m[0][1] = 9\n    print(m[0][1])\n}',
            expected: "3\n9",
          },
          {
            name: "Nested foreach",
            description: "Sum every cell.",
            code: 'fn main() {\n    let m = [[1, 2, 3], [4, 5, 6]]\n    let total = 0\n    foreach (row in m) {\n        foreach (x in row) {\n            total = total + x\n        }\n    }\n    print(total)\n}',
            expected: "21",
          },
        ],
      },
      {
        id: "array-reference",
        title: "Reference semantics",
        syntax: "let b = a   // b shares a's storage",
        intro:
          "Arrays are reference values: copying an array variable shares the same backing storage, so writes, push and pop through either name are visible through both. Close one handle and the other still sees it.",
        examples: [
          {
            name: "Aliases share storage",
            description: "push through b appears on a too.",
            code: 'fn main() {\n    let a = [1, 2, 3]\n    let b = a\n    push(b, 4)\n    print(length(a))\n    print(a[3])\n}',
            expected: "4\n4",
          },
          {
            name: "Element write through an alias",
            description: "Writing via one name moves data on the other.",
            code: 'fn main() {\n    let a = [0, 0, 0]\n    let b = a\n    b[1] = 7\n    print(a[1])\n}',
            expected: "7",
          },
        ],
      },
    ],
  },

  {
    id: "tuples",
    title: "Tuples",
    intro: "Tuples bundle a fixed number of values, possibly of different types, into one value.",
    items: [
      {
        id: "tuple-literals",
        title: "Tuple literals",
        syntax: "let t = (1, 2)   let t: (int, int) = (1, 2)",
        intro:
          "Two or more comma-separated values in parentheses form a tuple literal. A single parenthesized value `(v)` is just grouping. Members are accessed with a constant index `t[0]`.",
        examples: [
          {
            name: "Two ints",
            description: "A minimal pair.",
            code: 'fn main() {\n    let t = (1, 2)\n    print(t[0] + t[1])\n}',
            expected: "3",
          },
          {
            name: "Passed to a function",
            description: "Tuples are ordinary values with types.",
            code: 'fn first(t: (int, int)) -> int {\n    return t[0]\n}\n\nfn main() {\n    print(first((10, 20)))\n}',
            expected: "10",
          },
        ],
      },
      {
        id: "nested-tuples",
        title: "Nested tuples",
        syntax: "let t = (4, (5, 6))   t[1][0]",
        intro:
          "A tuple member can itself be a tuple. Chained constant indexes reach inside.",
        examples: [
          {
            name: "Reach into the inner tuple",
            description: "Index outer, then inner.",
            code: 'fn main() {\n    let t = (4, (5, 6))\n    print(t[0])\n    print(t[1][0])\n}',
            expected: "4\n5",
          },
          {
            name: "Deep nesting",
            description: "Three levels down.",
            code: 'fn main() {\n    let t = (1, (2, (3, 4)))\n    print(t[1][1][1])\n}',
            expected: "4",
          },
        ],
      },
      {
        id: "heterogeneous",
        title: "Heterogeneous tuples",
        syntax: "let t = (42, \"hi\", true)",
        intro:
          "Members do not need a common type: an int, a text and a bool can live in one tuple. Read them with constant indexes.",
        examples: [
          {
            name: "Mixed members",
            description: "Different types on one value.",
            code: 'fn main() {\n    let box = (42, "hi", true)\n    print(box[0], box[1], box[2])\n}',
            expected: "42 hi 1",
          },
          {
            name: "Mixed return values",
            description: "Return several different results at once.",
            code: 'fn describe(n: int) -> (int, text, bool) {\n    return n, tostr(n), n > 0\n}\n\nfn main() {\n    let (v, s, ok) = describe(-3)\n    print(v, s, ok)\n}',
            expected: "-3 -3 0",
          },
        ],
      },
      {
        id: "tuple-destructuring",
        title: "Destructuring tuples",
        syntax: "let (a, b) = (10, 20)",
        intro:
          "Unpack a tuple directly into variables with `let (a, b, ...) = t`. Useful for multiple return values, as shown in this section's second example.",
        examples: [
          {
            name: "Swap via tuple",
            description: "The canonical swap.",
            code: 'fn main() {\n    let a = 1\n    let b = 2\n    let (a2, b2) = (b, a)\n    print(a2, b2)\n}',
            expected: "2 1",
          },
          {
            name: "Multiple returns",
            description: "Return a pair and unpack it.",
            code: 'fn divmod(a: int, b: int) -> (int, int) {\n    return a / b, a - (a / b) * b\n}\n\nfn main() {\n    let (q, r) = divmod(17, 5)\n    print(q, r)\n}',
            expected: "3 2",
          },
        ],
      },
      {
        id: "tuple-dynamic",
        title: "Dynamic tuple indexing",
        syntax: "t[i]  // all members share a type",
        intro:
          "When every member has the same type, a runtime int index works — with bounds checks. Constant-index access always works, regardless of member types.",
        examples: [
          {
            name: "Index with a variable",
            description: "Runtime pick from a same-typed tuple.",
            code: 'fn pick(t: (int, int, int), i: int) -> int {\n    return t[i]\n}\n\nfn main() {\n    print(pick((10, 20, 30), 1))\n}',
            expected: "20",
          },
          {
            name: "Loop over the members",
            description: "Visit every slot.",
            code: 'fn main() {\n    let t = (7, 14, 21)\n    for (let i = 0; i < 3; i++) {\n        print(t[i])\n    }\n}',
            expected: "7\n14\n21",
          },
        ],
      },
      {
        id: "arrays-of-tuples",
        title: "Arrays of tuples",
        syntax: "let pts = [(1, 2), (3, 4)]   pts[i][j]",
        intro:
          "Arrays of tuple literals are first-class: elements are tuples, so `pts[i][j]` reads member j of element i. foreach gives each tuple element as a copy.",
        examples: [
          {
            name: "Point coordinates",
            description: "An array of points, member access.",
            code: 'fn main() {\n    let points = [(1, 2), (3, 4)]\n    print(points[1][0])\n    print(points[0][1])\n}',
            expected: "3\n2",
          },
          {
            name: "Iterate the points",
            description: "foreach yields each tuple.",
            code: 'fn main() {\n    let points = [(1, 2), (3, 4)]\n    foreach (p in points) {\n        print(p[0], p[1])\n    }\n}',
            expected: "1 2\n3 4",
          },
        ],
      },
    ],
  },

  {
    id: "destructuring",
    title: "Destructuring",
    intro: "Unpack arrays and text into variables with the same let-(...) syntax used for tuples.",
    items: [
      {
        id: "array-destructure",
        title: "Destructuring arrays",
        syntax: "let (a, b, c) = [10, 20, 30]",
        intro:
          "Bind the first elements of an array to fresh variables. The arity of the pattern must fit the array — extra elements can be caught with ...rest (see below).",
        examples: [
          {
            name: "Head of a list",
            description: "Bind the first three elements.",
            code: 'fn main() {\n    let data = [10, 20, 30, 40]\n    let (a, b, c) = data\n    print(a, b, c)\n}',
            expected: "10 20 30",
          },
          {
            name: "Destructure a return",
            description: "A function returning an array, unpacked.",
            code: 'fn make() -> [int] {\n    return [5, 6]\n}\n\nfn main() {\n    let (x, y) = make()\n    print(x * y)\n}',
            expected: "30",
          },
        ],
      },
      {
        id: "text-destructure",
        title: "Destructuring text",
        syntax: "let (a, b) = \"hi\"",
        intro:
          "The same pattern unpacks the first characters of a text value into chars.",
        examples: [
          {
            name: "First two characters",
            description: "Bind chars from a text.",
            code: 'fn main() {\n    let (a, b) = "hi"\n    print(a, b)\n}',
            expected: "h i",
          },
          {
            name: "Chars from a computed text",
            description: "Destructure the result of an expression.",
            code: 'fn main() {\n    let word = "cat"\n    let (c1, c2, c3) = word + "s"\n    print(c1, c2, c3)\n}',
            expected: "c a t",
          },
        ],
      },
      {
        id: "rest-patterns",
        title: "...rest patterns",
        syntax: "let (a, b, ...rest) = [1, 2, 3, 4]",
        intro:
          "A trailing `...rest` captures everything after the bound names as an array (or text). This is the way to peel a head off a list.",
        examples: [
          {
            name: "Head and tail",
            description: "Bind the head, keep the tail.",
            code: 'fn main() {\n    let data = [1, 2, 3, 4]\n    let (first, second, ...rest) = data\n    print(first, second, length(rest))\n    print(rest[0])\n}',
            expected: "1 2 2\n3",
          },
          {
            name: "Rest over text",
            description: "The rest of a string arrives as text.",
            code: 'fn main() {\n    let (h, ...rest) = "hello"\n    print(h, rest)\n    print(length(rest))\n}',
            expected: "h ello\n4",
          },
        ],
      },
      {
        id: "nested-patterns",
        title: "Nested patterns",
        syntax: "let ((a, b), c) = ((1, 2), 3)",
        intro:
          "Patterns nest: a tuple or array member can itself be a pattern, reaching arbitrarily deep into the value.",
        examples: [
          {
            name: "Nested tuple pattern",
            description: "Destructure a tuple inside a tuple.",
            code: 'fn main() {\n    let t = ((1, 2), 3)\n    let ((a, b), c) = t\n    print(a, b, c)\n}',
            expected: "1 2 3",
          },
          {
            name: "Array of tuples",
            description: "Rest catches whole tuples.",
            code: 'fn main() {\n    let points = [(1, 2), (3, 4), (5, 6)]\n    let (p, ...rest) = points\n    print(p[0], p[1])\n    print(length(rest))\n}',
            expected: "1 2\n2",
          },
        ],
      },
    ],
  },

  {
    id: "text-io",
    title: "Text & I/O",
    items: [
      {
        id: "text-builtins",
        title: "length and substring",
        syntax: "length(s)   substring(s, start, end)",
        intro:
          "length returns byte count. substring returns the half-open range [start, end). Invalid bounds terminate the program at runtime. length also works on arrays.",
        examples: [
          {
            name: "Measure and cut",
            description: "Basic string operations.",
            code: 'fn main() {\n    let message = "hello world"\n    print(length(message))\n    print(substring(message, 0, 5))\n}',
            expected: "11\nhello",
          },
          {
            name: "A range in the middle",
            description: "Take a slice from inside.",
            code: 'fn main() {\n    let tag = "HMX v2.1"\n    print(substring(tag, 5, length(tag)))\n}',
            expected: "2.1",
          },
        ],
      },
      {
        id: "char-index",
        title: "Character indexing",
        syntax: "s[i]",
        intro:
          "Index a text byte-wise to read a char. text[i] is read-only; assigning to it is a compile error. Bounds are checked at runtime.",
        examples: [
          {
            name: "First and last char",
            description: "Index from either end.",
            code: 'fn main() {\n    let s = "hello"\n    print(s[0])\n    print(s[length(s) - 1])\n}',
            expected: "h\no",
          },
          {
            name: "Index with a loop",
            description: "Reassemble the string by walking it.",
            code: 'fn main() {\n    let s = "abc"\n    for (let i = 0; i < length(s); i++) {\n        print(ord(s[i]))\n    }\n}',
            expected: "97\n98\n99",
          },
        ],
      },
      {
        id: "ord-chr-split",
        title: "ord, chr and split",
        syntax: "ord(ch)   chr(int)   split(text, sep)",
        intro:
          "ord gives a char's byte value; chr builds a char from 0..255 (out of range is a runtime error). split cuts a text on a non-empty separator into a [text] array, preserving empty and missing pieces.",
        examples: [
          {
            name: "Char / byte round trip",
            description: "Shift a letter by one.",
            code: 'fn main() {\n    print(chr(ord(\'b\') + 1))\n    print(ord(\'A\'))\n}',
            expected: "c\n65",
          },
          {
            name: "Split on a separator",
            description: "Pieces with gaps preserved.",
            code: 'fn main() {\n    let parts: [text] = split("a,b,,c", ",")\n    print(length(parts))\n    print(parts[0])\n    print(index_of(parts, "c"))\n}',
            expected: "4\na\n3",
          },
        ],
      },
      {
        id: "stdin",
        title: "Reading input",
        syntax: "let line = input()",
        intro:
          "input() reads one line from standard input (newline stripped). At end of input it returns the empty string — a natural way to detect EOF.",
        examples: [
          {
            name: "Say hello back",
            description: "Read a name and echo it.",
            code: 'fn main() {\n    let name = input()\n    if (name == "") {\n        print("no input given")\n    } else {\n        print("hello", name)\n    }\n}',
            expected: "no input given",
          },
          {
            name: "A tiny REPL",
            description: "Read lines until end of input.",
            code: 'fn main() {\n    loop (1000000) {\n        let line = input()\n        if (line == "") {\n            break\n        }\n        print(">>", line)\n    }\n    print("bye")\n}',
            expected: "bye",
          },
        ],
      },
    ],
  },

  {
    id: "modules",
    title: "Modules",
    intro: "Split a program across files with use. Top-level functions from all modules share one namespace.",
    items: [
      {
        id: "use-modules",
        title: "use",
        syntax: 'use "path/to/file.hmx"',
        intro:
          "`use` statements sit at the very top of a file, before any declarations. Paths are relative to the importing file and must end in .hmx. Each file is loaded once; cycles are compile errors. Errors inside a module are tagged with the module's path.",
        examples: [
          {
            name: "A small math library",
            description: "Entry file imports a module and calls its function.",
            code: 'use "lib/math.hmx"\n\nfn main() {\n    print(area_of_circle(2.0))\n}',
            expected: "12.566360",
            moduleFiles: {
              "lib/math.hmx":
                'fn area_of_circle(r: decimal) -> decimal {\n    return 3.14159 * r * r\n}',
            },
          },
          {
            name: "Shared utilities",
            description: "Helper functions live in one module, used from another.",
            code: 'use "lib/util.hmx"\n\nfn main() {\n    print(halve(10))\n    print(quadruple(5))\n}',
            expected: "5\n20",
            moduleFiles: {
              "lib/util.hmx":
                'fn halve(x: int) -> int {\n    return x / 2\n}\n\nfn quadruple(x: int) -> int {\n    return x * 4\n}',
            },
          },
        ],
      },
      {
        id: "module-closures",
        title: "Modules can capture and loop",
        syntax: "modules may define closures and non-local exits",
        intro:
          "Imported modules enjoy the full language: closures that capture state and helpers that use non-local break/continue, just like entry-file code.",
        examples: [
          {
            name: "Module-chained transformations",
            description: "A module builds a chain of helpers.",
            code: 'use "lib/chain.hmx"\n\nfn main() {\n    let n = 1\n    n = bump(n)\n    n = bump(n)\n    print(n)\n}',
            expected: "3",
            moduleFiles: {
              "lib/chain.hmx":
                'fn bump(x: int) -> int {\n    return x + 1\n}',
            },
          },
          {
            name: "Module closure factory",
            description: "A module returns a closure that captured its parameter.",
            code: 'use "lib/adder.hmx"\n\nfn main() {\n    let add10 = make_adder(10)\n    print(add10(32))\n}',
            note: "Closures returned from modules work exactly like local ones.",
            expected: "42",
            moduleFiles: {
              "lib/adder.hmx":
                'fn make_adder(offset: int) -> fn(int) -> int {\n    fn add(x: int) -> int {\n        return x + offset\n    }\n    return add\n}',
            },
          },
        ],
      },
    ],
  },
];