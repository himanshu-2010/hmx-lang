// Lexer port of src/lexer.l — flex semantics replicated exactly:
//  - keywords are matched before identifiers but flex longest-match wins
//    (so `letta` is an identifier, `let` is the keyword)
//  - string literals are NOT unescaped: the raw text between quotes is kept
//  - an unterminated string/char literal falls through to the `.` rule, which
//    prints "Unexpected character: X at line N" and returns the invalid token 1
//  - EOF inside a block comment prints "Error [line N]: unterminated block
//    comment" and returns EOF (yyterminate)
//  - `line` mirrors flex `yylineno` after consuming the token (newlines inside
//    string literals and block comments advance it)

export interface LexToken {
  /** token id: 258+ keyword/op id, ASCII char code, 0 = EOF, 1 = invalid */
  code: number;
  /** semantic value (number for NUMBER/DECIMAL, string for STRING/CHAR/IDENTIFIER) */
  value: number | string | null;
  /** yytext — the raw matched source text */
  text: string;
  /** flex yylineno after this token was matched */
  line: number;
}

// Token ids match the yytokentype enum in build/parser.hpp.
const T: Record<string, number> = {
  LET: 258, CONST: 259, FN: 260, LOOP: 261, FOREACH: 262, IN: 263,
  FOR: 264, WHILE: 265, DO: 266, SWITCH: 267, CASE: 268, DEFAULT: 269,
  PRINT: 270, RETURN: 271, TRUE: 272, FALSE: 273, IF: 274, ELSE: 275,
  BREAK: 276, CONTINUE: 277, TYPE_INT: 278, TYPE_DECIMAL: 279,
  TYPE_TEXT: 280, TYPE_BOOL: 281, TYPE_CHAR: 282, TYPE_BYTE: 283,
  NUMBER: 284, DECIMAL: 285, STRING: 286, CHAR: 287, IDENTIFIER: 288,
  EQ: 289, NEQ: 290, LT: 291, GT: 292, LEQ: 293, GEQ: 294,
  AND: 295, OR: 296, NOT: 297, PLUS_EQ: 298, MINUS_EQ: 299,
  STAR_EQ: 300, SLASH_EQ: 301, MOD_EQ: 302, INCR: 303, DECR: 304,
  ARROW: 305, LAMBDA: 306, ELLIPSIS: 307, AS: 308, USE: 309,
};

const KEYWORDS: Record<string, number> = {
  let: T.LET, const: T.CONST, fn: T.FN, loop: T.LOOP, foreach: T.FOREACH,
  in: T.IN, for: T.FOR, while: T.WHILE, do: T.DO, switch: T.SWITCH,
  case: T.CASE, default: T.DEFAULT, print: T.PRINT, return: T.RETURN,
  break: T.BREAK, continue: T.CONTINUE, if: T.IF, else: T.ELSE,
  true: T.TRUE, false: T.FALSE, and: T.AND, or: T.OR, not: T.NOT,
  as: T.AS, use: T.USE, lambda: T.LAMBDA,
  int: T.TYPE_INT, decimal: T.TYPE_DECIMAL, text: T.TYPE_TEXT,
  bool: T.TYPE_BOOL, char: T.TYPE_CHAR, byte: T.TYPE_BYTE,
};

// Multi-char operators, longest first (flex longest-match; ties resolve by
// rule order, which the ordering below mirrors for equal-length matches).
const OPERATORS: Array<[string, number]> = [
  ["...", T.ELLIPSIS],
  ["->", T.ARROW],
  ["+=", T.PLUS_EQ],
  ["-=", T.MINUS_EQ],
  ["*=", T.STAR_EQ],
  ["/=", T.SLASH_EQ],
  ["%=", T.MOD_EQ],
  ["++", T.INCR],
  ["--", T.DECR],
  ["==", T.EQ],
  ["!=", T.NEQ],
  ["<=", T.LEQ],
  [">=", T.GEQ],
  ["&&", T.AND],
  ["||", T.OR],
  ["{", 123],
  ["}", 125],
  ["(", 40],
  [")", 41],
  [";", 59],
  ["+", 43],
  ["-", 45],
  ["*", 42],
  ["/", 47],
  [":", 58],
  ["=", 61],
  [",", 44],
  ["?", 63],
  ["[", 91],
  ["]", 93],
  ["%", 37],
  ["<", T.LT],
  [">", T.GT],
  ["!", T.NOT],
];

export class Lexer {
  private pos = 0;
  private line = 1;
  private inBlockComment = false;

  constructor(
    private src: string,
    private emit: (msg: string) => void
  ) {}

  /** Advance `n` chars, counting newlines like flex yylineno. */
  private advance(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.src[this.pos + i] === "\n") this.line++;
    }
    this.pos += n;
  }

  private isIdentStart(c: string): boolean {
    const code = c.charCodeAt(0);
    return (
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      c === "_" ||
      code > 127
    );
  }

  private isIdentPart(c: string): boolean {
    const code = c.charCodeAt(0);
    return (
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      c === "_" ||
      code > 127
    );
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isSpace(c: string): boolean {
    return c === " " || c === "\t" || c === "\r" || c === "\n";
  }

  /** Scan a full string literal `"..."`. Returns raw inner text or null if unterminated. */
  private scanString(): { text: string; value: string } | null {
    let i = this.pos + 1;
    const n = this.src.length;
    while (i < n) {
      const ch = this.src[i];
      if (ch === '"') {
        const text = this.src.slice(this.pos, i + 1);
        return { text, value: text.slice(1, -1) };
      }
      if (ch === "\\") {
        i += 2; // escape sequence; may run past EOF (still no match -> unterminated)
        continue;
      }
      i++;
    }
    return null; // unterminated -> `"` falls to the unexpected-char rule
  }

  next(): LexToken {
    const n = this.src.length;
    for (;;) {
      if (this.pos >= n) {
        if (this.inBlockComment) {
          this.emit(`Error [line ${this.line}]: unterminated block comment\n`);
          this.inBlockComment = false;
        }
        return { code: 0, value: null, text: "", line: this.line };
      }

      const c = this.src[this.pos];

      // --- block comment state ---
      if (this.inBlockComment) {
        if (c === "*" && this.src[this.pos + 1] === "/") {
          this.advance(2);
          this.inBlockComment = false;
          continue;
        }
        this.advance(1);
        continue;
      }

      // --- whitespace ---
      if (this.isSpace(c)) {
        let i = this.pos;
        while (i < n && this.isSpace(this.src[i])) i++;
        this.advance(i - this.pos);
        continue;
      }

      // --- block comment start ---
      if (c === "/" && this.src[this.pos + 1] === "*") {
        this.advance(2);
        this.inBlockComment = true;
        continue;
      }

      // --- line comment: "//".* (does not consume the newline) ---
      if (c === "/" && this.src[this.pos + 1] === "/") {
        let i = this.pos + 2;
        while (i < n && this.src[i] !== "\n") i++;
        this.advance(i - this.pos);
        continue;
      }

      // --- identifiers & keywords ---
      if (this.isIdentStart(c)) {
        let i = this.pos + 1;
        while (i < n && this.isIdentPart(this.src[i])) i++;
        const text = this.src.slice(this.pos, i);
        this.advance(i - this.pos);
        const kw = KEYWORDS[text];
        if (kw !== undefined) {
          return { code: kw, value: text, text, line: this.line };
        }
        return { code: T.IDENTIFIER, value: text, text, line: this.line };
      }

      // --- numbers: [0-9]+\.[0-9]+ then [0-9]+ ---
      if (this.isDigit(c)) {
        let i = this.pos;
        while (i < n && this.isDigit(this.src[i])) i++;
        if (this.src[i] === "." && this.isDigit(this.src[i + 1])) {
          let j = i + 1;
          while (j < n && this.isDigit(this.src[j])) j++;
          const text = this.src.slice(this.pos, j);
          this.advance(j - this.pos);
          return { code: T.DECIMAL, value: parseFloat(text), text, line: this.line };
        }
        const text = this.src.slice(this.pos, i);
        this.advance(i - this.pos);
        return { code: T.NUMBER, value: parseInt(text, 10), text, line: this.line };
      }

      // --- string literal ---
      if (c === '"') {
        const s = this.scanString();
        if (s) {
          this.advance(s.text.length);
          return { code: T.STRING, value: s.value, text: s.text, line: this.line };
        }
        // unterminated: fall through to unexpected-char handling below
      }

      // --- char literal: \'[^\'\\]\' ---
      if (c === "'") {
        const nxt = this.src[this.pos + 1];
        const after = this.src[this.pos + 2];
        if (
          this.pos + 2 < n &&
          after === "'" &&
          nxt !== "'" &&
          nxt !== "\\"
        ) {
          const text = this.src.slice(this.pos, this.pos + 3);
          this.advance(3);
          return { code: T.CHAR, value: text[1], text, line: this.line };
        }
        // not a valid char literal: fall through
      }

      // --- operators (longest match); `"` / `'` already fell through ---
      for (const [pat, code] of OPERATORS) {
        if (this.src.startsWith(pat, this.pos)) {
          this.advance(pat.length);
          return { code, value: pat, text: pat, line: this.line };
        }
      }

      // --- unexpected character ---
      const errText = this.src.slice(this.pos, this.pos + 1);
      this.emit(`Unexpected character: ${errText} at line ${this.line}\n`);
      this.advance(1);
      return { code: 1, value: null, text: errText, line: this.line };
    }
  }
}