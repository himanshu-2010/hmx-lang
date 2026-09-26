// Compiler front door for the web playground. Mirrors the native `run` flow
// (main.cpp): parse the entry file, expand `use` modules, type-resolve, then
// generate+execute JS against the in-browser SD runtime.
//
//   runProgram(source, { stdin, modules, entryPath }) -> { stdout, stderr, exit }
//
// stderr carries compiler diagnostics AND runtime errors exactly as the CLI
// merges them onto its stderr stream; `exit` mirrors the process exit code.

import { parseHmx } from "./parse";
import { TypeResolver, type CompileError } from "./resolver";
import { CodeGenJs } from "./codegen_js";
import { executeJs } from "./vm";
import {
  FunctionDecl,
  IfStmt,
  SwitchStmt,
  LoopStmt,
  ForeachStmt,
  WhileStmt,
  ForStmt,
  DoWhileStmt,
  type Program,
  type Statement,
} from "./ast";

export interface RunInput {
  stdin?: string[]; // lines available to `input()`; empty => EOF
  /** module sources keyed by canonical path; base_dir = dir of entry file */
  modules?: Record<string, string>;
  /** entry file path (default "" = the UI's anonymous source) */
  entryPath?: string;
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

// ---- virtual path helpers (weakly_canonical for the in-memory module map) --

function dirOf(path: string): string {
  const pos = path.lastIndexOf("/");
  return pos === -1 ? "." : path.slice(0, pos);
}

/** Resolve `.` and `..` segments; a leading `/` is treated as anchored. */
function normalizePath(p: string): string {
  const stack: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function joinPath(baseDir: string, p: string): string {
  if (baseDir === "" || baseDir === ".") return p;
  return `${baseDir}/${p}`;
}

// ---- mirror assign_file() from main.cpp: stamp file onto a fn + descendants -

function stampFile(stmt: Statement, file: string): void {
  const recurse = (list: Statement[]): void => {
    for (const s of list) stampFile(s, file);
  };
  if (stmt instanceof FunctionDecl) {
    if (stmt.file.length === 0) stmt.file = file;
    recurse(stmt.body);
  } else if (stmt instanceof IfStmt) {
    recurse(stmt.then_body);
    recurse(stmt.else_body);
  } else if (stmt instanceof SwitchStmt) {
    for (const c of stmt.cases) recurse(c.body);
  } else if (stmt instanceof LoopStmt) {
    recurse(stmt.body);
  } else if (stmt instanceof ForeachStmt) {
    recurse(stmt.body);
  } else if (stmt instanceof WhileStmt) {
    recurse(stmt.body);
  } else if (stmt instanceof ForStmt) {
    recurse(stmt.body);
  } else if (stmt instanceof DoWhileStmt) {
    recurse(stmt.body);
  }
}

/**
 * Expand `use` list recursively into the program. Returns an error message
 * (already prefixed) or null on success. Mirrors load_module_uses() in
 * main.cpp: ext check -> cycle check -> loaded-skip -> exists -> parse, and
 * only FunctionDecl statements are merged (lambdas and top-level code of a
 * module are ignored, matching the native behavior).
 */
function loadUses(
  program: Program,
  baseDir: string,
  loaded: Set<string>,
  visiting: Set<string>,
  modules: Record<string, string>
): string | null {
  for (const raw of program.use_files) {
    const joined = raw.startsWith("/") ? raw : joinPath(baseDir, raw);
    const canon = normalizePath(joined);
    if (!canon.endsWith(".hmx")) {
      return `Error: module '${raw}' must be a .hmx file`;
    }
    if (visiting.has(canon)) {
      return `Error: circular module dependency involving '${canon}'`;
    }
    if (loaded.has(canon)) continue;
    const source = modules[canon];
    if (source === undefined) {
      return `Error: cannot open module '${canon}'`;
    }
    const mod = parseHmx(source);
    if (!mod.ok) {
      // Native parse_file prints the lexer/parser detail lines, then the caller
      // emits `Error: parsing failed in module '<canon>'`.
      return mod.stderr.join("") + `Error: parsing failed in module '${canon}'`;
    }
    visiting.add(canon);
    const inner = loadUses(mod.program!, dirOf(canon), loaded, visiting, modules);
    visiting.delete(canon);
    if (inner !== null) return inner;
    for (const stmt of mod.program!.statements) {
      if (stmt instanceof FunctionDecl) {
        stampFile(stmt, canon);
        program.statements.push(stmt);
      }
    }
    loaded.add(canon);
  }
  return null;
}

/**
 * Compile and run an HMX program.
 *
 * Mirrors `hmx run` end-to-end; a failing compile reports the native
 * diagnostics on `stderr` with exit 1, and `fn main() -> int { return N }`
 * propagates N as the exit code.
 */
export function runProgram(source: string, input: RunInput = {}): RunResult {
  const entryPath = input.entryPath ?? "";
  const modules = input.modules ?? {};

  const parsed = parseHmx(source);
  if (!parsed.ok) {
    return {
      stdout: "",
      stderr: parsed.stderr.join("") + "Error: parsing failed\n",
      exit: 1,
    };
  }

  const program = parsed.program!;
  program.source_file = entryPath;
  if (entryPath.length > 0) {
    for (const stmt of program.statements) {
      if (stmt instanceof FunctionDecl) stampFile(stmt, entryPath);
    }
  }

  const moduleErr = loadUses(
    program,
    dirOf(entryPath),
    new Set(),
    // main.cpp seeds `visiting` with the entry's canonical path so a module that
    // `use`s the entry back-edge reports a cycle against the entry itself.
    entryPath.length > 0 ? new Set([normalizePath(entryPath)]) : new Set(),
    modules
  );
  if (moduleErr !== null) {
    return { stdout: "", stderr: moduleErr + "\n", exit: 1 };
  }

  try {
    new TypeResolver().resolve(program);
  } catch (e) {
    if (e instanceof Error && (e as CompileError).file !== undefined) {
      return { stdout: "", stderr: e.message + "\n", exit: 1 };
    }
    throw e;
  }

  let js: string;
  try {
    js = new CodeGenJs().generate(program);
  } catch (e) {
    // Native would have failed the C compile; report as a compile failure.
    const msg = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: msg + "\n", exit: 1 };
  }

  return executeJs(js, input.stdin ?? []);
}