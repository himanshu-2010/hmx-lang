// Validates every code example in web-playground/src/docs.ts against the
// native HMX compiler. Ensures docs never ship a broken or dishonest example.
//
// Usage (from hmx-lang/):
//   node web-playground/tools/validate_docs.mjs
//
// Requires the native build: cmake --build build
// Requires Node >= 23.6 (type stripping) to import the .ts data file.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const HMX = join(root, "build/hmx");

const { docsData } = await import("../src/docs.ts");

function runExample(example, label) {
  const dir = mkdtempSync(join(tmpdir(), "hmx-doc-"));
  const entry = join(dir, "entry.hmx");
  writeFileSync(entry, example.code);

  if (example.moduleFiles) {
    for (const [path, content] of Object.entries(example.moduleFiles)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }

  let ok = true;
  let detail = "";
  try {
    const out = execFileSync(HMX, ["run", entry], { cwd: dir, encoding: "utf8" });
    if ((example.exit ?? 0) !== 0) {
      ok = false;
      detail = `expected exit ${example.exit}, but program ran cleanly (exit 0)`;
    } else {
      const got = out.replace(/\s+$/, "");
      const want = (example.expected ?? "").replace(/\s+$/, "");
      if (got !== want) {
        ok = false;
        detail = `stdout mismatch:\n  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`;
      }
    }
  } catch (err) {
    const status = err.status ?? "?";
    if (status === (example.exit ?? 0) && (example.exit ?? 0) !== 0) {
      // Expected non-zero exit: OK, as long as it was an exit-code (not a
      // compile failure we mislabeled). Distinguish: status 1 with a
      // "gcc compilation failed" / parse error means the program did not run.
      const stderr = String(err.stderr ?? err.message);
      if (/gcc compilation failed|compilation failed|parsing failed|Parse error|type mismatch|Error \[/.test(stderr)) {
        ok = false;
        detail = `exit ${status} but looks like a compile failure, not an exit code:\n${stderr}`;
      }
    } else {
      ok = false;
      detail = `exit ${status} (expected ${example.exit ?? 0})\n${String(err.stderr ?? err.message)}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok, detail, label };
}

let passed = 0;
let failed = 0;
const failures = [];

for (const section of docsData) {
  for (const item of section.items) {
    for (const example of item.examples) {
      const label = `${section.id} / ${item.id} / ${example.name}`;
      const { ok, detail } = runExample(example, label);
      if (ok) {
        passed++;
        console.log(`  ok    ${label}`);
      } else {
        failed++;
        failures.push({ label, detail });
        console.log(`  FAIL  ${label}`);
        console.log(`        ${detail.replace(/\n/g, "\n        ")}`);
      }
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}