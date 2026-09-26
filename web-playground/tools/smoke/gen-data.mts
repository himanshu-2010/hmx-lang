// Parity data generator.
//
// Extracts the three native suites (tests/run_integration.sh,
// tests/run_negative_tests.sh, tests/run_stress_tests.sh) into machine-readable
// cases, then snapshots what `build/hmx` produces for each one ({stdout,stderr,
// exit}) so the vitest gate (tests/parity.test.ts) can assert runProgram()
// *verbatim-identical* parity without needing a C toolchain at test time.
//
// Module cases are run natively with a *relative* entry argv (cwd = module dir)
// so path-bearing diagnostics match the canonical paths the web module loader
// produces (e.g. "lib/err.hmx:4").
//
// Usage: npx vite-node web-playground/tools/smoke/gen-data.mts   (from hmx-lang/)

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runProgram } from "../../src/compiler/program";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", ".."); // hmx-lang/
const BIN = join(root, "build", "hmx");
const dataDir = join(root, "web-playground", "tests", "data");
const snapDir = "/tmp/hmx_web_snapshot";

// ---------------------------------------------------------------------------
// Bash argument tokenizer (covers the quoting actually used in the suites:
// single/double quotes, adjacent concat, $'...' ANSI-C, $(printf ...)).
// ---------------------------------------------------------------------------

const isSpace = (c: string) => c === " " || c === "\t" || c === "\r";

function findMatchingParen(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unterminated $( )");
}

function ansiEscape(ch: string): string {
  switch (ch) {
    case "n": return "\n";
    case "t": return "\t";
    case "r": return "\r";
    case "\\": return "\\";
    case "'": return "'";
    case "0": return "\0";
    default: return "\\" + ch;
  }
}

/** Evaluate `$(printf 'fmt')` style substitutions (only form used in suites). */
function evalSubshell(cmd: string): string {
  const t = cmd.trim();
  const m =
    /^printf\s+--\s+((?:'[^']*'|"[^"]*"))$/.exec(t) ??
    /^printf\s+((?:'[^']*'|"[^"]*"))$/.exec(t);
  if (!m) {
    // Script-level words (e.g. `cd "$(dirname "$0")/.."`) are never part of a
    // test call; keep the text verbatim so tokenizing can proceed.
    return "$(" + cmd + ")";
  }
  const q = m[1];
  const isDq = q[0] === '"';
  let literal = q.slice(1, -1);
  if (isDq) literal = literal.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  // printf interprets \n in its format; bash `$(...)` strips trailing newlines.
  return literal
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\")
    .replace(/\n+$/, "");
}

interface Word {
  value: string;
  endLine: boolean;
}

function bashWords(src: string): Word[] {
  const words: Word[] = [];
  let i = 0;
  const n = src.length;

  const parseWord = (start: number): { value: string; i: number } => {
    let value = "";
    let i = start;
    for (;;) {
      if (i >= n) return { value, i };
      const c = src[i];
      if (c === "'") {
        i++;
        const begin = i;
        while (i < n && src[i] !== "'") i++;
        value += src.slice(begin, i);
        if (i < n) i++; // closing quote
        continue;
      }
      if (c === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          const ch = src[i];
          if (ch === '"') {
            i++;
            break;
          }
          if (ch === "\\") {
            const nx = src[i + 1];
            if (nx === '"' || nx === "\\" || nx === "$") {
              value += nx;
              i += 2;
            } else {
              value += "\\";
              i++;
            }
            continue;
          }
          if (ch === "$" && src[i + 1] === "(") {
            const end = findMatchingParen(src, i + 1);
            value += evalSubshell(src.slice(i + 2, end));
            i = end + 1;
            continue;
          }
          value += ch;
          i++;
        }
        continue;
      }
      if (c === "$" && src[i + 1] === "'") {
        i += 2;
        for (;;) {
          if (i >= n) break;
          const ch = src[i];
          if (ch === "'") {
            i++;
            break;
          }
          if (ch === "\\") {
            value += ansiEscape(src[i + 1]);
            i += 2;
            continue;
          }
          value += ch;
          i++;
        }
        continue;
      }
      // bare fragment merges with a following quoted fragment (bash concat)
      if (c === "\\" && src[i + 1] === "'") {
        // `\''` idiom: escaped quote outside quotes yields a literal single quote
        value += "'";
        i += 2;
        continue;
      }
      const begin = i;
      while (
        i < n &&
        !isSpace(src[i]) &&
        src[i] !== "\n" &&
        src[i] !== "'" &&
        src[i] !== '"'
      ) {
        i++;
      }
      value += src.slice(begin, i);
      if (i < n && (src[i] === "'" || src[i] === '"')) continue;
      return { value, i };
    }
  };

  while (i < n) {
    if (isSpace(src[i])) {
      i++;
      continue;
    }
    if (src[i] === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "\n") {
      i++;
      continue;
    }
    const w = parseWord(i);
    i = w.i;
    // Determine the delimiter that terminated the word.
    let k = i;
    while (k < n && isSpace(src[k])) k++;
    let endLine = false;
    if (src[k] === "\\" && src[k + 1] === "\n") {
      // backslash-newline: command continues
      i = k + 2;
    } else if (src[k] === "\n") {
      endLine = true;
      i = k + 1;
    } else {
      i = k;
    }
    words.push({ value: w.value, endLine });
  }
  return words;
}

interface RawCall {
  name: string;
  args: string[];
}

function parseCalls(file: string): RawCall[] {
  const src = readFileSync(file, "utf8");
  const words = bashWords(src);
  const calls: RawCall[] = [];
  let i = 0;
  const isCallName = (w: string) => /^test_[a-z_]+$/.test(w);
  while (i < words.length) {
    if (!isCallName(words[i].value)) {
      i++;
      continue;
    }
    const name = words[i].value;
    const args: string[] = [];
    i++;
    while (i < words.length) {
      const w = words[i];
      args.push(w.value);
      i++;
      if (w.endLine) break;
    }
    calls.push({ name, args });
  }
  return calls;
}

// ---------------------------------------------------------------------------
// Shared case shape
// ---------------------------------------------------------------------------

interface SuiteCase {
  name: string;
  kind:
    | "output"
    | "exit"
    | "input_output"
    | "module_output"
    | "module_exit"
    | "fixture"
    | "module"
    | "negative"
    | "module_negative";
  source: string | null;
  stdin: string | null;
  entry: string | null;
  modules: Record<string, string> | null;
  pattern: string | null;
}

function modulePairs(args: string[], start: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let k = start; k + 1 < args.length; k += 2) files[args[k]] = args[k + 1];
  return files;
}

function parseStress(): SuiteCase[] {
  const cases: SuiteCase[] = [];
  for (const c of parseCalls(join(root, "tests", "run_stress_tests.sh"))) {
    if (c.name === "test_exit_code") {
      cases.push({
        name: c.args[0], kind: "exit", source: c.args[1], stdin: null,
        entry: null, modules: null, pattern: null,
      });
    } else if (c.name === "test_output") {
      cases.push({
        name: c.args[0], kind: "output", source: c.args[1], stdin: null,
        entry: null, modules: null, pattern: null,
      });
    } else if (c.name === "test_output_with_input") {
      cases.push({
        name: c.args[0], kind: "input_output", source: c.args[1],
        stdin: c.args[2], entry: null, modules: null, pattern: null,
      });
    } else if (c.name === "test_module_output" || c.name === "test_module_exit_code") {
      cases.push({
        name: c.args[0],
        kind: c.name === "test_module_output" ? "module_output" : "module_exit",
        source: null, stdin: null, entry: c.args[1],
        modules: modulePairs(c.args, 3), pattern: null,
      });
    }
  }
  return cases;
}

function parseNegative(): SuiteCase[] {
  const cases: SuiteCase[] = [];
  for (const c of parseCalls(join(root, "tests", "run_negative_tests.sh"))) {
    if (c.name === "test_error") {
      cases.push({
        name: c.args[0], kind: "negative", source: c.args[1], stdin: null,
        entry: null, modules: null, pattern: c.args[2],
      });
    } else if (c.name === "test_error_module") {
      cases.push({
        name: c.args[0], kind: "module_negative", source: null, stdin: null,
        entry: c.args[1], modules: modulePairs(c.args, 3), pattern: c.args[2],
      });
    }
  }
  return cases;
}

function parseModuleIntegration(): SuiteCase[] {
  const cases: SuiteCase[] = [];
  for (const c of parseCalls(join(root, "tests", "run_integration.sh"))) {
    if (c.name === "test_module") {
      cases.push({
        name: c.args[0], kind: "module", source: null, stdin: null,
        entry: c.args[1], modules: modulePairs(c.args, 2), pattern: null,
      });
    }
  }
  return cases;
}

function parseFixtures(): SuiteCase[] {
  const dir = join(root, "tests", "fixtures");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".hmx"))
    .sort()
    .map((f) => ({
      name: f.slice(0, -4),
      kind: "fixture" as const,
      source: readFileSync(join(dir, f), "utf8"),
      stdin: null,
      entry: null,
      modules: null,
      pattern: null,
    }));
}

// ---------------------------------------------------------------------------
// Native snapshot + stale-sh-expected cross-checks
// ---------------------------------------------------------------------------

interface Snapshot {
  stdout: string;
  stderr: string;
  exit: number;
}

function runNative(sc: SuiteCase): Snapshot {
  const dir = `${snapDir}/${sc.name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const stdin = sc.stdin ?? undefined;
  if (sc.modules) {
    for (const [path, content] of Object.entries(sc.modules)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  } else if (sc.source !== null) {
    writeFileSync(join(dir, `${sc.name}.hmx`), sc.source);
  }
  const file = sc.entry ?? (sc.source !== null ? `${sc.name}.hmx` : null);
  const res = spawnSync(BIN, ["run", file!], {
    cwd: dir,
    input: stdin,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    exit: res.status ?? 1,
  };
}

function runWeb(sc: SuiteCase): Snapshot {
  if (sc.modules && sc.entry) {
    return runProgram(sc.modules[sc.entry], {
      modules: sc.modules,
      entryPath: sc.entry,
    });
  }
  return runProgram(sc.source!, { stdin: sc.stdin ?? [] });
}

/** Re-check the .sh expectations against the native snapshot (dimension kept honest). */
function checkShExpectations(sc: SuiteCase, native: Snapshot, shExpected: string | number | null) {
  if (shExpected === null) return null;
  if (sc.kind === "exit" || sc.kind === "module_exit") {
    return native.exit === shExpected ? null : `exit ${native.exit}, expected ${shExpected}`;
  }
  // output / input_output / module_output: merged output, newline-stripped
  const merged = (native.stdout + native.stderr).replace(/\n+$/, "");
  return merged === shExpected ? null : `stdout ${JSON.stringify(merged)}, expected ${JSON.stringify(shExpected as string)}`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface GenResult {
  suite: string;
  cases: SuiteCase[];
}

const suites: GenResult[] = [
  { suite: "stress", cases: parseStress() },
  { suite: "negative", cases: parseNegative() },
  {
    suite: "integration",
    cases: [...parseFixtures(), ...parseModuleIntegration()],
  },
];

if (process.argv.includes("--dump")) {
  for (const { suite, cases } of suites) {
    console.log(`==== ${suite} (${cases.length})`);
    for (const c of cases) {
      console.log(`  ${c.kind} ${c.name} entry=${c.entry}`);
      if (c.modules) console.log(`      modules=${JSON.stringify(Object.keys(c.modules))}`);
      if (c.pattern) console.log(`      pattern=${c.pattern}`);
    }
  }
  process.exit(0);
}

const failures: string[] = [];
const totals: Record<string, { run: number; fail: number; shWarn: number }> = {};

for (const { suite, cases } of suites) {
  const out: Array<SuiteCase & { expected: Snapshot }> = [];
  for (const sc of cases) {
    const t = (totals[suite] ??= { run: 0, fail: 0, shWarn: 0 });
    t.run++;

    let native: Snapshot;
    let web: Snapshot;
    try {
      native = runNative(sc);
      web = runWeb(sc);
    } catch (e) {
      console.error(`EXCEPTION during [${suite}/${sc.name}] (kind=${sc.kind}):`, e);
      throw e;
    }

    // expected from the .sh (for output/module_output tests it's the merged text)
    let shExpected: string | number | null = null;
    if (sc.kind === "exit") {
      const call = parseCalls(join(root, "tests", "run_stress_tests.sh")).find((c) => c.args[0] === sc.name);
      shExpected = call ? Number(call.args[2]) : null;
    } else if (sc.kind === "module_exit") {
      shExpected = numberForModuleExit(sc.name);
    } else if (sc.kind === "output" || sc.kind === "input_output" || sc.kind === "module_output") {
      shExpected = expectedTextFor(suite, sc.name);
    }
    // Native embeds absolute temp paths (`weakly_canonical`) in diagnostics; the
    // web loader uses entry-relative canonical paths. Strip the per-case snapshot
    // dir so both sides agree on the *relative* module path — the parity contract
    // documented on the data files.
    const dirPrefix = `${snapDir}/${sc.name}/`;
    const nativeNorm: Snapshot = {
      ...native,
      stderr: native.stderr.split(dirPrefix).join(""),
    };

    const shErr = checkShExpectations(sc, native, shExpected);
    if (shErr) {
      t.shWarn++;
      failures.push(`[${suite}/${sc.name}] .sh expectation mismatch: ${shErr}`);
    }

    const ok =
      web.stdout === nativeNorm.stdout &&
      web.stderr === nativeNorm.stderr &&
      web.exit === nativeNorm.exit;
    if (!ok) {
      t.fail++;
      failures.push(
        `[${suite}/${sc.name}] web != native\n  web  exit=${web.exit} stdout=${JSON.stringify(web.stdout)} stderr=${JSON.stringify(web.stderr)}\n  nat  exit=${nativeNorm.exit} stdout=${JSON.stringify(nativeNorm.stdout)} stderr=${JSON.stringify(nativeNorm.stderr)}\n` +
          (sc.pattern ? `  pattern=${sc.pattern}\n` : "")
      );
    }

    out.push({ ...sc, expected: nativeNorm });
  }

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, `${suite}.json`),
    JSON.stringify(
      {
        "_comment": `Auto-generated from tests/run_${suite === "integration" ? "integration" : suite === "stress" ? "stress_tests" : "negative_tests"}.sh + build/hmx snapshot by web-playground/tools/smoke/gen-data.mts. parity.test.ts asserts runProgram() matches 'expected' verbatim.`,
        cases: out,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `${suite}: ${out.length} cases, ${totals[suite].fail} web-vs-native failures, ${totals[suite].shWarn} sh-expectation warnings`
  );
}

function expectedTextFor(suite: string, name: string): string | null {
  const path = join(root, "tests", suite === "stress" ? "run_stress_tests.sh" : "run_integration.sh");
  for (const c of parseCalls(path)) {
    if (c.args[0] !== name) continue;
    if (c.name === "test_output" || c.name === "test_output_with_input") {
      return c.name === "test_output_with_input" ? c.args[3] : c.args[2];
    }
    if (c.name === "test_module_output") return c.args[2];
  }
  return null;
}

function numberForModuleExit(name: string): number | null {
  for (const c of parseCalls(join(root, "tests", "run_stress_tests.sh"))) {
    if (c.name === "test_module_exit_code" && c.args[0] === name) return Number(c.args[2]);
  }
  return null;
}

console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} issue(s):`);
  console.log(failures.join("\n"));
  console.log("");
  process.exitCode = 1;
} else {
  console.log("ALL WEB RESULTS MATCH THE NATIVE SNAPSHOT VERBATIM.");
}