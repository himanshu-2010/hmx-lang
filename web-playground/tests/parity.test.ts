import { describe, expect, it } from "vitest";
import { runProgram, DEFAULT_SOURCE } from "../src/compiler/program";

// The parity contract (see PLAN.md §2.6): once the ported pipeline lands, this
// runner must execute the same 52 integration fixtures, 116 stress snippets,
// and 190 negative cases as the native compiler. M1 stub checks the surface.
describe("runProgram (M1 stub)", () => {
  it("accepts the default source without crashing", () => {
    const r = runProgram(DEFAULT_SOURCE);
    expect(r).toHaveProperty("stdout");
    expect(r).toHaveProperty("stderr");
    expect(r).toHaveProperty("exit");
  });

  it("reports a 1-line stderr and nonzero exit while the compiler is a stub", () => {
    const r = runProgram("fn main() { print(\"hi\") }");
    expect(r.exit).toBe(1);
    expect(r.stderr).toContain("under construction");
  });
});