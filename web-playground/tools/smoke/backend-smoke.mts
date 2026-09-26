// Backend smoke: run every fixture through the web compiler (parse -> resolve
// -> JS codegen -> SD runtime) and diff stdout/stderr/exit against the native
// `build/hmx run` binary.
//
// Usage (from hmx-lang/):
//   npx vite-node web-playground/tools/smoke/backend-smoke.mts
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runProgram } from "../../src/compiler/program";

const dir = new URL("../../../tests/fixtures", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".hmx"));
const BIN = new URL("../../../build/hmx", import.meta.url).pathname;

let ok = 0;
let fail = 0;
const failures: string[] = [];

for (const f of files) {
  const path = `${dir}/${f}`;
  const source = readFileSync(path, "utf8");

  let nOut = "";
  let nErr = "";
  let nExit = -1;
  try {
    const r = execFileSync(BIN, ["run", path], { encoding: "utf8" });
    nOut = r;
    nExit = 0;
  } catch (e: any) {
    nOut = e?.stdout ?? "";
    nErr = e?.stderr ?? "";
    nExit = e?.status ?? -1;
  }

  const w = runProgram(source, { entryPath: f });

  const sameOut = w.stdout === nOut;
  const sameErr = w.stderr === nErr;
  const sameExit = w.exit === nExit ? true : !(w.exit === 1 && nExit === 1) && w.exit === nExit;
  if (w.exit === nExit && sameOut && sameErr) {
    ok++;
  } else {
    fail++;
    failures.push(
      `${f}: exit ${w.exit} vs ${nExit}${!sameOut ? ` | stdout:\n  web: ${JSON.stringify(w.stdout.slice(0, 200))}\n  nat: ${JSON.stringify(nOut.slice(0, 200))}` : ""}${
        !sameErr ? ` | stderr:\n  web: ${JSON.stringify(w.stderr.slice(0, 200))}\n  nat: ${JSON.stringify(nErr.slice(0, 200))}` : ""
      }`
    );
  }
}

for (const fl of failures) console.log(`FAIL ${fl}\n`);
console.log(`\n== ${ok}/${files.length} byte-identical, ${fail} divergent`);