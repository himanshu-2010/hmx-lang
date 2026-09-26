import { readFileSync } from "node:fs";
import { runProgram } from "../../src/compiler/program";

const dir = new URL("../../../tests/fixtures", import.meta.url).pathname;
for (const f of ["destructure_nested.hmx", "tuple_dynamic_index.hmx"]) {
  const source = readFileSync(`${dir}/${f}`, "utf8");
  console.log(`==== ${f}`);
  try {
    const r = runProgram(source, { entryPath: f });
    console.log(JSON.stringify(r, null, 1));
  } catch (e: any) {
    console.log("THREW:", e?.stack ?? String(e));
  }
}