// Execution glue: compile the emitted JS into a function bound to a fresh SD
// runtime and collect { stdout, stderr, exit }.
//
// The generated source is a function BODY (a statement list that returns the
// exit code), so we build it with `new Function("SD", src)` and call it once.
// `ExitSignal` unwinds stack frames for runtime failures (the JS twin of
// `exit(1)`), including the silent substring out-of-bounds case.

import { createRuntime, ExitSignal } from "./runtime";

export interface VmResult {
  stdout: string;
  stderr: string;
  exit: number;
}

/**
 * Execute emitted JS with the given stdin. All output is captured into the
 * returned strings, exactly as the CLI captures stdout/stderr.
 */
export function executeJs(src: string, stdin: string | string[]): VmResult {
  const SD = createRuntime(stdin);
  let exit = 0;
  try {
    const fn = new Function("SD", src) as (sd: unknown) => unknown;
    const rc = fn(SD);
    if (typeof rc === "number") exit = rc;
  } catch (err) {
    if (err instanceof ExitSignal) {
      exit = err.code;
    } else {
      // A genuine JS failure (e.g. the emitter caveats that are native *compile*
      // failures too). Report it without crashing the host.
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      SD.error(`Error: runtime failure (${msg})`);
      exit = 1;
    }
  }
  return { stdout: SD.out, stderr: SD.err, exit };
}