// Semantic actions for the LALR parser — a 1:1 port of the grammar actions in
// parser.y. Rule indices match bison's numbering (rule 0 = dummy, rule 1 =
// $accept, rules 2..156 = the grammar). `rules` is big (156 entries) so the
// table is verified at load time against tables.json (lhs name + RHS length).

import {
  ArrayIndexExpr,
  ArrayLiteral,
  ArrayAssignStmt,
  AssignStmt,
  BinaryExpr,
  BoolLiteral,
  BreakStmt,
  CallExpr,
  CastExpr,
  CharLiteral,
  ConditionalExpr,
  ContinueStmt,
  DecimalLiteral,
  DestructDecl,
  DoWhileStmt,
  ElementAssignStmt,
  ExprKind,
  ExprStmt,
  ForeachStmt,
  ForStmt,
  FunctionDecl,
  Identifier,
  IfStmt,
  LambdaExpr,
  LoopStmt,
  MultiAssignStmt,
  NegExpr,
  NotExpr,
  NumberLiteral,
  PrintStmt,
  ReturnStmt,
  StringLiteral,
  SwitchStmt,
  TupleLiteral,
  TypeKind,
  VarDecl,
  WhileStmt,
  arrayOf,
  emptyTypeDesc,
  mkParam,
  mkPattern,
  mkType,
  type Program,
  type TypeDesc,
  type Expression,
  type DestructPattern,
} from "./ast";
import tables from "./tables/tables.json";
import type { LRContext } from "./lalr";

// ---------------------------------------------------------------------------
// Rule-table verification: rules[i] = { lhs, len } must match the grammar
// actions exactly. Misalignment would produce silent corruption, so we assert
// here once per module load.
// ---------------------------------------------------------------------------

interface RuleEntry {
  lhs: string;
  len: number;
}
type RuleSig = readonly [string, number];
const ruleSigs: RuleSig[] = [
  ["end of file", 0], // 0
  ["$accept", 2], // 1
  ["program", 2], // 2
  ["use_list", 0], // 3
  ["use_list", 2], // 4
  ["use_stmt", 2], // 5
  ["stmt_list", 2], // 6
  ["stmt_list", 1], // 7
  ["statement", 1], // 8
  ["statement", 1], // 9
  ["statement", 1], // 10
  ["statement", 1], // 11
  ["statement", 1], // 12
  ["statement", 1], // 13
  ["statement", 1], // 14
  ["statement", 1], // 15
  ["statement", 1], // 16
  ["statement", 1], // 17
  ["statement", 1], // 18
  ["statement", 1], // 19
  ["statement", 1], // 20
  ["statement", 1], // 21
  ["statement", 1], // 22
  ["break_stmt", 1], // 23
  ["continue_stmt", 1], // 24
  ["var_decl", 4], // 25
  ["var_decl", 6], // 26
  ["var_decl", 6], // 27
  ["var_decl", 6], // 28
  ["var_decl", 6], // 29
  ["var_decl", 4], // 30
  ["var_decl", 6], // 31
  ["var_decl", 6], // 32
  ["var_decl", 6], // 33
  ["var_decl", 6], // 34
  ["var_decl", 6], // 35
  ["var_decl", 6], // 36
  ["var_decl", 6], // 37
  ["var_decl", 6], // 38
  ["var_decl", 8], // 39
  ["var_decl", 8], // 40
  ["var_decl", 11], // 41
  ["var_decl", 10], // 42
  ["var_decl", 8], // 43
  ["var_decl", 8], // 44
  ["var_decl", 11], // 45
  ["var_decl", 10], // 46
  ["var_decl", 6], // 47
  ["assign_stmt", 3], // 48
  ["assign_stmt", 3], // 49
  ["assign_stmt", 3], // 50
  ["assign_stmt", 3], // 51
  ["assign_stmt", 3], // 52
  ["assign_stmt", 3], // 53
  ["assign_stmt", 2], // 54
  ["assign_stmt", 2], // 55
  ["assign_stmt", 6], // 56
  ["assign_stmt", 6], // 57
  ["assign_stmt", 5], // 58
  ["call_stmt", 4], // 59
  ["call_stmt", 3], // 60
  ["print_stmt", 4], // 61
  ["loop_stmt", 7], // 62
  ["foreach_stmt", 9], // 63
  ["foreach_stmt", 11], // 64
  ["while_stmt", 7], // 65
  ["for_stmt", 11], // 66
  ["for_init", 1], // 67
  ["for_init", 1], // 68
  ["for_update", 1], // 69
  ["do_while_stmt", 8], // 70
  ["if_stmt", 7], // 71
  ["if_stmt", 11], // 72
  ["if_stmt", 9], // 73
  ["switch_stmt", 7], // 74
  ["case_list", 5], // 75
  ["case_list", 4], // 76
  ["case_list", 4], // 77
  ["case_list", 3], // 78
  ["return_stmt", 2], // 79
  ["return_stmt", 1], // 80
  ["param_type", 1], // 81
  ["param_type", 1], // 82
  ["param_type", 1], // 83
  ["param_type", 1], // 84
  ["param_type", 1], // 85
  ["param_type", 1], // 86
  ["param_type", 3], // 87
  ["param_type", 3], // 88
  ["param_type", 6], // 89
  ["param_type", 5], // 90
  ["fn_type_params", 3], // 91
  ["fn_type_params", 1], // 92
  ["tuple_elem_list", 3], // 93
  ["tuple_elem_list", 3], // 94
  ["id_list", 3], // 95
  ["id_list", 3], // 96
  ["pattern_item", 1], // 97
  ["pattern_item", 2], // 98
  ["pattern_item", 3], // 99
  ["param_list", 3], // 100
  ["param_list", 1], // 101
  ["param", 3], // 102
  ["param", 5], // 103
  ["param", 4], // 104
  ["fn_decl", 7], // 105
  ["fn_decl", 9], // 106
  ["fn_decl", 8], // 107
  ["fn_decl", 10], // 108
  ["expression", 1], // 109
  ["conditional", 5], // 110
  ["conditional", 1], // 111
  ["logical_or", 3], // 112
  ["logical_or", 1], // 113
  ["logical_and", 3], // 114
  ["logical_and", 1], // 115
  ["equality", 3], // 116
  ["equality", 3], // 117
  ["equality", 1], // 118
  ["relational", 3], // 119
  ["relational", 3], // 120
  ["relational", 3], // 121
  ["relational", 3], // 122
  ["relational", 1], // 123
  ["additive", 3], // 124
  ["additive", 3], // 125
  ["additive", 1], // 126
  ["term", 3], // 127
  ["term", 3], // 128
  ["term", 3], // 129
  ["term", 1], // 130
  ["factor", 1], // 131
  ["factor", 1], // 132
  ["factor", 1], // 133
  ["factor", 1], // 134
  ["factor", 1], // 135
  ["factor", 1], // 136
  ["factor", 2], // 137
  ["factor", 2], // 138
  ["factor", 2], // 139
  ["factor", 1], // 140
  ["factor", 4], // 141
  ["factor", 3], // 142
  ["factor", 6], // 143
  ["factor", 8], // 144
  ["factor", 7], // 145
  ["factor", 9], // 146
  ["factor", 1], // 147
  ["factor", 2], // 148
  ["factor", 3], // 149
  ["factor", 3], // 150
  ["factor", 3], // 151
  ["factor", 3], // 152
  ["factor", 3], // 153
  ["factor", 3], // 154
  ["postfix_index", 4], // 155
  ["postfix_index", 4], // 156
  ["args", 3], // 157
  ["args", 1], // 158
];

// Verify SIG against the extracted tables (lhs name + RHS length per rule).
{
  const tableRules = tables.rules as RuleEntry[];
  if (tableRules.length !== ruleSigs.length) {
    throw new Error(
      `rule count mismatch: tables=${tableRules.length}, actions=${ruleSigs.length}`
    );
  }
  for (let i = 0; i < tableRules.length; i++) {
    const got = tableRules[i];
    const want = ruleSigs[i];
    let lhsMatch = got.lhs === want[0];
    // LHS names must match; some table names carry quotes (e.g. "$accept").
    if (!lhsMatch) {
      lhsMatch = got.lhs.replace(/^"|"$/g, "") === want[0].replace(/^"|"$/g, "");
    }
    if (!lhsMatch || got.len !== want[1]) {
      throw new Error(
        `rule ${i} mismatch: tables=${got.lhs}/${got.len}, actions=${want[0]}/${want[1]}`
      );
    }
  }
}

export type { RuleSig };

// ---------------------------------------------------------------------------
// Small builders mirroring the C++ constructors.
// ---------------------------------------------------------------------------

function mkProgram(): Program {
  return { statements: [], use_files: [], source_file: "" };
}

// ---------------------------------------------------------------------------
// The action table. `rhs` is $1..$n (0-indexed). `ctx.line` mirrors yylineno.
// ---------------------------------------------------------------------------

type Action = (rhs: unknown[], ctx: LRContext) => unknown;

const A: Action[] = new Array(159).fill(null);

// Rule 0: dummy, never fires.
A[0] = () => null;
// Rule 1: $accept: program $end
A[1] = (rhs) => rhs[0];

// rule 2: program: use_list stmt_list
A[2] = (rhs) => {
  const p = mkProgram();
  const uses = rhs[0] as string[] | null;
  if (uses) p.use_files = uses;
  p.statements = rhs[1] as unknown as Program["statements"];
  return p;
};

// rule 3: use_list: %empty
A[3] = () => null;
// rule 4: use_list: use_list use_stmt
A[4] = (rhs) => {
  let list = rhs[0] as string[] | null;
  if (!list) list = [];
  list.push(rhs[1] as string);
  return list;
};
// rule 5: use_stmt: USE STRING
A[5] = (rhs) => rhs[1];

// rule 6: stmt_list: stmt_list statement
A[6] = (rhs) => {
  const list = rhs[0] as unknown[];
  list.push(rhs[1]);
  return list;
};
// rule 7: stmt_list: statement
A[7] = (rhs) => [rhs[0]];

// rules 8-22: statement: <one-lhs>
for (let r = 8; r <= 22; r++) {
  A[r] = (rhs) => rhs[0];
}

// rule 23: break_stmt: BREAK
A[23] = (_, ctx) => {
  const b = new BreakStmt();
  b.line = ctx.line;
  return b;
};
// rule 24: continue_stmt: CONTINUE
A[24] = (_, ctx) => {
  const c = new ContinueStmt();
  c.line = ctx.line;
  return c;
};

// -- var_decl (rules 25-47) --

function setVarDecl(
  v: { name: string; initializer: unknown; line: number },
  opts: {
    isMutable: boolean;
    hasAnnotation?: boolean;
    annotation?: TypeKind;
    elemDesc?: unknown;
    tupleMembers?: unknown[];
    annotationDesc?: unknown;
  },
  ctx: LRContext
) {
  const vd = v as any;
  vd.has_annotation = opts.hasAnnotation ?? false;
  vd.is_mutable = opts.isMutable;
  if (opts.annotation !== undefined) vd.annotation = opts.annotation;
  if (opts.elemDesc !== undefined) vd.elem_desc = opts.elemDesc;
  if (opts.tupleMembers !== undefined) vd.tuple_members = opts.tupleMembers;
  if (opts.annotationDesc !== undefined) vd.annotation_desc = opts.annotationDesc;
  vd.line = ctx.line;
  return vd;
}

function makeVarDeclNode(name: string, initializer: unknown) {
  return new VarDecl(name, initializer as any);
}

// r25: LET IDENTIFIER '=' expression
A[25] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[3]), { isMutable: true }, ctx);
// r26: LET IDENTIFIER ':' TYPE_INT '=' expression
A[26] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Int }, ctx);
A[27] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Decimal }, ctx);
A[28] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Text }, ctx);
A[29] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Bool }, ctx);
// r30: CONST IDENTIFIER '=' expression
A[30] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[3]), { isMutable: false }, ctx);
A[31] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Int }, ctx);
A[32] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Decimal }, ctx);
A[33] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Text }, ctx);
A[34] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Bool }, ctx);
A[35] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Char }, ctx);
A[36] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Byte }, ctx);
A[37] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Char }, ctx);
A[38] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Byte }, ctx);
// r39: LET IDENTIFIER ':' '[' param_type ']' '=' expression
A[39] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Array, elemDesc: rhs[4] }, ctx);
// r40: LET IDENTIFIER ':' '(' tuple_elem_list ')' '=' expression
A[40] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Tuple, tupleMembers: rhs[4] as unknown[] }, ctx);
// r41: LET IDENTIFIER ':' FN '(' fn_type_params ')' ARROW param_type '=' expression
A[41] = (rhs, ctx) => {
  const info = { params: rhs[5], ret: rhs[8] };
  const annotationDesc = { type: TypeKind.Function, elem: null, tuple_members: [], fn_info: info };
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[10]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r42: LET IDENTIFIER ':' FN '(' ')' ARROW param_type '=' expression
A[42] = (rhs, ctx) => {
  const info = { params: [], ret: rhs[7] };
  const annotationDesc = { type: TypeKind.Function, elem: null, tuple_members: [], fn_info: info };
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[9]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r43: CONST ... '[' param_type ']' ...
A[43] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Array, elemDesc: rhs[4] }, ctx);
A[44] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Tuple, tupleMembers: rhs[4] as unknown[] }, ctx);
A[45] = (rhs, ctx) => {
  const info = { params: rhs[5], ret: rhs[8] };
  const annotationDesc = { type: TypeKind.Function, elem: null, tuple_members: [], fn_info: info };
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[10]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
A[46] = (rhs, ctx) => {
  const info = { params: [], ret: rhs[7] };
  const annotationDesc = { type: TypeKind.Function, elem: null, tuple_members: [], fn_info: info };
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[9]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r47: LET '(' id_list ')' '=' expression  -> DestructDecl
A[47] = (rhs, ctx) => {
  const d = new DestructDecl((rhs[2] as { items: DestructPattern[] }).items, rhs[5] as any);
  d.is_mutable = true;
  d.line = ctx.line;
  return d;
};

// -- assign_stmt (rules 48-58) --

A[48] = (rhs, ctx) => asn(rhs[0] as string, "=", rhs[2] as any, ctx);
A[49] = (rhs, ctx) => asn(rhs[0] as string, "+=", rhs[2] as any, ctx);
A[50] = (rhs, ctx) => asn(rhs[0] as string, "-=", rhs[2] as any, ctx);
A[51] = (rhs, ctx) => asn(rhs[0] as string, "*=", rhs[2] as any, ctx);
A[52] = (rhs, ctx) => asn(rhs[0] as string, "/=", rhs[2] as any, ctx);
A[53] = (rhs, ctx) => asn(rhs[0] as string, "%=", rhs[2] as any, ctx);
A[54] = (rhs, ctx) => asn(rhs[0] as string, "++", null, ctx);
A[55] = (rhs, ctx) => asn(rhs[0] as string, "--", null, ctx);

function asn(name: string, op: string, rhsExpr: any, ctx: LRContext) {
  const a = new AssignStmt(name, op, rhsExpr);
  a.line = ctx.line;
  return a;
}

// r56: IDENTIFIER '[' expression ']' '=' expression
A[56] = (rhs, ctx) => {
  const a = new ArrayAssignStmt(rhs[0] as string, rhs[2] as any, rhs[5] as any);
  a.line = ctx.line;
  return a;
};
// r57: postfix_index '[' expression ']' '=' expression
A[57] = (rhs, ctx) => {
  const target = new ArrayIndexExpr("", rhs[2] as any, rhs[0] as any);
  const a = new ElementAssignStmt(target, rhs[5] as any);
  a.line = ctx.line;
  return a;
};
// r58: '(' id_list ')' '=' expression
A[58] = (rhs, ctx) => {
  const m = new MultiAssignStmt((rhs[1] as { items: DestructPattern[] }).items, rhs[4] as any);
  m.line = ctx.line;
  return m;
};

// -- call_stmt / print_stmt --

function callStmt(name: string, args: unknown[], ctx: LRContext) {
  const call = new CallExpr(name, args as any);
  const e = new ExprStmt(call as any);
  e.line = ctx.line;
  return e;
}
// r59: IDENTIFIER '(' args ')'
A[59] = (rhs, ctx) => callStmt(rhs[0] as string, rhs[2] as unknown[], ctx);
// r60: IDENTIFIER '(' ')'
A[60] = (rhs, ctx) => callStmt(rhs[0] as string, [], ctx);
// r61: PRINT '(' args ')'
A[61] = (rhs, ctx) => {
  const p = new PrintStmt(rhs[2] as any);
  p.line = ctx.line;
  return p;
};
// r62: LOOP '(' expression ')' '{' stmt_list '}'
A[62] = (rhs, ctx) => {
  const l = new LoopStmt(rhs[2] as any, rhs[5] as any);
  l.line = ctx.line;
  return l;
};
// r63: FOREACH '(' IDENTIFIER IN expression ')' '{' stmt_list '}'
A[63] = (rhs, ctx) => {
  const f = new ForeachStmt(rhs[2] as string, "", rhs[4] as any, rhs[7] as any);
  f.line = ctx.line;
  return f;
};
// r64: FOREACH '(' IDENTIFIER ',' IDENTIFIER IN expression ')' '{' stmt_list '}'
A[64] = (rhs, ctx) => {
  const f = new ForeachStmt(rhs[4] as string, rhs[2] as string, rhs[6] as any, rhs[9] as any);
  f.line = ctx.line;
  return f;
};
// r65: WHILE '(' expression ')' '{' stmt_list '}'
A[65] = (rhs, ctx) => {
  const w = new WhileStmt(rhs[2] as any, rhs[5] as any);
  w.line = ctx.line;
  return w;
};
// r66: FOR '(' for_init ';' expression ';' for_update ')' '{' stmt_list '}'
A[66] = (rhs, ctx) => {
  const f = new ForStmt(rhs[2] as any, rhs[4] as any, rhs[6] as any, rhs[9] as any);
  f.line = ctx.line;
  return f;
};
A[67] = (rhs) => rhs[0];
A[68] = (rhs) => rhs[0];
A[69] = (rhs) => rhs[0];
// r70: DO '{' stmt_list '}' WHILE '(' expression ')'
A[70] = (rhs, ctx) => {
  const d = new DoWhileStmt(rhs[2] as any, rhs[6] as any);
  d.line = ctx.line;
  return d;
};
// r71: IF '(' expression ')' '{' stmt_list '}'
A[71] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, []);
  n.has_else = false;
  n.line = ctx.line;
  return n;
};
// r72: IF '(' expression ')' '{' stmt_list '}' ELSE '{' stmt_list '}'
A[72] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, rhs[9] as any);
  n.has_else = true;
  n.line = ctx.line;
  return n;
};
// r73: IF '(' expression ')' '{' stmt_list '}' ELSE if_stmt
A[73] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, [rhs[8] as any]);
  n.has_else = true;
  n.line = ctx.line;
  return n;
};
// r74: SWITCH '(' expression ')' '{' case_list '}'
A[74] = (rhs, ctx) => {
  const s = new SwitchStmt(rhs[2] as any, rhs[5] as any);
  s.line = ctx.line;
  return s;
};
// r75: case_list case_list CASE expression ':' stmt_list
A[75] = (rhs) => {
  const list = rhs[0] as any[];
  list.push({ value: rhs[2], body: rhs[4], is_default: false });
  return list;
};
// r76: case_list case_list DEFAULT ':' stmt_list
A[76] = (rhs) => {
  const list = rhs[0] as any[];
  list.push({ value: null, body: rhs[3], is_default: true });
  return list;
};
// r77: case_list CASE expression ':' stmt_list
A[77] = (rhs) => [{ value: rhs[1], body: rhs[3], is_default: false }];
// r78: case_list DEFAULT ':' stmt_list
A[78] = (rhs) => [{ value: null, body: rhs[2], is_default: true }];
// r79: RETURN args
A[79] = (rhs, ctx) => {
  const r = new ReturnStmt(rhs[1] as any);
  r.line = ctx.line;
  return r;
};
// r80: RETURN
A[80] = (_rhs, ctx) => {
  const r = new ReturnStmt([]);
  r.line = ctx.line;
  return r;
};
// r81-86: param_type: simple types
A[81] = () => mkType(TypeKind.Int);
A[82] = () => mkType(TypeKind.Decimal);
A[83] = () => mkType(TypeKind.Text);
A[84] = () => mkType(TypeKind.Bool);
A[85] = () => mkType(TypeKind.Char);
A[86] = () => mkType(TypeKind.Byte);
// r87: '[' param_type ']'
A[87] = (rhs) => arrayOf(rhs[1] as any);
// r88: '(' tuple_elem_list ')'
A[88] = (rhs) => {
  const td = mkType(TypeKind.Tuple);
  td.tuple_members = rhs[1] as any[];
  return td;
};
// r89: FN '(' fn_type_params ')' ARROW param_type
A[89] = (rhs) => {
  const td = mkType(TypeKind.Function);
  td.fn_info = { params: rhs[2] as TypeDesc[], ret: rhs[5] as TypeDesc };
  return td;
};
// r90: FN '(' ')' ARROW param_type
A[90] = (rhs) => {
  const td = mkType(TypeKind.Function);
  td.fn_info = { params: [], ret: rhs[4] as TypeDesc };
  return td;
};
// r91: fn_type_params fn_type_params ',' param_type
A[91] = (rhs) => {
  const list = rhs[0] as any[];
  list.push(rhs[2]);
  return list;
};
// r92: fn_type_params param_type
A[92] = (rhs) => [rhs[0]];
// r93: tuple_elem_list tuple_elem_list ',' param_type
A[93] = (rhs) => {
  const list = rhs[0] as any[];
  list.push(rhs[2]);
  return list;
};
// r94: tuple_elem_list param_type ',' param_type
A[94] = (rhs) => [rhs[0], rhs[2]];
// r95: id_list id_list ',' pattern_item
A[95] = (rhs) => {
  const list = rhs[0] as { items: unknown[] };
  list.items.push(rhs[2]);
  return list;
};
// r96: id_list pattern_item ',' pattern_item
A[96] = (rhs) => ({ items: [rhs[0], rhs[2]] });
// r97: pattern_item IDENTIFIER
A[97] = (rhs) => mkPattern(rhs[0] as string);
// r98: pattern_item ELLIPSIS IDENTIFIER
A[98] = (rhs) => {
  const p = mkPattern(rhs[1] as string);
  p.is_rest = true;
  return p;
};
// r99: pattern_item '(' id_list ')'
A[99] = (rhs) => {
  const p = mkPattern("");
  p.items = (rhs[1] as { items: DestructPattern[] }).items;
  p.nested = true;
  return p;
};
// r100: param_list param_list ',' param
A[100] = (rhs) => {
  const list = rhs[0] as unknown[];
  list.push(rhs[2]);
  return list;
};
// r101: param_list param
A[101] = (rhs) => [rhs[0]];
// r102: param IDENTIFIER ':' param_type
A[102] = (rhs) => makeParam(rhs[0] as string, rhs[2] as any, null);
// r103: param IDENTIFIER ':' param_type '=' expression
A[103] = (rhs) => makeParam(rhs[0] as string, rhs[2] as any, rhs[4] as any);
// r104: param IDENTIFIER ':' ELLIPSIS param_type
A[104] = (rhs) => {
  const p = mkParam(rhs[0] as string);
  p.type = TypeKind.Array;
  p.elem_desc = rhs[3] as any;
  p.variadic = true;
  p.desc = arrayOf(rhs[3] as any);
  return p;
};

function makeParam(name: string, td: any, defaultValue: any) {
  const p = mkParam(name);
  p.type = td.type as TypeKind;
  p.desc = td;
  if (p.type === TypeKind.Tuple) {
    p.tuple_members = (td.tuple_members as TypeDesc[]).slice();
    p.desc.tuple_members = p.tuple_members;
  } else {
    p.elem_desc = td.elem ?? emptyTypeDesc();
  }
  p.default_value = defaultValue;
  return p;
}

// -- fn_decl (rules 105-108) --

function makeFnDecl(
  name: string,
  params: unknown[],
  hasReturnType: boolean,
  returnType: TypeKind,
  returnDesc: any,
  body: unknown[],
  ctx: LRContext
) {
  const f = new FunctionDecl(name);
  f.params = params as any;
  f.body = body as any;
  f.has_return_type = hasReturnType;
  if (hasReturnType) {
    f.return_type = returnType;
    f.return_elem = returnDesc.elem ?? emptyTypeDesc();
    f.return_desc = returnDesc;
    if (returnType === TypeKind.Tuple) {
      f.return_tuple_members = (returnDesc.tuple_members as TypeDesc[]).slice();
      f.return_desc.tuple_members = f.return_tuple_members;
    }
  }
  f.line = ctx.line;
  return f;
}

// r105: FN IDENTIFIER '(' ')' '{' stmt_list '}'
A[105] = (rhs, ctx) => makeFnDecl(rhs[1] as string, [], false, TypeKind.Unknown, mkType(TypeKind.Unknown), rhs[5] as unknown[], ctx);
// r106: FN IDENTIFIER '(' ')' ARROW param_type '{' stmt_list '}'
A[106] = (rhs, ctx) => makeFnDecl(rhs[1] as string, [], true, (rhs[5] as any).type, rhs[5] as any, rhs[7] as unknown[], ctx);
// r107: FN IDENTIFIER '(' param_list ')' '{' stmt_list '}'
A[107] = (rhs, ctx) => makeFnDecl(rhs[1] as string, rhs[3] as unknown[], false, TypeKind.Unknown, mkType(TypeKind.Unknown), rhs[6] as unknown[], ctx);
// r108: FN IDENTIFIER '(' param_list ')' ARROW param_type '{' stmt_list '}'
A[108] = (rhs, ctx) => makeFnDecl(rhs[1] as string, rhs[3] as unknown[], true, (rhs[6] as any).type, rhs[6] as any, rhs[8] as unknown[], ctx);

// rule 109: expression -> conditional
A[109] = (rhs) => rhs[0];
// r110: conditional logical_or '?' expression ':' expression
A[110] = (rhs) => new ConditionalExpr(rhs[0] as any, rhs[2] as any, rhs[4] as any);
A[111] = (rhs) => rhs[0];
// r112: logical_or logical_or OR logical_and
A[112] = (rhs) => new BinaryExpr("||", ExprKind.Logical, rhs[0] as any, rhs[2] as any);
A[113] = (rhs) => rhs[0];
// r114: logical_and logical_and AND equality
A[114] = (rhs) => new BinaryExpr("&&", ExprKind.Logical, rhs[0] as any, rhs[2] as any);
A[115] = (rhs) => rhs[0];
// r116: equality equality EQ relational
A[116] = (rhs) => new BinaryExpr("==", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
// r117: equality equality NEQ relational
A[117] = (rhs) => new BinaryExpr("!=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[118] = (rhs) => rhs[0];
// r119-122: relational comparisons
A[119] = (rhs) => new BinaryExpr("<", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[120] = (rhs) => new BinaryExpr(">", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[121] = (rhs) => new BinaryExpr("<=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[122] = (rhs) => new BinaryExpr(">=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[123] = (rhs) => rhs[0];
// r124-125: additive
A[124] = (rhs) => new BinaryExpr("+", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[125] = (rhs) => new BinaryExpr("-", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[126] = (rhs) => rhs[0];
// r127-129: term
A[127] = (rhs) => new BinaryExpr("*", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[128] = (rhs) => new BinaryExpr("/", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[129] = (rhs) => new BinaryExpr("%", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[130] = (rhs) => rhs[0];
// r131-156: factor postfix_index args
A[131] = (rhs) => new NumberLiteral(rhs[0] as number);
A[132] = (rhs) => new DecimalLiteral(rhs[0] as number);
A[133] = (rhs) => new StringLiteral(rhs[0] as string);
A[134] = (rhs) => new CharLiteral(rhs[0] as string);
A[135] = () => new BoolLiteral(true);
A[136] = () => new BoolLiteral(false);
A[137] = (rhs) => new NotExpr(rhs[1] as any);
A[138] = (rhs) => new NegExpr(rhs[1] as any);
A[139] = (rhs) => rhs[1];
A[140] = (rhs) => new Identifier(rhs[0] as string);
A[141] = (rhs) => new CallExpr(rhs[0] as string, rhs[2] as any);
A[142] = (rhs) => new CallExpr(rhs[0] as string, []);
// r143: LAMBDA '(' ')' '{' stmt_list '}'
A[143] = (rhs, ctx) => {
  const lam = new LambdaExpr();
  lam.has_return_type = false;
  lam.body = rhs[4] as any;
  lam.line = ctx.line;
  return lam;
};
// r144: LAMBDA '(' ')' ARROW param_type '{' stmt_list '}'
A[144] = (rhs, ctx) => {
  const lam = makeLambdaReturn(rhs[4] as any, rhs[6] as any);
  lam.line = ctx.line;
  return lam;
};
// r145: LAMBDA '(' param_list ')' '{' stmt_list '}'
A[145] = (rhs, ctx) => {
  const lam = new LambdaExpr();
  lam.params = rhs[2] as any;
  lam.has_return_type = false;
  lam.body = rhs[5] as any;
  lam.line = ctx.line;
  return lam;
};
// r146: LAMBDA '(' param_list ')' ARROW param_type '{' stmt_list '}'
A[146] = (rhs, ctx) => {
  const lam = makeLambdaReturn(rhs[5] as any, rhs[7] as any);
  lam.params = rhs[2] as any;
  lam.line = ctx.line;
  return lam;
};
function makeLambdaReturn(returnTY: any, body: unknown[]) {
  const lam = new LambdaExpr();
  lam.has_return_type = true;
  lam.return_type = returnTY.type as TypeKind;
  lam.return_elem = returnTY.elem ?? emptyTypeDesc();
  lam.return_desc = returnTY;
  if (lam.return_type === TypeKind.Tuple) {
    lam.return_tuple_members = (returnTY.tuple_members as TypeDesc[]).slice();
    lam.return_desc.tuple_members = lam.return_tuple_members;
  }
  lam.body = body as any;
  return lam;
}
A[147] = (rhs) => rhs[0];
A[148] = () => {
  const arr = new ArrayLiteral([]);
  return arr;
};
A[149] = (rhs) => new ArrayLiteral(rhs[1] as any);
A[150] = (rhs) => new CastExpr(TypeKind.Int, rhs[0] as any);
A[151] = (rhs) => new CastExpr(TypeKind.Decimal, rhs[0] as any);
// r152: factor AS TYPE_BYTE
A[152] = (rhs) => new CastExpr(TypeKind.Byte, rhs[0] as any);
// r153: factor AS TYPE_CHAR
A[153] = (rhs) => new CastExpr(TypeKind.Char, rhs[0] as any);
// r154: '(' args ')'
A[154] = (rhs) => {
  const args = rhs[1] as unknown[];
  if (args.length === 1) return args[0];
  return new TupleLiteral(args as Expression[]);
};
// r155: postfix_index IDENTIFIER '[' expression ']'
A[155] = (rhs) => new ArrayIndexExpr(rhs[0] as string, rhs[2] as any);
// r156: postfix_index postfix_index '[' expression ']'
A[156] = (rhs) => new ArrayIndexExpr("", rhs[2] as any, rhs[0] as any);
// r157: args args ',' expression
A[157] = (rhs) => {
  const list = rhs[0] as unknown[];
  list.push(rhs[2]);
  return list;
};
// r158: args expression
A[158] = (rhs) => [rhs[0]];

// ---------------------------------------------------------------------------
// Entry point: the verified action table.
// ---------------------------------------------------------------------------

export const ACTIONS = A;

export function actionForRule(rule: number): Action {
  const fn = A[rule];
  if (!fn) throw new Error(`no action for rule ${rule}`);
  return fn;
}