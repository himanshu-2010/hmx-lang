// Smoke test: parse + resolve all fixture programs; print first error per file.
import { readFileSync, readdirSync } from "node:fs";
import { parseHmx } from "../../src/compiler/parse";
import { TypeResolver } from "../../src/compiler/resolver";

const dir = new URL("../../../tests/fixtures", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".hmx"));
let ok = 0;
let fail = 0;
for (const f of files) {
  const source = readFileSync(`${dir}/${f}`, "utf8");
  const res = parseHmx(source);
  if (!res.ok) {
    console.log(`${f}: PARSE ERROR`);
    for (const e of res.stderr) console.log(`   ${e}`);
    fail++;
    continue;
  }
  let resolveErr: string | null = null;
  try {
    const r = new TypeResolver();
    r.resolve(res.program);
  } catch (e: any) {
    resolveErr = e?.message ?? String(e);
  }
  if (resolveErr) {
    console.log(`${f}: RESOLVE ERROR: ${resolveErr.trim()}`);
    fail++;
  } else {
    ok++;
  }
}
console.log(`\n== ${ok} resolved ok${fail ? `, ${fail} failed` : ""}`);