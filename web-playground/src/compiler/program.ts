// Compiler front door for the web playground.
//
// M1 stub: the real pipeline (lexer -> LALR parser -> resolver -> JS codegen)
// lands in M2-M4. `runProgram` keeps this signature stable so the UI never has
// to change when the compiler arrives:
//
//   runProgram(source, { stdin }) -> { stdout, stderr, exit }
//
// Semantics to match the native compiler (`build/hmx run`):
//   - `print(a, b, c)` -> one line, space-separated, trailing newline
//   - booleans print as `1` / `0`; decimals use C `%f` formatting
//   - a failing compile reports line-numbered errors on `stderr`, exit 1
//   - `fn main() -> int { return N }` yields exit N; void main exits 0

export interface RunInput {
  stdin?: string[]; // lines available to `input()`; empty => EOF
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exit: number;
}

/** The default source shown when the playground opens. */
export const DEFAULT_SOURCE = `fn main() {
    print("HMX in the browser")
    let total = (2 + 3) * 4
    print("sum:", total)
}`;

/**
 * Compile and run an HMX program.
 *
 * M1 stub: reports that the compiler is under construction while the ported
 * pipeline (M2-M4) replaces this. Real diag example returned once the lexer
 * lands.
 */
export function runProgram(source: string, input: RunInput = {}): RunResult {
  void input; // stdin wiring arrives with the runtime in M4
  return {
    stdout: "",
    stderr:
      "HMX web compiler is under construction (M1).\n" +
      "The ported pipeline lands in M2 (lexer+parser), M3 (resolver), M4 (JS backend).\n" +
      `Received ${source.length} character(s) of source.`,
    exit: 1,
  };
}