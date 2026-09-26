// Orchestrates lexer -> LALR parser -> actions into an AST Program.
// Mirrors main.cpp parse_file(): each parse starts at line 1 and collects
// diagnostics in emission order (lexer messages first, then parse errors).

import { Lexer } from "./lexer";
import { lrParse } from "./lalr";
import { actionForRule } from "./actions";
import type { Program } from "./ast";

export interface ParseResult {
  ok: boolean;
  program: Program | null;
  /** stderr lines in emission order, each with a trailing newline */
  stderr: string[];
}

export function parseHmx(source: string): ParseResult {
  const diags: string[] = [];
  const emit = (msg: string): void => {
    diags.push(msg);
  };
  const lexer = new Lexer(source, emit);
  // Native recovers the Program from the g_program global set by rule 2
  // (program: use_list stmt_list); bison's accept itself fires on reaching
  // YYFINAL by shifting EOF, so rule 1 never reduces. Mirror that.
  let captured: Program | null = null;
  const outcome = lrParse(
    () => lexer.next(),
    (rule, rhs, ctx) => {
      const val = actionForRule(rule)(rhs, ctx);
      if (rule === 2) captured = val as Program;
      return val;
    },
    (ctx) => {
      emit(`Parse error [line ${ctx.line}]: syntax error near '${ctx.text}'\n`);
    }
  );
  return {
    ok: outcome.ok,
    program: outcome.ok ? captured : null,
    stderr: diags,
  };
}