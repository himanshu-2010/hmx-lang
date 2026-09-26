// AST mirror of src/ast.hpp — same node shapes, TypeKind order, and helper
// strings (ast.cpp) so the resolver/codegen ports stay faithful.

export enum TypeKind {
  Int = 0,
  Decimal = 1,
  Text = 2,
  Bool = 3,
  Char = 4,
  Byte = 5,
  Array = 6,
  Tuple = 7,
  Function = 8,
  Unknown = 9,
}

export interface FunctionTypeInfo {
  params: TypeDesc[];
  ret: TypeDesc;
}

export interface TypeDesc {
  type: TypeKind;
  elem: TypeDesc | null; // valid when type == Array (recursive)
  tuple_members: TypeDesc[]; // valid when type == Tuple
  fn_info: FunctionTypeInfo | null; // valid when type == Function
}

export function mkType(kind: TypeKind): TypeDesc {
  return { type: kind, elem: null, tuple_members: [], fn_info: null };
}

const EMPTY: TypeDesc = { type: TypeKind.Unknown, elem: null, tuple_members: [], fn_info: null };
export function emptyTypeDesc(): TypeDesc {
  return EMPTY;
}
export function elementOf(d: TypeDesc): TypeDesc {
  return d.elem ? d.elem : EMPTY;
}
export function arrayOf(e: TypeDesc): TypeDesc {
  return { type: TypeKind.Array, elem: e, tuple_members: [], fn_info: null };
}

export function typeDescEquals(a: TypeDesc, b: TypeDesc): boolean {
  if (a.type !== b.type) return false;
  if (a.elem != null || b.elem != null) {
    if (!a.elem || !b.elem) return false;
    if (!typeDescEquals(a.elem, b.elem)) return false;
  }
  if (!tupleMembersEquals(a.tuple_members, b.tuple_members)) return false;
  if (a.type === TypeKind.Function) {
    if (a.fn_info === b.fn_info) return true;
    if (!a.fn_info || !b.fn_info) return false;
    if (!tupleMembersEquals(a.fn_info.params, b.fn_info.params)) return false;
    return typeDescEquals(a.fn_info.ret, b.fn_info.ret);
  }
  return true;
}

function tupleMembersEquals(a: TypeDesc[], b: TypeDesc[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!typeDescEquals(a[i], b[i])) return false;
  return true;
}

/** C++ std::vector<TypeDesc>::operator== does elementwise ==. */
export function typeDescListEquals(a: TypeDesc[], b: TypeDesc[]): boolean {
  return tupleMembersEquals(a, b);
}

/** Port of TypeDesc::operator< (used only to mirror C++ ordering; kept for parity). */
export function typeDescLess(a: TypeDesc, b: TypeDesc): boolean {
  if (a.type !== b.type) return a.type < b.type;
  if (a.elem != null || b.elem != null) {
    if (!a.elem) return true;
    if (!b.elem) return false;
    if (!typeDescEquals(a.elem, b.elem)) return typeDescLess(a.elem, b.elem);
  }
  if (!tupleMembersEquals(a.tuple_members, b.tuple_members)) {
    // lexicographic comparison of member lists
    const n = Math.min(a.tuple_members.length, b.tuple_members.length);
    for (let i = 0; i < n; i++) {
      if (!typeDescEquals(a.tuple_members[i], b.tuple_members[i])) {
        return typeDescLess(a.tuple_members[i], b.tuple_members[i]);
      }
    }
    return a.tuple_members.length < b.tuple_members.length;
  }
  if (a.type === TypeKind.Function) {
    if (a.fn_info && b.fn_info) {
      if (!typeDescListEquals(a.fn_info.params, b.fn_info.params)) {
        const n = Math.min(a.fn_info.params.length, b.fn_info.params.length);
        for (let i = 0; i < n; i++) {
          if (!typeDescEquals(a.fn_info.params[i], b.fn_info.params[i])) {
            return typeDescLess(a.fn_info.params[i], b.fn_info.params[i]);
          }
        }
        return a.fn_info.params.length < b.fn_info.params.length;
      }
      return typeDescLess(a.fn_info.ret, b.fn_info.ret);
    }
    return b.fn_info != null;
  }
  return false;
}

// ---- type_to_* helpers (ast.cpp) ----

export function typeToC(kind: TypeKind): string {
  switch (kind) {
    case TypeKind.Int: return "int";
    case TypeKind.Decimal: return "double";
    case TypeKind.Text: return "char*";
    case TypeKind.Bool: return "int";
    case TypeKind.Char: return "char";
    case TypeKind.Byte: return "unsigned char";
    case TypeKind.Array: return "sd_array";
    case TypeKind.Tuple: return "sd_tuple";
    case TypeKind.Function: return "sd_closure";
    default: return "void";
  }
}

export function typeToFormat(kind: TypeKind): string {
  switch (kind) {
    case TypeKind.Int: return "%d";
    case TypeKind.Decimal: return "%f";
    case TypeKind.Text: return "%s";
    case TypeKind.Bool: return "%d";
    case TypeKind.Char: return "%c";
    case TypeKind.Byte: return "%d";
    case TypeKind.Array: return "%d";
    default: return "%d";
  }
}

export function typeToString(kind: TypeKind): string {
  switch (kind) {
    case TypeKind.Int: return "int";
    case TypeKind.Decimal: return "decimal";
    case TypeKind.Text: return "text";
    case TypeKind.Bool: return "bool";
    case TypeKind.Char: return "char";
    case TypeKind.Byte: return "byte";
    case TypeKind.Array: return "array";
    case TypeKind.Tuple: return "tuple";
    case TypeKind.Function: return "function";
    default: return "unknown";
  }
}

export function typeDescToString(d: TypeDesc): string {
  if (d.type === TypeKind.Array) {
    return "array of " + typeDescToString(elementOf(d));
  }
  if (d.type === TypeKind.Tuple) {
    return tupleTypeToString(d.tuple_members);
  }
  if (d.type === TypeKind.Function) {
    if (!d.fn_info) return "function";
    let s = "fn(";
    d.fn_info.params.forEach((p, i) => {
      if (i > 0) s += ", ";
      s += typeDescToString(p);
    });
    s += ") -> " + typeDescToString(d.fn_info.ret);
    return s;
  }
  return typeToString(d.type);
}

export function tupleTypeToString(members: TypeDesc[]): string {
  if (members.length === 0) return "tuple";
  let s = "(";
  members.forEach((m, i) => {
    if (i > 0) s += ", ";
    s += typeDescToString(m);
  });
  s += ")";
  return s;
}

// ---------------------------------------------------------------------------
// AST nodes (ast.hpp) — plain objects with a `kind` discriminator replacing
// dynamic_cast. `kind` values below mirror the C++ struct names.
// ---------------------------------------------------------------------------

export enum NodeKind {
  NumberLiteral,
  DecimalLiteral,
  StringLiteral,
  CharLiteral,
  BoolLiteral,
  Identifier,
  BinaryExpr,
  NotExpr,
  NegExpr,
  ConditionalExpr,
  CastExpr,
  CallExpr,
  ArrayLiteral,
  TupleLiteral,
  ArrayIndexExpr,
  VarDecl,
  AssignStmt,
  ArrayAssignStmt,
  ElementAssignStmt,
  DestructDecl,
  MultiAssignStmt,
  PrintStmt,
  LoopStmt,
  WhileStmt,
  ForStmt,
  DoWhileStmt,
  ForeachStmt,
  IfStmt,
  SwitchStmt,
  ReturnStmt,
  BreakStmt,
  ContinueStmt,
  FunctionDecl,
  LambdaExpr,
  ExprStmt,
}

export interface Expression {
  kind: NodeKind;
  resolved_type: TypeKind;
}
export interface Statement {
  kind: NodeKind;
  line: number;
  resolved_type: TypeKind;
  nl_id: number;
  nl_target: boolean;
  nl_owner: FunctionDecl | null;
}

export class NumberLiteral implements Expression {
  kind = NodeKind.NumberLiteral;
  resolved_type = TypeKind.Unknown;
  constructor(public value: number) {}
}
export class DecimalLiteral implements Expression {
  kind = NodeKind.DecimalLiteral;
  resolved_type = TypeKind.Unknown;
  constructor(public value: number) {}
}
export class StringLiteral implements Expression {
  kind = NodeKind.StringLiteral;
  resolved_type = TypeKind.Unknown;
  constructor(public value: string) {}
}
export class CharLiteral implements Expression {
  kind = NodeKind.CharLiteral;
  resolved_type = TypeKind.Unknown;
  constructor(public value: string) {}
}
export class BoolLiteral implements Expression {
  kind = NodeKind.BoolLiteral;
  resolved_type = TypeKind.Unknown;
  constructor(public value: boolean) {}
}
export class Identifier implements Expression {
  kind = NodeKind.Identifier;
  resolved_type = TypeKind.Unknown;
  is_function_reference = false;
  fn_type: TypeDesc = mkType(TypeKind.Unknown);
  constructor(public name: string) {}
}
export enum ExprKind {
  Arithmetic,
  Comparison,
  Logical,
}
export class BinaryExpr implements Expression {
  kind = NodeKind.BinaryExpr;
  resolved_type = TypeKind.Unknown;
  constructor(
    public op: string,
    public ekind: ExprKind,
    public left: Expression,
    public right: Expression
  ) {}
}
export class NotExpr implements Expression {
  kind = NodeKind.NotExpr;
  resolved_type = TypeKind.Unknown;
  constructor(public operand: Expression) {}
}
export class NegExpr implements Expression {
  kind = NodeKind.NegExpr;
  resolved_type = TypeKind.Unknown;
  constructor(public operand: Expression) {}
}
export class ConditionalExpr implements Expression {
  kind = NodeKind.ConditionalExpr;
  resolved_type = TypeKind.Unknown;
  constructor(
    public condition: Expression,
    public then_expr: Expression,
    public else_expr: Expression
  ) {}
}
export class CastExpr implements Expression {
  kind = NodeKind.CastExpr;
  resolved_type = TypeKind.Unknown;
  constructor(
    public target_type: TypeKind,
    public operand: Expression
  ) {}
}
export class CallExpr implements Expression {
  kind = NodeKind.CallExpr;
  resolved_type = TypeKind.Unknown;
  is_function_value_call = false;
  fn_type: TypeDesc = mkType(TypeKind.Unknown);
  array_aux: TypeDesc = mkType(TypeKind.Unknown);
  is_partial = false;
  partial_applied = 0;
  partial_full_params: TypeDesc[] = [];
  partial_params: TypeDesc[] = [];
  partial_ret: TypeDesc = mkType(TypeKind.Unknown);
  partial_ftype: TypeDesc = mkType(TypeKind.Unknown);
  constructor(
    public name: string,
    public args: Expression[]
  ) {}
}
export class ArrayLiteral implements Expression {
  kind = NodeKind.ArrayLiteral;
  resolved_type = TypeKind.Unknown;
  elem: TypeDesc = mkType(TypeKind.Unknown);
  constructor(public elements: Expression[]) {}
}
export class TupleLiteral implements Expression {
  kind = NodeKind.TupleLiteral;
  resolved_type = TypeKind.Unknown;
  resolved_members: TypeDesc[] = [];
  constructor(public values: Expression[]) {}
}
export class ArrayIndexExpr implements Expression {
  kind = NodeKind.ArrayIndexExpr;
  resolved_type = TypeKind.Unknown;
  base: Expression | null; // null => direct identifier form
  elem: TypeDesc = mkType(TypeKind.Unknown);
  is_tuple = false;
  is_text = false;
  member_index = -1;
  tuple_dynamic = false;
  tuple_arity = 0;
  constructor(
    public name: string,
    public index: Expression,
    base: Expression | null = null
  ) {
    this.base = base;
  }
}

export class VarDecl implements Statement {
  kind = NodeKind.VarDecl;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  annotation: TypeKind = TypeKind.Unknown;
  elem_desc: TypeDesc = mkType(TypeKind.Unknown);
  tuple_members: TypeDesc[] = [];
  annotation_desc: TypeDesc = mkType(TypeKind.Unknown);
  has_annotation = false;
  is_mutable = true;
  file = "";
  constructor(public name: string, public initializer: Expression) {}
}

export class AssignStmt implements Statement {
  kind = NodeKind.AssignStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(
    public name: string,
    public op: string,
    public rhs: Expression | null
  ) {}
}

export interface DestructPattern {
  name: string;
  items: DestructPattern[];
  nested: boolean;
  is_rest: boolean;
  vdesc: TypeDesc;
}
export function mkPattern(name: string): DestructPattern {
  return { name, items: [], nested: false, is_rest: false, vdesc: mkType(TypeKind.Unknown) };
}

export class MultiAssignStmt implements Statement {
  kind = NodeKind.MultiAssignStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  tuple_members: TypeDesc[] = [];
  destruct_type: TypeKind = TypeKind.Unknown;
  destruct_elem: TypeDesc = mkType(TypeKind.Unknown);
  constructor(public patterns: DestructPattern[], public rhs: Expression) {}
}

export class DestructDecl implements Statement {
  kind = NodeKind.DestructDecl;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  is_mutable = true;
  file = "";
  tuple_members: TypeDesc[] = [];
  destruct_type: TypeKind = TypeKind.Unknown;
  destruct_elem: TypeDesc = mkType(TypeKind.Unknown);
  constructor(public patterns: DestructPattern[], public rhs: Expression) {}
}

export class ArrayAssignStmt implements Statement {
  kind = NodeKind.ArrayAssignStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(
    public name: string,
    public index: Expression,
    public rhs: Expression
  ) {}
}

export class ElementAssignStmt implements Statement {
  kind = NodeKind.ElementAssignStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public target: ArrayIndexExpr, public rhs: Expression) {}
}

export class PrintStmt implements Statement {
  kind = NodeKind.PrintStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public args: Expression[]) {}
}

export class LoopStmt implements Statement {
  kind = NodeKind.LoopStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public count: Expression, public body: Statement[]) {}
}

export class WhileStmt implements Statement {
  kind = NodeKind.WhileStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public condition: Expression, public body: Statement[]) {}
}

export class ForStmt implements Statement {
  kind = NodeKind.ForStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(
    public init: Statement,
    public condition: Expression,
    public update: Statement,
    public body: Statement[]
  ) {}
}

export class DoWhileStmt implements Statement {
  kind = NodeKind.DoWhileStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public body: Statement[], public condition: Expression) {}
}

export class ForeachStmt implements Statement {
  kind = NodeKind.ForeachStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  elem: TypeDesc = mkType(TypeKind.Unknown);
  constructor(
    public value_name: string,
    public index_name: string,
    public iterable: Expression,
    public body: Statement[]
  ) {}
}

export class IfStmt implements Statement {
  kind = NodeKind.IfStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  has_else = false;
  constructor(
    public condition: Expression,
    public then_body: Statement[],
    public else_body: Statement[]
  ) {}
}

export interface SwitchCase {
  value: Expression | null;
  body: Statement[];
  is_default: boolean;
}

export class SwitchStmt implements Statement {
  kind = NodeKind.SwitchStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public value: Expression, public cases: SwitchCase[]) {}
}

export interface CapturedVar {
  name: string;
  desc: TypeDesc;
}

export interface Param {
  name: string;
  type: TypeKind;
  elem_desc: TypeDesc;
  tuple_members: TypeDesc[];
  desc: TypeDesc;
  default_value: Expression | null;
  variadic: boolean;
}
export function mkParam(name: string): Param {
  return {
    name,
    type: TypeKind.Unknown,
    elem_desc: mkType(TypeKind.Unknown),
    tuple_members: [],
    desc: mkType(TypeKind.Unknown),
    default_value: null,
    variadic: false,
  };
}

export class FunctionDecl implements Statement {
  kind = NodeKind.FunctionDecl;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  file = "";
  is_lambda = false;
  params: Param[] = [];
  return_type: TypeKind = TypeKind.Unknown;
  return_elem: TypeDesc = mkType(TypeKind.Unknown);
  return_tuple_members: TypeDesc[] = [];
  return_desc: TypeDesc = mkType(TypeKind.Unknown);
  has_return_type = false;
  body: Statement[] = [];
  captures: CapturedVar[] = [];
  has_nonlocal = false;
  nl_target_loop_id = -1;
  nl_use_break = false;
  nl_use_continue = false;
  constructor(public name: string) {}
}

export class ReturnStmt implements Statement {
  kind = NodeKind.ReturnStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  return_tuple_members: TypeDesc[] = [];
  constructor(public values: Expression[]) {}
}

export class LambdaExpr implements Expression {
  kind = NodeKind.LambdaExpr;
  resolved_type = TypeKind.Unknown;
  params: Param[] = [];
  return_type: TypeKind = TypeKind.Unknown;
  return_elem: TypeDesc = mkType(TypeKind.Unknown);
  return_tuple_members: TypeDesc[] = [];
  return_desc: TypeDesc = mkType(TypeKind.Unknown);
  has_return_type = false;
  body: Statement[] = [];
  line = 0;
  resolved: FunctionDecl | null = null;
  lambda_type: TypeDesc = mkType(TypeKind.Unknown);
}

export class BreakStmt implements Statement {
  kind = NodeKind.BreakStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  nonlocal = false;
}
export class ContinueStmt implements Statement {
  kind = NodeKind.ContinueStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  nonlocal = false;
}

export class ExprStmt implements Statement {
  kind = NodeKind.ExprStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(public expr: Expression) {}
}

export interface Program {
  statements: Statement[];
  use_files: string[];
  source_file: string;
}