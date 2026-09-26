// In-browser runtime for generated HMX programs.
//
// This is the JS twin of the sd_* helpers that codegen.cpp emits inline into
// the generated C. Every message string and exit behaviour mirrors the native
// binary exactly so the parity suite can compare byte-for-byte.
//
// The generated JS receives one object `SD` built by `createRuntime` below.
// All runtime failures append `Error: ...\n` to stderr and abort execution by
// throwing `ExitSignal(1)`, matching `fprintf(stderr, ...); exit(1)`.

/** Thrown to unwind the generated JS; the VM turns this into the exit code. */
export class ExitSignal {
  constructor(public code: number) {}
}

/** Marker / meta objects thrown for non-local break (k=1) and continue (k=2). */
export interface NonLocal {
  m: object;
  k: 1 | 2;
}

export interface SDRuntime {
  // output streams
  out: string;
  err: string;
  /** print(a, b, ...) pre-formatted strings, joined with single spaces + \n */
  print: (...parts: string[]) => void;
  /** format int/bool/byte with C %d semantics */
  fI: (v: number) => string;
  /** format decimal with C %f (6 fixed) semantics */
  fD: (v: number) => string;
  // runtime exit / error helpers
  fail: (msg: string) => never;
  error: (msg: string) => void;
  silentExit: () => never;
  // indexing
  arrIdx: (arr: unknown[], i: number) => unknown;
  textIdx: (s: string, i: number) => string;
  idxSet: (arr: unknown[], i: number, v: unknown) => unknown;
  tupleIdx: (t: unknown[], i: number, arity: number) => unknown;
  tupleSet: (t: unknown[], i: number, arity: number, v: unknown) => unknown;
  // collections
  push: (arr: unknown[], v: unknown) => void;
  pop: (arr: unknown[]) => unknown;
  sort: (arr: unknown[], isText: boolean) => void;
  slice: (arr: unknown[], a: number, b: number) => unknown[];
  arrConcat: (x: unknown[], y: unknown[]) => unknown[];
  split: (s: string, sep: string) => string[];
  indexOf: (arr: unknown[], v: unknown) => number;
  contains: (arr: unknown[], v: unknown) => number;
  /** C integer division (`/` on int operands): truncates toward zero. */
  idiv: (a: number, b: number) => number;
  // strings
  substring: (s: string, start: number, end: number) => string;
  // value semantics
  /** shallow copy for tuples at every C struct-pass-by-value boundary */
  copy: <T>(v: T) => T;
  /** snapshot a capture value for a closure env (tuples copied, others shared) */
  snap: <T>(v: T, isTuple: boolean) => T;
  // conversions
  ord: (c: string) => number;
  chr: (v: number) => string;
  parseInt: (s: string) => number;
  parseDecimal: (s: string) => number;
  // non-local exit
  nlBrk: (m: object) => never;
  nlCont: (m: object) => never;
  // I/O
  input: () => string;
}

/** C `%f` formatting (6 decimals, glibc nan/inf spellings). */
export function fmtDecimal(v: number): string {
  if (v !== v) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  if (v === 0 && 1 / v === -Infinity) return "-0.000000";
  return v.toFixed(6);
}

/**
 * Build the runtime used by one generated program.
 *
 * `stdin` may be an exact string (the bytes the CLI would pipe through stdin;
 * split like getline: strip trailing \r, EOF => "") or a pre-split array of
 * lines (each element is one `input()` result; EOF => "" after the last one).
 */
export function createRuntime(stdin: string | string[]): SDRuntime {
  const out: string[] = [];
  const err: string[] = [];

  // getline-equivalent line reader.
  let lines: string[];
  if (Array.isArray(stdin)) {
    lines = stdin.slice();
  } else {
    lines = stdin.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/\r+$/, "");
    }
  }
  let lineIdx = 0;

  const sd = {
    print(...parts: string[]) {
      out.push(parts.join(" "), "\n");
    },
    fI(v: number): string {
      return `${v}`;
    },
    fD(v: number): string {
      return fmtDecimal(v);
    },
    fail(msg: string): never {
      err.push(msg, "\n");
      throw new ExitSignal(1);
    },
    error(msg: string): void {
      err.push(msg, "\n");
    },
    silentExit(): never {
      throw new ExitSignal(1);
    },
    arrIdx(arr: unknown[], i: number): unknown {
      if (i < 0 || i >= arr.length) {
        sd.fail(`Error: array index out of bounds (index ${i}, length ${arr.length})`);
      }
      return arr[i];
    },
    textIdx(s: string, i: number): string {
      if (i < 0 || i >= s.length) {
        sd.fail(`Error: array index out of bounds (index ${i}, length ${s.length})`);
      }
      return s[i];
    },
    idxSet(arr: unknown[], i: number, v: unknown): unknown {
      if (i < 0 || i >= arr.length) {
        sd.fail(`Error: array index out of bounds (index ${i}, length ${arr.length})`);
      }
      arr[i] = v;
      return v;
    },
    tupleIdx(t: unknown[], i: number, arity: number): unknown {
      if (i < 0 || i >= arity) {
        sd.fail(`Error: tuple index out of bounds (index ${i}, length ${arity})`);
      }
      return t[i];
    },
    tupleSet(t: unknown[], i: number, arity: number, v: unknown): unknown {
      if (i < 0 || i >= arity) {
        sd.fail(`Error: tuple index out of bounds (index ${i}, length ${arity})`);
      }
      t[i] = v;
      return v;
    },
    push(arr: unknown[], v: unknown): void {
      arr.push(v);
    },
    pop(arr: unknown[]): unknown {
      if (arr.length === 0) {
        sd.fail("Error: pop on empty array");
      }
      return arr.pop();
    },
    sort(arr: unknown[], isText: boolean): void {
      for (let i = 1; i < arr.length; i++) {
        for (let j = i; j > 0; j--) {
          let c: number;
          if (isText) {
            const a = arr[j - 1] as string;
            const b = arr[j] as string;
            c = a < b ? -1 : a > b ? 1 : 0;
          } else {
            c = (arr[j - 1] as number) > (arr[j] as number) ? 1 : 0;
          }
          if (c <= 0) break;
          const w = arr[j];
          arr[j] = arr[j - 1];
          arr[j - 1] = w;
        }
      }
    },
    slice(arr: unknown[], a: number, b: number): unknown[] {
      if (a < 0 || b > arr.length || a > b) {
        sd.fail(`Error: slice out of bounds (${a}, ${b})`);
      }
      return arr.slice(a, b);
    },
    arrConcat(x: unknown[], y: unknown[]): unknown[] {
      return x.concat(y);
    },
    split(s: string, sep: string): string[] {
      if (sep.length === 0) {
        sd.fail("Error: split separator must not be empty");
      }
      // Mirror sd_split: scan for sep, push empty pieces too.
      const result: string[] = [];
      let cur = 0;
      for (;;) {
        const hit = s.indexOf(sep, cur);
        const len = hit === -1 ? s.length - cur : hit - cur;
        result.push(s.substr(cur, len));
        if (hit === -1) break;
        cur = hit + sep.length;
      }
      return result;
    },
    indexOf(arr: unknown[], v: unknown): number {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === v) return i;
      }
      return -1;
    },
    contains(arr: unknown[], v: unknown): number {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === v) return 1;
      }
      return 0;
    },
    idiv(a: number, b: number): number {
      return Math.trunc(a / b);
    },
    substring(s: string, start: number, end: number): string {
      if (start < 0 || end < start || end > s.length) {
        sd.silentExit();
      }
      return s.slice(start, end);
    },
    copy<T>(v: T): T {
      // Tuples are JS arrays; shallow copy restores C struct pass-by-value.
      if (Array.isArray(v)) return (v as unknown[]).slice() as unknown as T;
      return v;
    },
    snap<T>(v: T, isTuple: boolean): T {
      return isTuple ? sd.copy(v) : v;
    },
    ord(c: string): number {
      return c.charCodeAt(0);
    },
    chr(v: number): string {
      if (v < 0 || v > 255) {
        sd.fail(`Error: chr expects a character code between 0 and 255, got ${v}`);
      }
      return String.fromCharCode(v);
    },
    parseInt(s: string): number {
      // Mirror strtol base-10 with full-consumption + range checks.
      if (!/^\s*[+-]?[0-9]+$/.test(s)) {
        sd.fail(`Error: parse_int: invalid int '${s}'`);
      }
      const v = Number(s);
      if (v < -2147483648 || v > 2147483647) {
        sd.fail(`Error: parse_int: invalid int '${s}'`);
      }
      return v;
    },
    parseDecimal(s: string): number {
      if (!/^\s*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(s)) {
        sd.fail(`Error: parse_decimal: invalid decimal '${s}'`);
      }
      const v = Number(s);
      if (!isFinite(v)) {
        sd.fail(`Error: parse_decimal: invalid decimal '${s}'`);
      }
      return v;
    },
    nlBrk(m: object): never {
      throw { m, k: 1 } as NonLocal;
    },
    nlCont(m: object): never {
      throw { m, k: 2 } as NonLocal;
    },
    input(): string {
      return lineIdx < lines.length ? lines[lineIdx++] : "";
    },
  } as unknown as SDRuntime;

  Object.defineProperties(sd, {
    out: { get: () => out.join("") },
    err: { get: () => err.join("") },
  });

  return sd;
}