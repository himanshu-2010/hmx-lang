// LALR(1) driver — a faithful port of the bison 3.8.2 skeleton (yybackup /
// yydefault / yyreduce / yyerrlab / yyerrlab1), driven by the exact tables
// extracted from build/parser.cpp (web-playground/src/compiler/tables/tables.json).
//
// There are no error productions in the grammar, so any syntax error prints a
// single "Parse error" line (via the onError callback) and aborts with
// failure — matching the native behavior of returning 1 from yyparse.

import tables from "./tables/tables.json";
import type { LexToken } from "./lexer";

const {
  yypact,
  yydefact,
  yytable,
  yycheck,
  yypgoto,
  yydefgoto,
  yytranslate,
  yyr1,
  yyr2,
  constants,
} = tables;

const YYEMPTY = -2;
const YYEOF = 0;
const YYerror = 256;
const YYFINAL = constants.YYFINAL as number;
const YYPACT_NINF = constants.YYPACT_NINF as number;
const YYTABLE_NINF = -1 as number;
const YYLAST = constants.YYLAST as number;
const YYNTOKENS = constants.YYNTOKENS as number;
const YYSYMBOL_YYerror = 1 as number;

/** Context shared with actions: mirrors the globals yylineno / yytext. */
export interface LRContext {
  line: number;
  text: string;
}

export interface ParseOutcome {
  ok: boolean;
  /** the reduced `program` value (null on failure) */
  program: unknown;
}

/**
 * Run the LALR parse.
 *
 * @param nextToken  tokenizer; each call returns the next LexToken
 * @param action     semantic action: (rule, rhs, ctx) => yyval. Rule numbers
 *                   are the bison rule indices (0..156); RHS values are the
 *                   semantic values of symbols 1..n (rhs[0] == $1).
 * @param onSyntaxError callback invoked where bison calls yyerror("syntax error")
 */
export function lrParse(
  nextToken: () => LexToken,
  action: (rule: number, rhs: unknown[], ctx: LRContext) => unknown,
  onSyntaxError: (ctx: LRContext) => void
): ParseOutcome {
  const IN_PROGRESS = Symbol("in-progress");
  const FAIL: ParseOutcome = { ok: false, program: null };

  const states: number[] = [0];
  const values: unknown[] = [null]; // dummy yyval for the initial state
  let yychar = YYEMPTY;
  let yystate = 0;
  let yyerrstatus = 0;
  let current: LexToken = { code: 0, value: null, text: "", line: 1 };
  const ctx: LRContext = { line: 1, text: "" };

  const readToken = (): void => {
    current = nextToken();
    ctx.line = current.line;
    ctx.text = current.text;
    yychar = current.code;
  };

  // bison yyerrlab1: pop states until one shifts the error token; with no
  // error productions this always pops to empty and aborts.
  const errlab1 = (): ParseOutcome | typeof IN_PROGRESS => {
    yyerrstatus = 3;
    let eyyn = 0;
    for (;;) {
      eyyn = yypact[yystate] as number;
      if (eyyn !== YYPACT_NINF) {
        eyyn += YYSYMBOL_YYerror;
        if (0 <= eyyn && eyyn <= YYLAST && (yycheck[eyyn] as number) === YYSYMBOL_YYerror) {
          const shiftTo = yytable[eyyn] as number;
          if (shiftTo > 0) {
            yystate = shiftTo;
            states.push(yystate);
            values.push(null);
            yychar = YYEMPTY;
            return yystate === YYFINAL
              ? { ok: true, program: values[values.length - 1] }
              : IN_PROGRESS;
          }
        }
      }
      if (states.length === 1) return FAIL; // bison: YYABORT at stack bottom
      states.pop();
      values.pop();
      yystate = states[states.length - 1];
    }
  };

  // bison yyerrlab. Returns FAIL (abort) or IN_PROGRESS (continue loop).
  const errlab = (): ParseOutcome | typeof IN_PROGRESS => {
    if (!yyerrstatus) onSyntaxError(ctx);
    if (yyerrstatus === 3) {
      if (yychar <= YYEOF) {
        if (yychar === YYEOF) return FAIL;
      } else {
        yychar = YYEMPTY; // discard the lookahead
      }
    }
    return errlab1();
  };

  // bison yyreduce epilogue: pop yylen, push yyval, goto-compute the state.
  // Returns a final outcome only when a reduction lands on YYFINAL; otherwise
  // undefined signals "continue the main loop" (never IN_PROGRESS).
  const reduce = (rule: number): ParseOutcome | undefined => {
    const len = yyr2[rule] as number;
    const rhs = len > 0 ? values.slice(-len) : [];
    if (len > 0) {
      values.length -= len;
      states.length -= len;
    }
    const val = action(rule, rhs, ctx);
    values.push(val);
    const yylhs = (yyr1[rule] as number) - YYNTOKENS;
    const yyi = (yypgoto[yylhs] as number) + states[states.length - 1];
    yystate =
      0 <= yyi && yyi <= YYLAST && (yycheck[yyi] as number) === states[states.length - 1]
        ? (yytable[yyi] as number)
        : (yydefgoto[yylhs] as number);
    states.push(yystate);
    if (yystate === YYFINAL) return { ok: true, program: values[values.length - 1] };
    return undefined; // continue the main loop
  };

  for (;;) {
    // ---- yybackup ----
    let yyn = yypact[yystate] as number;
    if (yyn !== YYPACT_NINF) {
      if (yychar === YYEMPTY) readToken();

      let yytoken: number;
      if (yychar <= YYEOF) {
        yychar = YYEOF;
        yytoken = 0;
      } else if (yychar === YYerror) {
        // The scanner reported an error token already; recover directly.
        const r = errlab1();
        if (r !== IN_PROGRESS) return r;
        continue;
      } else {
        yytoken = yytranslate[yychar] as number;
      }

      yyn += yytoken;
      if (yyn < 0 || yyn > YYLAST || (yycheck[yyn] as number) !== yytoken) {
        // ---- yydefault ----
        let defRule = yydefact[yystate] as number;
        if (defRule === 0) {
          const r = errlab();
          if (r !== IN_PROGRESS) return r;
          continue;
        }
        const r = reduce(defRule);
        if (r !== undefined) return r;
        continue;
      }

      yyn = yytable[yyn] as number;
      if (yyn <= 0) {
        if (yyn === YYTABLE_NINF) {
          const r = errlab();
          if (r !== IN_PROGRESS) return r;
          continue;
        }
        // yyn < 0 => reduce rule -yyn
        const r = reduce(-yyn);
        if (r !== undefined) return r;
        continue;
      }

      // ---- shift ----
      if (yyerrstatus) yyerrstatus--;
      yystate = yyn;
      values.push(current.value);
      states.push(yystate);
      yychar = YYEMPTY;
      if (yystate === YYFINAL) return { ok: true, program: values[values.length - 1] };
      continue;
    }

    // ---- yydefault ----
    let defRule = yydefact[yystate] as number;
    if (defRule === 0) {
      const r = errlab();
      if (r !== IN_PROGRESS) return r;
      continue;
    }
    const r = reduce(defRule);
    if (r !== undefined) return r;
  }
}