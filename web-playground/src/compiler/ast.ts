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
  Struct = 9,
  Enum = 10,
  Unknown = 11,
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
  /** Nominal name of a declared type (Struct/Enum), or a transient marker for
   * a referenced type name before the resolver expands it (Unknown + name).
   * M17.3: type_args holds the concrete type arguments of a generic
   * instantiation (`Box[int]` -> base name "Box", args [int]). */
  type_name: string;
  type_args: TypeDesc[];
}

export function mkType(kind: TypeKind): TypeDesc {
  return { type: kind, elem: null, tuple_members: [], fn_info: null, type_name: "", type_args: [] };
}

const EMPTY: TypeDesc = { type: TypeKind.Unknown, elem: null, tuple_members: [], fn_info: null, type_name: "", type_args: [] };
export function emptyTypeDesc(): TypeDesc {
  return EMPTY;
}
export function elementOf(d: TypeDesc): TypeDesc {
  return d.elem ? d.elem : EMPTY;
}
export function arrayOf(e: TypeDesc): TypeDesc {
  return { type: TypeKind.Array, elem: e, tuple_members: [], fn_info: null, type_name: "", type_args: [] };
}

export function typeDescEquals(a: TypeDesc, b: TypeDesc): boolean {
  if (a.type !== b.type) return false;
  if (a.elem != null || b.elem != null) {
    if (!a.elem || !b.elem) return false;
    if (!typeDescEquals(a.elem, b.elem)) return false;
  }
  if (!tupleMembersEquals(a.tuple_members, b.tuple_members)) return false;
  if (a.type === TypeKind.Struct || a.type === TypeKind.Enum) {
    // M17.3: `Box[int]` and `Box[text]` share the base name; the type
    // arguments are what make the specializations distinct.
    return a.type_name === b.type_name && typeDescListEquals(a.type_args, b.type_args);
  }
  if (a.type === TypeKind.Function) {
    if (a.fn_info === b.fn_info) return true;
    if (!a.fn_info || !b.fn_info) return false;
    if (!tupleMembersEquals(a.fn_info.params, b.fn_info.params)) return false;
    return typeDescEquals(a.fn_info.ret, b.fn_info.ret);
  }
  // Primitive kinds have an empty type_name; named-type markers (Unknown +
  // type_name, possibly with type arguments) must compare their reference.
  return a.type_name === b.type_name && typeDescListEquals(a.type_args, b.type_args);
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
  if (a.type === TypeKind.Struct || a.type === TypeKind.Enum) {
    if (a.type_name !== b.type_name) return a.type_name < b.type_name;
    return typeDescListLess(a.type_args, b.type_args);
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
  if (a.type_name !== b.type_name) return a.type_name < b.type_name;
  return typeDescListLess(a.type_args, b.type_args);
}

/** Lexicographic vector<TypeDesc> comparison (std::vector::operator<). */
function typeDescListLess(a: TypeDesc[], b: TypeDesc[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (!typeDescEquals(a[i], b[i])) return typeDescLess(a[i], b[i]);
  }
  return a.length < b.length;
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
    case TypeKind.Enum: return "int";
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
    case TypeKind.Enum: return "%d";
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
    case TypeKind.Struct: return "struct";
    case TypeKind.Enum: return "enum";
    default: return "unknown";
  }
}

function typeArgsToString(d: TypeDesc): string {
  if (d.type_args.length === 0) return "";
  let s = "[";
  d.type_args.forEach((a, i) => {
    if (i > 0) s += ", ";
    s += typeDescToString(a);
  });
  s += "]";
  return s;
}

export function typeDescToString(d: TypeDesc): string {
  if (d.type === TypeKind.Struct || d.type === TypeKind.Enum) {
    return d.type_name !== "" ? d.type_name + typeArgsToString(d) : typeToString(d.type);
  }
  // A not-yet-expanded named-type reference prints as its name.
  if (d.type === TypeKind.Unknown && d.type_name !== "") return d.type_name + typeArgsToString(d);
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

// M17.3: C-identifier-safe encoding of a concrete descriptor, used to name
// generic instantiations (`__gen_f_n_Box__int`). Structs and enums mangle by
// their specialization key so `Box[int]` and `Box[text]` never collide.
export function typeMangle(d: TypeDesc): string {
  switch (d.type) {
    case TypeKind.Int: return "int";
    case TypeKind.Decimal: return "dec";
    case TypeKind.Text: return "text";
    case TypeKind.Bool: return "bool";
    case TypeKind.Char: return "char";
    case TypeKind.Byte: return "byte";
    case TypeKind.Array: return "arr_" + typeMangle(elementOf(d));
    case TypeKind.Tuple: {
      let s = "tup";
      for (const m of d.tuple_members) s += "_" + typeMangle(m);
      return s;
    }
    case TypeKind.Function: {
      let s = "fn";
      if (d.fn_info) {
        for (const p of d.fn_info.params) s += "_" + typeMangle(p);
        s += "_r_" + typeMangle(d.fn_info.ret);
      }
      return s;
    }
    case TypeKind.Struct:
    case TypeKind.Enum:
      return "n_" + typeInstName(d);
    case TypeKind.Unknown:
      return d.type_name === "" ? "unk" : "n_" + typeInstName(d);
  }
  return "unk";
}

/** Canonical key of a type's specialization: the plain declared name when the
 * type takes no type arguments, `Box__int` for `Box[int]`. */
export function typeInstName(d: TypeDesc): string {
  if (d.type_name === "" || d.type_args.length === 0) return d.type_name;
  let s = d.type_name + "__";
  d.type_args.forEach((a, i) => {
    if (i > 0) s += "_";
    s += typeMangle(a);
  });
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
  MemberAccessExpr,
  MemberAssignStmt,
  TypeDecl,
  DeferStmt,
  TryStmt,
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
  /** struct construction, set by resolver when name is a user-declared struct type */
  is_struct_ctor = false;
  struct_ctor_name = "";
  struct_ctor_fields: TypeDesc[] = [];
  struct_ctor_desc: TypeDesc = mkType(TypeKind.Unknown);
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

/** base.member — struct field access or enum member reference (`Color.Red`). */
export class MemberAccessExpr implements Expression {
  kind = NodeKind.MemberAccessExpr;
  resolved_type = TypeKind.Unknown;
  /** enum member reference (base was an enum type name) */
  is_enum_member = false;
  enum_type_name = "";
  enum_index = -1;
  /** struct field access */
  is_field = false;
  struct_name = "";
  field_index = -1;
  field_desc: TypeDesc = mkType(TypeKind.Unknown);
  constructor(public base: Expression, public member: string) {}
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

/** member assignment: base.member = rhs (also compound and ++ / --). */
export class MemberAssignStmt implements Statement {
  kind = NodeKind.MemberAssignStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  struct_name = "";
  field_index = -1;
  field_desc: TypeDesc = mkType(TypeKind.Unknown);
  constructor(
    public base: Expression,
    public member: string,
    public op: string,
    public rhs: Expression | null
  ) {}
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
  /** M17: `[T, U]` type-parameter list. Non-empty marks a monomorphized
   * template (never resolved or emitted directly). */
  type_params: string[] = [];
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

/** M18 `defer { ... }` / `defer expr`: runs when the enclosing block exits,
 * newest first. `id` is assigned by codegen for the runtime guard flag. */
export class DeferStmt implements Statement {
  kind = NodeKind.DeferStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  id = -1;
  constructor(public body: Statement[]) {}
}

/** M18.2 `try { ... } catch (e) { ... }`: a runtime fault unwinds to the
 * handler, which binds the message as text. */
export class TryStmt implements Statement {
  kind = NodeKind.TryStmt;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  constructor(
    public body: Statement[],
    public handler: Statement[],
    public error_name: string
  ) {}
}

// ---- M16 type declarations (alias / struct / enum) ----

export enum TypeDeclKind {
  Alias,
  Struct,
  Enum,
}

/** One field of a user-declared struct type. */
export interface StructFieldInfo {
  name: string;
  desc: TypeDesc;
}

/** A top-level type declaration. */
export class TypeDecl implements Statement {
  kind = NodeKind.TypeDecl;
  line = 0;
  resolved_type = TypeKind.Unknown;
  nl_id = -1;
  nl_target = false;
  nl_owner: FunctionDecl | null = null;
  file = "";
  tdecl_kind = TypeDeclKind.Alias;
  /** M17/M17.3: type parameters of a generic fn/struct template
   * (`struct Box[T]`); empty for ordinary declarations. */
  type_params: string[] = [];
  alias_target: TypeDesc = mkType(TypeKind.Unknown);
  fields: StructFieldInfo[] = [];
  variants: string[] = [];
  constructor(public name: string) {}
}

export interface Program {
  statements: Statement[];
  use_files: string[];
  source_file: string;
}

// ---------------------------------------------------------------------------
// Deep-AST safety (mirrors src/ast.cpp / src/ast.hpp)
// ---------------------------------------------------------------------------
// The native parser reduces left-recursive chains (`1+1+...+1`) without growing
// the bison stack, so a modest source can build an AST whose depth is bounded
// only by the input size; every recursive walk over it (the type resolver, the
// default destructor) would then overflow the C stack. Native therefore rejects
// any program deeper than HMX_MAX_NESTING *before* running a recursive walk.
// The browser resolver is recursive too (it would throw a RangeError around
// ~10k), so the same guard runs first with the same message and line, keeping
// the playground in step with the CLI.

/** Maximum expression/statement nesting depth; must equal HMX_MAX_NESTING. */
export const HMX_MAX_NESTING = 200;

type AstNode = Expression | Statement;

// Enumerate a node's direct children, mirroring gather_children() in
// src/ast.cpp (in the same order). MUST stay in sync with the node classes
// above: a node type added without a branch here would hide its subtree, so a
// deep program of that shape would slip past the guard.
function gatherChildren(node: AstNode, out: AstNode[]): void {
  const push = (n: AstNode | null | undefined): void => {
    if (n) out.push(n);
  };
  const pushList = (v: (AstNode | null | undefined)[]): void => {
    for (const n of v) if (n) out.push(n);
  };
  if (node instanceof BinaryExpr) {
    push(node.left);
    push(node.right);
  } else if (node instanceof NotExpr) {
    push(node.operand);
  } else if (node instanceof NegExpr) {
    push(node.operand);
  } else if (node instanceof ConditionalExpr) {
    push(node.condition);
    push(node.then_expr);
    push(node.else_expr);
  } else if (node instanceof CastExpr) {
    push(node.operand);
  } else if (node instanceof CallExpr) {
    pushList(node.args);
  } else if (node instanceof ArrayLiteral) {
    pushList(node.elements);
  } else if (node instanceof TupleLiteral) {
    pushList(node.values);
  } else if (node instanceof ArrayIndexExpr) {
    push(node.base);
    push(node.index);
  } else if (node instanceof MemberAccessExpr) {
    push(node.base);
  } else if (node instanceof LambdaExpr) {
    pushList(node.body);
  } else if (node instanceof VarDecl) {
    push(node.initializer);
  } else if (node instanceof AssignStmt) {
    push(node.rhs);
  } else if (node instanceof MultiAssignStmt) {
    push(node.rhs);
  } else if (node instanceof DestructDecl) {
    push(node.rhs);
  } else if (node instanceof ArrayAssignStmt) {
    push(node.index);
    push(node.rhs);
  } else if (node instanceof ElementAssignStmt) {
    push(node.target);
    push(node.rhs);
  } else if (node instanceof MemberAssignStmt) {
    push(node.base);
    push(node.rhs);
  } else if (node instanceof PrintStmt) {
    pushList(node.args);
  } else if (node instanceof LoopStmt) {
    push(node.count);
    pushList(node.body);
  } else if (node instanceof WhileStmt) {
    push(node.condition);
    pushList(node.body);
  } else if (node instanceof ForStmt) {
    push(node.init);
    push(node.condition);
    push(node.update);
    pushList(node.body);
  } else if (node instanceof DoWhileStmt) {
    pushList(node.body);
    push(node.condition);
  } else if (node instanceof ForeachStmt) {
    push(node.iterable);
    pushList(node.body);
  } else if (node instanceof IfStmt) {
    push(node.condition);
    pushList(node.then_body);
    pushList(node.else_body);
  } else if (node instanceof SwitchStmt) {
    push(node.value);
    for (const c of node.cases) {
      push(c.value);
      pushList(c.body);
    }
  } else if (node instanceof FunctionDecl) {
    for (const p of node.params) push(p.default_value);
    pushList(node.body);
  } else if (node instanceof ReturnStmt) {
    pushList(node.values);
  } else if (node instanceof ExprStmt) {
    push(node.expr);
  } else if (node instanceof DeferStmt) {
    pushList(node.body);
  } else if (node instanceof TryStmt) {
    pushList(node.body);
    pushList(node.handler);
  }
  // NumberLiteral / DecimalLiteral / StringLiteral / CharLiteral /
  // BoolLiteral / Identifier / BreakStmt / ContinueStmt / TypeDecl:
  // no children.
}

// The line the guard should cite for a node. Only statements carry one;
// LambdaExpr is an expression that also has a line and must not win, matching
// source_line() in src/ast.hpp where every Expression returns 0.
function nodeLine(node: AstNode): number {
  if (node instanceof LambdaExpr) return 0;
  const l = (node as { line?: number }).line;
  return typeof l === "number" ? l : 0;
}

/**
 * Depth of the deepest node in `program` (the Program itself is depth 1), and
 * the line of the deepest statement (0 if none). Iterative, with an explicit
 * work list, so it is safe at any input depth and never uses the JS call stack.
 */
export function astMaxDepth(program: Program): { depth: number; line: number } {
  let bestDepth = 1;
  let bestStmtDepth = -1;
  let bestStmtLine = 0;
  const stack: { node: AstNode; depth: number }[] = [];
  // Mirror src/ast.cpp exactly: the Program is depth 1 and children are pushed
  // in *forward* order, so the LIFO pop visits the LAST child first. That order
  // decides which statement wins a depth tie, and the parity gate checks the
  // cited line byte-for-byte.
  for (const s of program.statements) {
    stack.push({ node: s, depth: 2 });
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.depth > bestDepth) bestDepth = frame.depth;
    const line = nodeLine(frame.node);
    if (line > 0 && frame.depth > bestStmtDepth) {
      bestStmtDepth = frame.depth;
      bestStmtLine = line;
    }
    const kids: AstNode[] = [];
    gatherChildren(frame.node, kids);
    for (const k of kids) {
      stack.push({ node: k, depth: frame.depth + 1 });
    }
  }
  return { depth: bestDepth, line: bestStmtLine };
}

/**
 * M17: structural deep copy of an AST subtree, used to monomorphize generic
 * templates. Templates are never resolved, so every resolver-synthesized field
 * is already at its default and a blanket copy is equivalent to the native
 * `clone_stmt` (which additionally resets that default bookkeeping). The
 * prototype is preserved so `instanceof`/`kind` checks keep working.
 */
/**
 * M17: structural copy of an AST subtree, used to monomorphize generic
 * templates. Mirrors the native `clone_stmt`/`clone_expr` in src/ast.cpp: only
 * semantic fields are copied — resolver-synthesized bookkeeping (and the
 * `nl_owner` back-pointer, which would form a cycle) is left at its default.
 * `line` is preserved so diagnostics on instantiated code cite the template.
 */
export function deepCloneAst<T>(node: T): T {
  if (isStatement(node)) return cloneStmt(node as unknown as Statement) as unknown as T;
  if (isExpression(node)) return cloneExpr(node as unknown as Expression) as unknown as T;
  if (node && typeof node === "object" && typeof (node as unknown as TypeDesc).type === "number") {
    return cloneTypeDesc(node as unknown as TypeDesc) as unknown as T;
  }
  return node;
}

function cloneTypeDesc(d: TypeDesc): TypeDesc {
  return {
    type: d.type,
    elem: d.elem ? cloneTypeDesc(d.elem) : null,
    tuple_members: d.tuple_members.map(cloneTypeDesc),
    fn_info: d.fn_info
      ? { params: d.fn_info.params.map(cloneTypeDesc), ret: cloneTypeDesc(d.fn_info.ret) }
      : null,
    type_name: d.type_name,
    type_args: d.type_args.map(cloneTypeDesc),
  };
}

function cloneParam(p: Param): Param {
  const q = mkParam(p.name);
  q.type = p.type;
  q.elem_desc = cloneTypeDesc(p.elem_desc);
  q.tuple_members = p.tuple_members.map(cloneTypeDesc);
  q.desc = cloneTypeDesc(p.desc);
  q.default_value = p.default_value ? cloneExpr(p.default_value) : null;
  q.variadic = p.variadic;
  return q;
}

function clonePattern(p: DestructPattern): DestructPattern {
  const q = mkPattern(p.name);
  q.is_rest = p.is_rest;
  q.nested = p.nested;
  q.items = p.items.map(clonePattern);
  return q;
}

function isExpression(node: unknown): node is Expression {
  return (
    node instanceof NumberLiteral ||
    node instanceof DecimalLiteral ||
    node instanceof StringLiteral ||
    node instanceof CharLiteral ||
    node instanceof BoolLiteral ||
    node instanceof Identifier ||
    node instanceof BinaryExpr ||
    node instanceof NotExpr ||
    node instanceof NegExpr ||
    node instanceof ConditionalExpr ||
    node instanceof CastExpr ||
    node instanceof CallExpr ||
    node instanceof ArrayLiteral ||
    node instanceof TupleLiteral ||
    node instanceof ArrayIndexExpr ||
    node instanceof MemberAccessExpr ||
    node instanceof LambdaExpr
  );
}

function isStatement(node: unknown): node is Statement {
  return (
    node instanceof TypeDecl ||
    node instanceof VarDecl ||
    node instanceof AssignStmt ||
    node instanceof MultiAssignStmt ||
    node instanceof DestructDecl ||
    node instanceof ArrayAssignStmt ||
    node instanceof ElementAssignStmt ||
    node instanceof MemberAssignStmt ||
    node instanceof PrintStmt ||
    node instanceof LoopStmt ||
    node instanceof WhileStmt ||
    node instanceof ForStmt ||
    node instanceof DoWhileStmt ||
    node instanceof ForeachStmt ||
    node instanceof IfStmt ||
    node instanceof SwitchStmt ||
    node instanceof FunctionDecl ||
    node instanceof ReturnStmt ||
    node instanceof BreakStmt ||
    node instanceof ContinueStmt ||
    node instanceof ExprStmt ||
    node instanceof DeferStmt ||
    node instanceof TryStmt
  );
}

function cloneExpr<T extends Expression>(e: T): T {
  if (e instanceof NumberLiteral) return new NumberLiteral(e.value) as unknown as T;
  if (e instanceof DecimalLiteral) return new DecimalLiteral(e.value) as unknown as T;
  if (e instanceof StringLiteral) return new StringLiteral(e.value) as unknown as T;
  if (e instanceof CharLiteral) return new CharLiteral(e.value) as unknown as T;
  if (e instanceof BoolLiteral) return new BoolLiteral(e.value) as unknown as T;
  if (e instanceof Identifier) return new Identifier(e.name) as unknown as T;
  if (e instanceof BinaryExpr) {
    return new BinaryExpr(e.op, e.ekind, cloneExpr(e.left), cloneExpr(e.right)) as unknown as T;
  }
  if (e instanceof NotExpr) return new NotExpr(cloneExpr(e.operand)) as unknown as T;
  if (e instanceof NegExpr) return new NegExpr(cloneExpr(e.operand)) as unknown as T;
  if (e instanceof ConditionalExpr) {
    return new ConditionalExpr(
      cloneExpr(e.condition),
      cloneExpr(e.then_expr),
      cloneExpr(e.else_expr)
    ) as unknown as T;
  }
  if (e instanceof CastExpr) return new CastExpr(e.target_type, cloneExpr(e.operand)) as unknown as T;
  if (e instanceof CallExpr) {
    return new CallExpr(
      e.name,
      e.args.map((a) => cloneExpr(a))
    ) as unknown as T;
  }
  if (e instanceof ArrayLiteral) {
    return new ArrayLiteral(e.elements.map(cloneExpr)) as unknown as T;
  }
  if (e instanceof TupleLiteral) {
    return new TupleLiteral(e.values.map(cloneExpr)) as unknown as T;
  }
  if (e instanceof ArrayIndexExpr) {
    const base = e.base ? cloneExpr(e.base) : null;
    return new ArrayIndexExpr(e.name, cloneExpr(e.index), base) as unknown as T;
  }
  if (e instanceof MemberAccessExpr) {
    return new MemberAccessExpr(cloneExpr(e.base), e.member) as unknown as T;
  }
  if (e instanceof LambdaExpr) {
    const out = new LambdaExpr();
    out.params = e.params.map(cloneParam);
    out.has_return_type = e.has_return_type;
    out.return_type = e.return_type;
    out.return_elem = cloneTypeDesc(e.return_elem);
    out.return_tuple_members = e.return_tuple_members.map(cloneTypeDesc);
    out.return_desc = cloneTypeDesc(e.return_desc);
    out.body = e.body.map(cloneStmt);
    out.line = e.line;
    return out as unknown as T;
  }
  throw new Error(`deepCloneAst: cannot clone expression ${(e as object).constructor.name}`);
}

function cloneStmt<T extends Statement>(s: T): T {
  if (s instanceof VarDecl) {
    const out = new VarDecl(s.name, cloneExpr(s.initializer));
    out.file = s.file;
    out.annotation = s.annotation;
    out.elem_desc = cloneTypeDesc(s.elem_desc);
    out.tuple_members = s.tuple_members.map(cloneTypeDesc);
    out.annotation_desc = cloneTypeDesc(s.annotation_desc);
    out.has_annotation = s.has_annotation;
    out.is_mutable = s.is_mutable;
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof AssignStmt) {
    const out = new AssignStmt(s.name, s.op, s.rhs ? cloneExpr(s.rhs) : null);
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof MultiAssignStmt) {
    const out = new MultiAssignStmt(s.patterns.map(clonePattern), cloneExpr(s.rhs));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof DestructDecl) {
    const out = new DestructDecl(s.patterns.map(clonePattern), cloneExpr(s.rhs));
    out.is_mutable = s.is_mutable;
    out.file = s.file;
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ArrayAssignStmt) {
    const out = new ArrayAssignStmt(s.name, cloneExpr(s.index), cloneExpr(s.rhs));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ElementAssignStmt) {
    const out = new ElementAssignStmt(cloneExpr(s.target) as ArrayIndexExpr, cloneExpr(s.rhs));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof MemberAssignStmt) {
    const out = new MemberAssignStmt(
      cloneExpr(s.base),
      s.member,
      s.op,
      s.rhs ? cloneExpr(s.rhs) : null
    );
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof PrintStmt) {
    const out = new PrintStmt(s.args.map(cloneExpr));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof LoopStmt) {
    const out = new LoopStmt(cloneExpr(s.count), s.body.map(cloneStmt));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof WhileStmt) {
    const out = new WhileStmt(cloneExpr(s.condition), s.body.map(cloneStmt));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ForStmt) {
    const out = new ForStmt(
      cloneStmt(s.init),
      cloneExpr(s.condition),
      cloneStmt(s.update),
      s.body.map(cloneStmt)
    );
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof DoWhileStmt) {
    const out = new DoWhileStmt(s.body.map(cloneStmt), cloneExpr(s.condition));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ForeachStmt) {
    const out = new ForeachStmt(
      s.value_name,
      s.index_name,
      cloneExpr(s.iterable),
      s.body.map(cloneStmt)
    );
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof IfStmt) {
    const out = new IfStmt(cloneExpr(s.condition), s.then_body.map(cloneStmt), s.else_body.map(cloneStmt));
    out.has_else = s.has_else;
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof SwitchStmt) {
    const out = new SwitchStmt(
      cloneExpr(s.value),
      s.cases.map((c) => ({
        value: c.value ? cloneExpr(c.value) : null,
        body: c.body.map(cloneStmt),
        is_default: c.is_default,
      }))
    );
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof FunctionDecl) {
    const out = new FunctionDecl(s.name);
    out.file = s.file;
    out.type_params = s.type_params.slice();
    out.is_lambda = s.is_lambda;
    out.params = s.params.map(cloneParam);
    out.return_type = s.return_type;
    out.return_elem = cloneTypeDesc(s.return_elem);
    out.return_tuple_members = s.return_tuple_members.map(cloneTypeDesc);
    out.return_desc = cloneTypeDesc(s.return_desc);
    out.has_return_type = s.has_return_type;
    out.body = s.body.map(cloneStmt);
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ReturnStmt) {
    const out = new ReturnStmt(s.values.map(cloneExpr));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof BreakStmt) {
    const out = new BreakStmt();
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ContinueStmt) {
    const out = new ContinueStmt();
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof ExprStmt) {
    const out = new ExprStmt(cloneExpr(s.expr));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof DeferStmt) {
    const out = new DeferStmt(s.body.map(cloneStmt));
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof TryStmt) {
    const out = new TryStmt(
      s.body.map(cloneStmt),
      s.handler.map(cloneStmt),
      s.error_name
    );
    out.line = s.line;
    return out as unknown as T;
  }
  if (s instanceof TypeDecl) {
    const out = new TypeDecl(s.name);
    out.tdecl_kind = s.tdecl_kind;
    out.type_params = s.type_params.slice();
    out.file = s.file;
    out.alias_target = cloneTypeDesc(s.alias_target);
    out.fields = s.fields.map((f) => ({ name: f.name, desc: cloneTypeDesc(f.desc) }));
    out.variants = s.variants.slice();
    out.line = s.line;
    return out as unknown as T;
  }
  throw new Error(`deepCloneAst: cannot clone statement ${(s as object).constructor.name}`);
}