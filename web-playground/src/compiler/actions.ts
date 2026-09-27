// Semantic actions for the LALR parser — a 1:1 port of the grammar actions in
// parser.y. Rule indices match bison's numbering (rule 0 = dummy, rule 1 =
// $accept, rules 2..179 = the grammar). `rules` is big (179 entries) so the
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
  MemberAccessExpr,
  MemberAssignStmt,
  MultiAssignStmt,
  NegExpr,
  NotExpr,
  NumberLiteral,
  PrintStmt,
  ReturnStmt,
  StringLiteral,
  SwitchStmt,
  TupleLiteral,
  TypeDecl,
  TypeDeclKind,
  TypeKind,
  VarDecl,
  WhileStmt,
  arrayOf,
  emptyTypeDesc,
  mkParam,
  mkPattern,
  mkType,
  type Program,
  type StructFieldInfo,
  type TypeDesc,
  type Expression,
  type DestructPattern,
  type FunctionTypeInfo,
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
  ["statement", 1], // 23
  ["type_decl", 4], // 24
  ["type_decl", 5], // 25
  ["type_decl", 5], // 26
  ["struct_fields", 4], // 27
  ["struct_fields", 3], // 28
  ["enum_variants", 2], // 29
  ["enum_variants", 1], // 30
  ["break_stmt", 1], // 31
  ["continue_stmt", 1], // 32
  ["var_decl", 4], // 33
  ["var_decl", 6], // 34
  ["var_decl", 6], // 35
  ["var_decl", 6], // 36
  ["var_decl", 6], // 37
  ["var_decl", 4], // 38
  ["var_decl", 6], // 39
  ["var_decl", 6], // 40
  ["var_decl", 6], // 41
  ["var_decl", 6], // 42
  ["var_decl", 6], // 43
  ["var_decl", 6], // 44
  ["var_decl", 6], // 45
  ["var_decl", 6], // 46
  ["var_decl", 6], // 47
  ["var_decl", 6], // 48
  ["var_decl", 8], // 49
  ["var_decl", 8], // 50
  ["var_decl", 11], // 51
  ["var_decl", 10], // 52
  ["var_decl", 8], // 53
  ["var_decl", 8], // 54
  ["var_decl", 11], // 55
  ["var_decl", 10], // 56
  ["var_decl", 6], // 57
  ["assign_stmt", 3], // 58
  ["assign_stmt", 3], // 59
  ["assign_stmt", 3], // 60
  ["assign_stmt", 3], // 61
  ["assign_stmt", 3], // 62
  ["assign_stmt", 3], // 63
  ["assign_stmt", 2], // 64
  ["assign_stmt", 2], // 65
  ["assign_stmt", 6], // 66
  ["assign_stmt", 6], // 67
  ["assign_stmt", 5], // 68
  ["assign_stmt", 5], // 69
  ["assign_stmt", 5], // 70
  ["assign_stmt", 5], // 71
  ["assign_stmt", 5], // 72
  ["assign_stmt", 5], // 73
  ["assign_stmt", 4], // 74
  ["assign_stmt", 4], // 75
  ["assign_stmt", 5], // 76
  ["call_stmt", 4], // 77
  ["call_stmt", 3], // 78
  ["print_stmt", 4], // 79
  ["loop_stmt", 7], // 80
  ["foreach_stmt", 9], // 81
  ["foreach_stmt", 11], // 82
  ["while_stmt", 7], // 83
  ["for_stmt", 11], // 84
  ["for_init", 1], // 85
  ["for_init", 1], // 86
  ["for_update", 1], // 87
  ["do_while_stmt", 8], // 88
  ["if_stmt", 7], // 89
  ["if_stmt", 11], // 90
  ["if_stmt", 9], // 91
  ["switch_stmt", 7], // 92
  ["case_list", 5], // 93
  ["case_list", 4], // 94
  ["case_list", 4], // 95
  ["case_list", 3], // 96
  ["return_stmt", 2], // 97
  ["return_stmt", 1], // 98
  ["param_type", 1], // 99
  ["param_type", 1], // 100
  ["param_type", 1], // 101
  ["param_type", 1], // 102
  ["param_type", 1], // 103
  ["param_type", 1], // 104
  ["param_type", 1], // 105
  ["param_type", 3], // 106
  ["param_type", 3], // 107
  ["param_type", 6], // 108
  ["param_type", 5], // 109
  ["named_ref", 1], // 110
  ["fn_type_params", 3], // 111
  ["fn_type_params", 1], // 112
  ["tuple_elem_list", 3], // 113
  ["tuple_elem_list", 3], // 114
  ["id_list", 3], // 115
  ["id_list", 3], // 116
  ["pattern_item", 1], // 117
  ["pattern_item", 2], // 118
  ["pattern_item", 3], // 119
  ["param_list", 3], // 120
  ["param_list", 1], // 121
  ["param", 3], // 122
  ["param", 5], // 123
  ["param", 4], // 124
  ["fn_decl", 7], // 125
  ["fn_decl", 9], // 126
  ["fn_decl", 8], // 127
  ["fn_decl", 10], // 128
  ["expression", 1], // 129
  ["conditional", 5], // 130
  ["conditional", 1], // 131
  ["logical_or", 3], // 132
  ["logical_or", 1], // 133
  ["logical_and", 3], // 134
  ["logical_and", 1], // 135
  ["equality", 3], // 136
  ["equality", 3], // 137
  ["equality", 1], // 138
  ["relational", 3], // 139
  ["relational", 3], // 140
  ["relational", 3], // 141
  ["relational", 3], // 142
  ["relational", 1], // 143
  ["additive", 3], // 144
  ["additive", 3], // 145
  ["additive", 1], // 146
  ["term", 3], // 147
  ["term", 3], // 148
  ["term", 3], // 149
  ["term", 1], // 150
  ["factor", 1], // 151
  ["factor", 1], // 152
  ["factor", 1], // 153
  ["factor", 1], // 154
  ["factor", 1], // 155
  ["factor", 1], // 156
  ["factor", 2], // 157
  ["factor", 2], // 158
  ["factor", 2], // 159
  ["factor", 4], // 160
  ["factor", 3], // 161
  ["factor", 6], // 162
  ["factor", 8], // 163
  ["factor", 7], // 164
  ["factor", 9], // 165
  ["factor", 1], // 166
  ["factor", 2], // 167
  ["factor", 3], // 168
  ["factor", 3], // 169
  ["factor", 3], // 170
  ["factor", 3], // 171
  ["factor", 3], // 172
  ["factor", 3], // 173
  ["postfix_index", 1], // 174
  ["postfix_index", 4], // 175
  ["postfix_index", 4], // 176
  ["postfix_index", 3], // 177
  ["args", 3], // 178
  ["args", 1], // 179
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

const A: Action[] = new Array(180).fill(null);

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

// rules 8-23: statement: <one-lhs>
for (let r = 8; r <= 23; r++) {
  A[r] = (rhs) => rhs[0];
}

// -- type_decl (rules 24-26) --

// r24: ALIAS IDENTIFIER '=' param_type
A[24] = (rhs, ctx) => {
  const t = new TypeDecl(rhs[1] as string);
  t.tdecl_kind = TypeDeclKind.Alias;
  t.alias_target = rhs[3] as TypeDesc;
  t.line = ctx.line;
  return t;
};
// r25: STRUCT IDENTIFIER '{' struct_fields '}'
A[25] = (rhs, ctx) => {
  const t = new TypeDecl(rhs[1] as string);
  t.tdecl_kind = TypeDeclKind.Struct;
  t.fields = rhs[3] as StructFieldInfo[];
  t.line = ctx.line;
  return t;
};
// r26: ENUM IDENTIFIER '{' enum_variants '}'
A[26] = (rhs, ctx) => {
  const t = new TypeDecl(rhs[1] as string);
  t.tdecl_kind = TypeDeclKind.Enum;
  t.variants = rhs[3] as string[];
  t.line = ctx.line;
  return t;
};
// r27: struct_fields: struct_fields IDENTIFIER ':' param_type
A[27] = (rhs) => {
  const list = rhs[0] as StructFieldInfo[];
  list.push({ name: rhs[1] as string, desc: rhs[3] as TypeDesc });
  return list;
};
// r28: struct_fields: IDENTIFIER ':' param_type
A[28] = (rhs) => [{ name: rhs[0] as string, desc: rhs[2] as TypeDesc }];
// r29: enum_variants: enum_variants IDENTIFIER
A[29] = (rhs) => {
  const list = rhs[0] as string[];
  list.push(rhs[1] as string);
  return list;
};
// r30: enum_variants: IDENTIFIER
A[30] = (rhs) => [rhs[0] as string];

// rule 31: break_stmt: BREAK
A[31] = (_, ctx) => {
  const b = new BreakStmt();
  b.line = ctx.line;
  return b;
};
// rule 32: continue_stmt: CONTINUE
A[32] = (_, ctx) => {
  const c = new ContinueStmt();
  c.line = ctx.line;
  return c;
};

// -- var_decl (rules 33-57) --

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

// r33: LET IDENTIFIER '=' expression
A[33] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[3]), { isMutable: true }, ctx);
// r34-37: LET IDENTIFIER ':' TYPE_INT/DECIMAL/TEXT/BOOL '=' expression
A[34] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Int }, ctx);
A[35] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Decimal }, ctx);
A[36] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Text }, ctx);
A[37] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Bool }, ctx);
// r38: CONST IDENTIFIER '=' expression
A[38] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[3]), { isMutable: false }, ctx);
A[39] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Int }, ctx);
A[40] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Decimal }, ctx);
A[41] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Text }, ctx);
A[42] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Bool }, ctx);
A[43] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Char }, ctx);
A[44] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Byte }, ctx);
A[45] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Char }, ctx);
A[46] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Byte }, ctx);
// r47-48: LET/CONST IDENTIFIER ':' named_ref '=' expression  (M16 named types)
A[47] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Unknown, annotationDesc: rhs[3] }, ctx);
A[48] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[5]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Unknown, annotationDesc: rhs[3] }, ctx);
// r49: LET IDENTIFIER ':' '[' param_type ']' '=' expression
A[49] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Array, elemDesc: rhs[4] }, ctx);
// r50: LET IDENTIFIER ':' '(' tuple_elem_list ')' '=' expression
A[50] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Tuple, tupleMembers: rhs[4] as unknown[] }, ctx);
// r51: LET IDENTIFIER ':' FN '(' fn_type_params ')' ARROW param_type '=' expression
A[51] = (rhs, ctx) => {
  const info: FunctionTypeInfo = { params: rhs[5] as TypeDesc[], ret: rhs[8] as TypeDesc };
  const annotationDesc = mkType(TypeKind.Function);
  annotationDesc.fn_info = info;
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[10]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r52: LET IDENTIFIER ':' FN '(' ')' ARROW param_type '=' expression
A[52] = (rhs, ctx) => {
  const info: FunctionTypeInfo = { params: [], ret: rhs[7] as TypeDesc };
  const annotationDesc = mkType(TypeKind.Function);
  annotationDesc.fn_info = info;
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[9]), { isMutable: true, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r53: CONST ... '[' param_type ']' ...
A[53] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Array, elemDesc: rhs[4] }, ctx);
A[54] = (rhs, ctx) =>
  setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[7]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Tuple, tupleMembers: rhs[4] as unknown[] }, ctx);
A[55] = (rhs, ctx) => {
  const info: FunctionTypeInfo = { params: rhs[5] as TypeDesc[], ret: rhs[8] as TypeDesc };
  const annotationDesc = mkType(TypeKind.Function);
  annotationDesc.fn_info = info;
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[10]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
A[56] = (rhs, ctx) => {
  const info: FunctionTypeInfo = { params: [], ret: rhs[7] as TypeDesc };
  const annotationDesc = mkType(TypeKind.Function);
  annotationDesc.fn_info = info;
  return setVarDecl(makeVarDeclNode(rhs[1] as string, rhs[9]), { isMutable: false, hasAnnotation: true, annotation: TypeKind.Function, annotationDesc }, ctx);
};
// r57: LET '(' id_list ')' '=' expression  -> DestructDecl
A[57] = (rhs, ctx) => {
  const d = new DestructDecl((rhs[2] as { items: DestructPattern[] }).items, rhs[5] as any);
  d.is_mutable = true;
  d.line = ctx.line;
  return d;
};

// -- assign_stmt (rules 58-76) --

A[58] = (rhs, ctx) => asn(rhs[0] as string, "=", rhs[2] as any, ctx);
A[59] = (rhs, ctx) => asn(rhs[0] as string, "+=", rhs[2] as any, ctx);
A[60] = (rhs, ctx) => asn(rhs[0] as string, "-=", rhs[2] as any, ctx);
A[61] = (rhs, ctx) => asn(rhs[0] as string, "*=", rhs[2] as any, ctx);
A[62] = (rhs, ctx) => asn(rhs[0] as string, "/=", rhs[2] as any, ctx);
A[63] = (rhs, ctx) => asn(rhs[0] as string, "%=", rhs[2] as any, ctx);
A[64] = (rhs, ctx) => asn(rhs[0] as string, "++", null, ctx);
A[65] = (rhs, ctx) => asn(rhs[0] as string, "--", null, ctx);

function asn(name: string, op: string, rhsExpr: any, ctx: LRContext) {
  const a = new AssignStmt(name, op, rhsExpr);
  a.line = ctx.line;
  return a;
}

// r66: IDENTIFIER '[' expression ']' '=' expression
A[66] = (rhs, ctx) => {
  const a = new ArrayAssignStmt(rhs[0] as string, rhs[2] as any, rhs[5] as any);
  a.line = ctx.line;
  return a;
};
// r67: postfix_index '[' expression ']' '=' expression
A[67] = (rhs, ctx) => {
  const target = new ArrayIndexExpr("", rhs[2] as any, rhs[0] as any);
  const a = new ElementAssignStmt(target, rhs[5] as any);
  a.line = ctx.line;
  return a;
};
// r68-75: postfix_index DOT IDENTIFIER <assign-op>  (M16 member assignment)
A[68] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "=", rhs[4] as any, ctx);
A[69] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "+=", rhs[4] as any, ctx);
A[70] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "-=", rhs[4] as any, ctx);
A[71] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "*=", rhs[4] as any, ctx);
A[72] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "/=", rhs[4] as any, ctx);
A[73] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "%=", rhs[4] as any, ctx);
A[74] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "++", null, ctx);
A[75] = (rhs, ctx) => memberAsn(rhs[0] as any, rhs[2] as string, "--", null, ctx);

function memberAsn(base: any, member: string, op: string, rhsExpr: any, ctx: LRContext) {
  const a = new MemberAssignStmt(base, member, op, rhsExpr);
  a.line = ctx.line;
  return a;
}
// r76: '(' id_list ')' '=' expression
A[76] = (rhs, ctx) => {
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
// r77: IDENTIFIER '(' args ')'
A[77] = (rhs, ctx) => callStmt(rhs[0] as string, rhs[2] as unknown[], ctx);
// r78: IDENTIFIER '(' ')'
A[78] = (rhs, ctx) => callStmt(rhs[0] as string, [], ctx);
// r79: PRINT '(' args ')'
A[79] = (rhs, ctx) => {
  const p = new PrintStmt(rhs[2] as any);
  p.line = ctx.line;
  return p;
};
// r80: LOOP '(' expression ')' '{' stmt_list '}'
A[80] = (rhs, ctx) => {
  const l = new LoopStmt(rhs[2] as any, rhs[5] as any);
  l.line = ctx.line;
  return l;
};
// r81: FOREACH '(' IDENTIFIER IN expression ')' '{' stmt_list '}'
A[81] = (rhs, ctx) => {
  const f = new ForeachStmt(rhs[2] as string, "", rhs[4] as any, rhs[7] as any);
  f.line = ctx.line;
  return f;
};
// r82: FOREACH '(' IDENTIFIER ',' IDENTIFIER IN expression ')' '{' stmt_list '}'
A[82] = (rhs, ctx) => {
  const f = new ForeachStmt(rhs[4] as string, rhs[2] as string, rhs[6] as any, rhs[9] as any);
  f.line = ctx.line;
  return f;
};
// r83: WHILE '(' expression ')' '{' stmt_list '}'
A[83] = (rhs, ctx) => {
  const w = new WhileStmt(rhs[2] as any, rhs[5] as any);
  w.line = ctx.line;
  return w;
};
// r84: FOR '(' for_init ';' expression ';' for_update ')' '{' stmt_list '}'
A[84] = (rhs, ctx) => {
  const f = new ForStmt(rhs[2] as any, rhs[4] as any, rhs[6] as any, rhs[9] as any);
  f.line = ctx.line;
  return f;
};
A[85] = (rhs) => rhs[0];
A[86] = (rhs) => rhs[0];
A[87] = (rhs) => rhs[0];
// r88: DO '{' stmt_list '}' WHILE '(' expression ')'
A[88] = (rhs, ctx) => {
  const d = new DoWhileStmt(rhs[2] as any, rhs[6] as any);
  d.line = ctx.line;
  return d;
};
// r89: IF '(' expression ')' '{' stmt_list '}'
A[89] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, []);
  n.has_else = false;
  n.line = ctx.line;
  return n;
};
// r90: IF '(' expression ')' '{' stmt_list '}' ELSE '{' stmt_list '}'
A[90] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, rhs[9] as any);
  n.has_else = true;
  n.line = ctx.line;
  return n;
};
// r91: IF '(' expression ')' '{' stmt_list '}' ELSE if_stmt
A[91] = (rhs, ctx) => {
  const n = new IfStmt(rhs[2] as any, rhs[5] as any, [rhs[8] as any]);
  n.has_else = true;
  n.line = ctx.line;
  return n;
};
// r92: SWITCH '(' expression ')' '{' case_list '}'
A[92] = (rhs, ctx) => {
  const s = new SwitchStmt(rhs[2] as any, rhs[5] as any);
  s.line = ctx.line;
  return s;
};
// r93: case_list case_list CASE expression ':' stmt_list
A[93] = (rhs) => {
  const list = rhs[0] as any[];
  list.push({ value: rhs[2], body: rhs[4], is_default: false });
  return list;
};
// r94: case_list case_list DEFAULT ':' stmt_list
A[94] = (rhs) => {
  const list = rhs[0] as any[];
  list.push({ value: null, body: rhs[3], is_default: true });
  return list;
};
// r95: case_list CASE expression ':' stmt_list
A[95] = (rhs) => [{ value: rhs[1], body: rhs[3], is_default: false }];
// r96: case_list DEFAULT ':' stmt_list
A[96] = (rhs) => [{ value: null, body: rhs[2], is_default: true }];
// r97: RETURN args
A[97] = (rhs, ctx) => {
  const r = new ReturnStmt(rhs[1] as any);
  r.line = ctx.line;
  return r;
};
// r98: RETURN
A[98] = (_rhs, ctx) => {
  const r = new ReturnStmt([]);
  r.line = ctx.line;
  return r;
};
// r99-104: param_type: simple types
A[99] = () => mkType(TypeKind.Int);
A[100] = () => mkType(TypeKind.Decimal);
A[101] = () => mkType(TypeKind.Text);
A[102] = () => mkType(TypeKind.Bool);
A[103] = () => mkType(TypeKind.Char);
A[104] = () => mkType(TypeKind.Byte);
// r105: param_type: IDENTIFIER  (named type reference)
A[105] = (rhs) => {
  const td = mkType(TypeKind.Unknown);
  td.type_name = rhs[0] as string;
  return td;
};
// r106: '[' param_type ']'
A[106] = (rhs) => arrayOf(rhs[1] as any);
// r107: '(' tuple_elem_list ')'
A[107] = (rhs) => {
  const td = mkType(TypeKind.Tuple);
  td.tuple_members = rhs[1] as any[];
  return td;
};
// r108: FN '(' fn_type_params ')' ARROW param_type
A[108] = (rhs) => {
  const td = mkType(TypeKind.Function);
  td.fn_info = { params: rhs[2] as TypeDesc[], ret: rhs[5] as TypeDesc };
  return td;
};
// r109: FN '(' ')' ARROW param_type
A[109] = (rhs) => {
  const td = mkType(TypeKind.Function);
  td.fn_info = { params: [], ret: rhs[4] as TypeDesc };
  return td;
};
// r110: named_ref: IDENTIFIER  (annotation for a user-declared type name)
A[110] = (rhs) => {
  const td = mkType(TypeKind.Unknown);
  td.type_name = rhs[0] as string;
  return td;
};
// r111: fn_type_params fn_type_params ',' param_type
A[111] = (rhs) => {
  const list = rhs[0] as any[];
  list.push(rhs[2]);
  return list;
};
// r112: fn_type_params param_type
A[112] = (rhs) => [rhs[0]];
// r113: tuple_elem_list tuple_elem_list ',' param_type
A[113] = (rhs) => {
  const list = rhs[0] as any[];
  list.push(rhs[2]);
  return list;
};
// r114: tuple_elem_list param_type ',' param_type
A[114] = (rhs) => [rhs[0], rhs[2]];
// r115: id_list id_list ',' pattern_item
A[115] = (rhs) => {
  const list = rhs[0] as { items: unknown[] };
  list.items.push(rhs[2]);
  return list;
};
// r116: id_list pattern_item ',' pattern_item
A[116] = (rhs) => ({ items: [rhs[0], rhs[2]] });
// r117: pattern_item IDENTIFIER
A[117] = (rhs) => mkPattern(rhs[0] as string);
// r118: pattern_item ELLIPSIS IDENTIFIER
A[118] = (rhs) => {
  const p = mkPattern(rhs[1] as string);
  p.is_rest = true;
  return p;
};
// r119: pattern_item '(' id_list ')'
A[119] = (rhs) => {
  const p = mkPattern("");
  p.items = (rhs[1] as { items: DestructPattern[] }).items;
  p.nested = true;
  return p;
};
// r120: param_list param_list ',' param
A[120] = (rhs) => {
  const list = rhs[0] as unknown[];
  list.push(rhs[2]);
  return list;
};
// r121: param_list param
A[121] = (rhs) => [rhs[0]];
// r122: param IDENTIFIER ':' param_type
A[122] = (rhs) => makeParam(rhs[0] as string, rhs[2] as any, null);
// r123: param IDENTIFIER ':' param_type '=' expression
A[123] = (rhs) => makeParam(rhs[0] as string, rhs[2] as any, rhs[4] as any);
// r124: param IDENTIFIER ':' ELLIPSIS param_type
A[124] = (rhs) => {
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

// -- fn_decl (rules 125-128) --

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

// r125: FN IDENTIFIER '(' ')' '{' stmt_list '}'
A[125] = (rhs, ctx) => makeFnDecl(rhs[1] as string, [], false, TypeKind.Unknown, mkType(TypeKind.Unknown), rhs[5] as unknown[], ctx);
// r126: FN IDENTIFIER '(' ')' ARROW param_type '{' stmt_list '}'
A[126] = (rhs, ctx) => makeFnDecl(rhs[1] as string, [], true, (rhs[5] as any).type, rhs[5] as any, rhs[7] as unknown[], ctx);
// r127: FN IDENTIFIER '(' param_list ')' '{' stmt_list '}'
A[127] = (rhs, ctx) => makeFnDecl(rhs[1] as string, rhs[3] as unknown[], false, TypeKind.Unknown, mkType(TypeKind.Unknown), rhs[6] as unknown[], ctx);
// r128: FN IDENTIFIER '(' param_list ')' ARROW param_type '{' stmt_list '}'
A[128] = (rhs, ctx) => makeFnDecl(rhs[1] as string, rhs[3] as unknown[], true, (rhs[6] as any).type, rhs[6] as any, rhs[8] as unknown[], ctx);

// rule 129: expression -> conditional
A[129] = (rhs) => rhs[0];
// r130: conditional logical_or '?' expression ':' expression
A[130] = (rhs) => new ConditionalExpr(rhs[0] as any, rhs[2] as any, rhs[4] as any);
A[131] = (rhs) => rhs[0];
// r132: logical_or logical_or OR logical_and
A[132] = (rhs) => new BinaryExpr("||", ExprKind.Logical, rhs[0] as any, rhs[2] as any);
A[133] = (rhs) => rhs[0];
// r134: logical_and logical_and AND equality
A[134] = (rhs) => new BinaryExpr("&&", ExprKind.Logical, rhs[0] as any, rhs[2] as any);
A[135] = (rhs) => rhs[0];
// r136: equality equality EQ relational
A[136] = (rhs) => new BinaryExpr("==", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
// r137: equality equality NEQ relational
A[137] = (rhs) => new BinaryExpr("!=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[138] = (rhs) => rhs[0];
// r139-142: relational comparisons
A[139] = (rhs) => new BinaryExpr("<", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[140] = (rhs) => new BinaryExpr(">", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[141] = (rhs) => new BinaryExpr("<=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[142] = (rhs) => new BinaryExpr(">=", ExprKind.Comparison, rhs[0] as any, rhs[2] as any);
A[143] = (rhs) => rhs[0];
// r144-145: additive
A[144] = (rhs) => new BinaryExpr("+", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[145] = (rhs) => new BinaryExpr("-", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[146] = (rhs) => rhs[0];
// r147-149: term
A[147] = (rhs) => new BinaryExpr("*", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[148] = (rhs) => new BinaryExpr("/", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[149] = (rhs) => new BinaryExpr("%", ExprKind.Arithmetic, rhs[0] as any, rhs[2] as any);
A[150] = (rhs) => rhs[0];
// r151-179: factor postfix_index args
A[151] = (rhs) => new NumberLiteral(rhs[0] as number);
A[152] = (rhs) => new DecimalLiteral(rhs[0] as number);
A[153] = (rhs) => new StringLiteral(rhs[0] as string);
A[154] = (rhs) => new CharLiteral(rhs[0] as string);
A[155] = () => new BoolLiteral(true);
A[156] = () => new BoolLiteral(false);
A[157] = (rhs) => new NotExpr(rhs[1] as any);
A[158] = (rhs) => new NegExpr(rhs[1] as any);
A[159] = (rhs) => rhs[1];
A[160] = (rhs) => new CallExpr(rhs[0] as string, rhs[2] as any);
A[161] = (rhs) => new CallExpr(rhs[0] as string, []);
// r162: LAMBDA '(' ')' '{' stmt_list '}'
A[162] = (rhs, ctx) => {
  const lam = new LambdaExpr();
  lam.has_return_type = false;
  lam.body = rhs[4] as any;
  lam.line = ctx.line;
  return lam;
};
// r163: LAMBDA '(' ')' ARROW param_type '{' stmt_list '}'
A[163] = (rhs, ctx) => {
  const lam = makeLambdaReturn(rhs[4] as any, rhs[6] as any);
  lam.line = ctx.line;
  return lam;
};
// r164: LAMBDA '(' param_list ')' '{' stmt_list '}'
A[164] = (rhs, ctx) => {
  const lam = new LambdaExpr();
  lam.params = rhs[2] as any;
  lam.has_return_type = false;
  lam.body = rhs[5] as any;
  lam.line = ctx.line;
  return lam;
};
// r165: LAMBDA '(' param_list ')' ARROW param_type '{' stmt_list '}'
A[165] = (rhs, ctx) => {
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
A[166] = (rhs) => rhs[0];
A[167] = () => {
  const arr = new ArrayLiteral([]);
  return arr;
};
A[168] = (rhs) => new ArrayLiteral(rhs[1] as any);
A[169] = (rhs) => new CastExpr(TypeKind.Int, rhs[0] as any);
A[170] = (rhs) => new CastExpr(TypeKind.Decimal, rhs[0] as any);
A[171] = (rhs) => new CastExpr(TypeKind.Byte, rhs[0] as any);
A[172] = (rhs) => new CastExpr(TypeKind.Char, rhs[0] as any);
// r173: '(' args ')'
A[173] = (rhs) => {
  const args = rhs[1] as unknown[];
  if (args.length === 1) return args[0];
  return new TupleLiteral(args as Expression[]);
};
// r174: postfix_index IDENTIFIER
A[174] = (rhs) => new Identifier(rhs[0] as string);
// r175: postfix_index IDENTIFIER '[' expression ']'
A[175] = (rhs) => new ArrayIndexExpr(rhs[0] as string, rhs[2] as any);
// r176: postfix_index postfix_index '[' expression ']'
A[176] = (rhs) => new ArrayIndexExpr("", rhs[2] as any, rhs[0] as any);
// r177: postfix_index postfix_index DOT IDENTIFIER  (M16 member access)
A[177] = (rhs) => new MemberAccessExpr(rhs[0] as any, rhs[2] as string);
// r178: args args ',' expression
A[178] = (rhs) => {
  const list = rhs[0] as unknown[];
  list.push(rhs[2]);
  return list;
};
// r179: args expression
A[179] = (rhs) => [rhs[0]];

// ---------------------------------------------------------------------------
// Entry point: the verified action table.
// ---------------------------------------------------------------------------

export const ACTIONS = A;

export function actionForRule(rule: number): Action {
  const fn = A[rule];
  if (!fn) throw new Error(`no action for rule ${rule}`);
  return fn;
}