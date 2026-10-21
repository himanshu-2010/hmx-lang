// TypeResolver — a full port of src/type_resolver.cpp (1,983 lines).
// dynamic_cast becomes instanceof checks on the ast.ts class hierarchy.
// Error messages must match native verbatim (the parity contract).

import type {
  Expression,
  FunctionTypeInfo,
  Param,
  Program,
  Statement,
  TypeDesc,
} from "./ast";
import {
  ArrayAssignStmt,
  ArrayIndexExpr,
  ArrayLiteral,
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
  DeferStmt,
  DestructDecl,
  DoWhileStmt,
  ElementAssignStmt,
  ExprKind,
  ExprStmt,
  ForStmt,
  ForeachStmt,
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
  elementOf,
  mkType,
  typeDescEquals,
  typeDescToString,
  typeDescListEquals,
  typeInstName,
  typeMangle,
  typeToString,
  tupleTypeToString,
  HMX_MAX_NESTING,
  astMaxDepth,
  deepCloneAst,
} from "./ast";

// ---------------------------------------------------------------------------
// Module-level helpers (mirroring the file-static helpers in type_resolver.cpp)
// ---------------------------------------------------------------------------

/** First `defer` reachable without crossing a nested function boundary. */
function findDeferStmt(stmts: Statement[]): DeferStmt | null {
  for (const s of stmts) {
    if (s instanceof DeferStmt) return s;
    if (s instanceof IfStmt) {
      const d = findDeferStmt(s.then_body) ?? findDeferStmt(s.else_body);
      if (d) return d;
    } else if (s instanceof SwitchStmt) {
      for (const c of s.cases) {
        const d = findDeferStmt(c.body);
        if (d) return d;
      }
    } else if (
      s instanceof LoopStmt ||
      s instanceof ForeachStmt ||
      s instanceof WhileStmt ||
      s instanceof ForStmt ||
      s instanceof DoWhileStmt
    ) {
      const d = findDeferStmt(s.body);
      if (d) return d;
    }
  }
  return null;
}

/** First return/break/continue reachable in a defer body. */
function findDeferExit(stmts: Statement[]): Statement | null {
  for (const s of stmts) {
    if (s instanceof ReturnStmt || s instanceof BreakStmt || s instanceof ContinueStmt) return s;
    if (s instanceof DeferStmt) {
      const x = findDeferExit(s.body);
      if (x) return x;
    } else if (s instanceof IfStmt) {
      const x = findDeferExit(s.then_body) ?? findDeferExit(s.else_body);
      if (x) return x;
    } else if (s instanceof SwitchStmt) {
      for (const c of s.cases) {
        const x = findDeferExit(c.body);
        if (x) return x;
      }
    } else if (
      s instanceof LoopStmt ||
      s instanceof ForeachStmt ||
      s instanceof WhileStmt ||
      s instanceof ForStmt ||
      s instanceof DoWhileStmt
    ) {
      const x = findDeferExit(s.body);
      if (x) return x;
    }
  }
  return null;
}

function paramTypeDesc(p: { desc: TypeDesc; type: TypeKind; elem_desc: TypeDesc; tuple_members: TypeDesc[] }): TypeDesc {
  // A named-type reference ({Unknown, type_name}) is a transient marker the
  // expansion pass resolves; surface it so callers see the name pre-expansion.
  if (p.desc.type !== TypeKind.Unknown || p.desc.type_name !== "") return p.desc;
  const d = mkType(p.type);
  d.elem = p.elem_desc.elem;
  d.tuple_members = p.tuple_members;
  return d;
}

function descFullyKnown(d: TypeDesc): boolean {
  if (d.type === TypeKind.Unknown) return false;
  if (d.type === TypeKind.Array) return descFullyKnown(elementOf(d));
  return true;
}

/** Fills type-denoting empty literals ([]) from the annotation's element
 *  descriptor and returns true when the resulting descriptor matches. */
function fixEmptyArrayLiteral(arr: ArrayLiteral, targetElem: TypeDesc): boolean {
  if (
    arr.elements.length === 0 &&
    (arr.elem.elem == null || elementOf(arr.elem).type === TypeKind.Unknown)
  ) {
    arr.elem = targetElem;
    return true;
  }
  if (arr.elem.type === TypeKind.Array && targetElem.type === TypeKind.Array) {
    if (arr.elements.length === 0) {
      arr.elem = targetElem;
      return true;
    }
    for (const e of arr.elements) {
      if (e instanceof ArrayLiteral) {
        if (!fixEmptyArrayLiteral(e, elementOf(targetElem))) return false;
      }
    }
    if (elementOf(arr.elem).type === TypeKind.Unknown) {
      arr.elem = targetElem;
      return true;
    }
    return typeDescEquals(arr.elem, targetElem);
  }
  return typeDescEquals(arr.elem, targetElem);
}

// ---------------------------------------------------------------------------

export interface SymbolEntry {
  type: TypeKind;
  is_mutable: boolean;
  elem: TypeDesc;
  tuple_members: TypeDesc[];
  desc: TypeDesc;
}

export interface FunctionSig {
  param_types: TypeKind[];
  param_elems: TypeDesc[];
  param_tuple_members: TypeDesc[][];
  param_descs: TypeDesc[];
  param_has_default: boolean[];
  variadic: boolean;
  variadic_elem: TypeDesc;
  return_type: TypeKind;
  return_elem: TypeDesc;
  return_tuple_members: TypeDesc[];
  return_desc: TypeDesc;
  has_return: boolean;
  fn_type: TypeDesc;
}

/** M17: a generic function declaration, kept aside as a monomorphization
 *  template. It is never registered in `functions_`/`fn_decls_` and produces
 *  no code; each distinct call-site inference clones and resolves it. */
interface GenericTemplate {
  decl: FunctionDecl;
  type_params: Set<string>;
}

export class CompileError extends Error {
  line: number;
  file: string;
  constructor(line: number, message: string, file = "") {
    super(message);
    this.line = line;
    this.file = file;
  }
}

function cmsg(line: number, msg: string): CompileError {
  return new CompileError(line, `Error [line ${line}]: ${msg}`);
}
function fmsg(line: number, msg: string, file: string): CompileError {
  return new CompileError(line, `Error [${file}:${line}]: ${msg}`);
}

function stdToStr(n: number): string {
  return String(n);
}

export class TypeResolver {
  private scopes_: Map<string, SymbolEntry>[] = [];
  private functions_ = new Map<string, FunctionSig>();
  private fn_decls_ = new Map<string, FunctionDecl>();
  private outer_scope_stack_: Map<string, SymbolEntry>[][] = [];
  // Parallel to outer_scope_stack_ (aligned 1:1): the function owning each
  // entry's scope group (null for the top-level/main group). M13 uses it to
  // thread transitive captures through every intermediate function.
  private outer_fns_: (FunctionDecl | null)[] = [];
  private resolved_functions_ = new Set<string>();
  private current_fn_: FunctionDecl | null = null;
  private current_return_ = TypeKind.Unknown;
  private current_return_elem_: TypeDesc = mkType(TypeKind.Unknown);
  private current_return_desc_: TypeDesc = mkType(TypeKind.Unknown);
  private current_return_tuple_: TypeDesc[] = [];
  private in_function_ = false;
  private allow_void_call_ = false;
  private current_line_ = 0;
  private entry_file_ = "";
  private current_file_ = "";
  private loop_depth_ = 0;
  private switch_entry_loop_depths_: number[] = [];
  private lex_loop_stack_: Statement[] = [];
  private next_loop_id_ = 0;
  private lambda_counter_ = 0;
  private lambda_fns_: FunctionDecl[] = [];
  // M16: user-declared types (alias/struct/enum), collected from the merged
  // program before anything else. One namespace shared with functions and
  // top-level variables; collisions are errors.
  private type_decls_ = new Map<string, TypeDecl>();
  private expanded_structs_ = new Map<string, TypeDesc>(); // nominal name -> full struct desc
  private building_structs_ = new Set<string>(); // names whose fields are being expanded (direct chain)
  private expanding_aliases_ = new Set<string>(); // names of aliases mid-expansion (cycle detection)

  // M17.3 generics: generic struct templates registered from declarations
  // (never in type_decls_, like generic functions), plus the instantiated
  // specializations owned until `resolve()` splices them into the program.
  private generic_structs_ = new Map<string, TypeDecl>();
  private generic_struct_instances_: TypeDecl[] = [];

  // M17 generics: templates registered from declarations, plus the resolved
  // instantiations produced at each call site. `generic_instances_` owns the
  // clones until `resolve()` splices them into the program for codegen.
  private generic_fns_ = new Map<string, GenericTemplate>();
  private instantiated_ = new Set<string>(); // mangled names already built
  private generic_instances_: FunctionDecl[] = [];

  // ---- scope helpers ----

  private pushScope(): void {
    this.scopes_.push(new Map());
  }
  private popScope(): void {
    this.scopes_.pop();
  }

  private define(
    name: string,
    type: TypeKind,
    is_mutable = true,
    elem: TypeDesc = mkType(TypeKind.Unknown),
    tuple_members: TypeDesc[] = [],
    desc: TypeDesc = mkType(TypeKind.Unknown)
  ): void {
    if (this.scopes_[this.scopes_.length - 1].has(name)) {
      throw this.err(this.line(), `duplicate declaration of variable '${name}'`);
    }
    this.scopes_[this.scopes_.length - 1].set(name, { type, is_mutable, elem, tuple_members, desc });
  }

  private findSymbol(name: string): SymbolEntry | null {
    for (let i = this.scopes_.length - 1; i >= 0; i--) {
      const found = this.scopes_[i].get(name);
      if (found !== undefined) return found;
    }
    return null;
  }

  private findOuterSymbol(name: string): SymbolEntry | null {
    // reverseIndex r: 0 => the variable lives in the immediately enclosing
    // function; larger r => it lives further out in the lexical chain.
    let reverseIndex = 0;
    for (let i = this.outer_scope_stack_.length - 1; i >= 0; i--, reverseIndex++) {
      const layer = this.outer_scope_stack_[i];
      for (let m = layer.length - 1; m >= 0; m--) {
        const found = layer[m].get(name);
        if (found !== undefined) {
          this.registerCapture(name, found);
          this.threadCapture(name, found, reverseIndex);
          return found;
        }
      }
    }
    return null;
  }

  private isInOuterScopes(name: string): boolean {
    for (let i = this.outer_scope_stack_.length - 1; i >= 0; i--) {
      const layer = this.outer_scope_stack_[i];
      for (let m = layer.length - 1; m >= 0; m--) {
        if (layer[m].has(name)) return true;
      }
    }
    return false;
  }

  private registerCapture(name: string, sym: SymbolEntry): void {
    this.registerCaptureOn(this.current_fn_, name, sym);
  }

  private registerCaptureOn(fn: FunctionDecl | null, name: string, sym: SymbolEntry): void {
    if (!fn || fn.name === "main") return;
    for (const c of fn.captures) {
      if (c.name === name) return;
    }
    // C++ copies the desc here; a shallow copy keeps us from mutating the
    // symbol's descriptor (capture order must not change results).
    const d = { ...sym.desc, elem: sym.desc.elem, tuple_members: sym.desc.tuple_members, fn_info: sym.desc.fn_info };
    if (d.type === TypeKind.Unknown && sym.type !== TypeKind.Unknown) {
      d.type = sym.type;
      d.elem = sym.elem.elem;
      d.tuple_members = sym.tuple_members;
    }
    fn.captures.push({ name, desc: d });
  }

  private threadCapture(name: string, sym: SymbolEntry, reverseIndex: number): void {
    // M13 (audit #4): when a function references a variable that lives in an
    // enclosing function two or more levels up, every function in between must
    // ALSO capture it so the by-value snapshot threads through the chain —
    // otherwise codegen emits an undeclared variable when an intermediate
    // builds the inner closure (e.g. returns a lambda that reads a grandparent
    // local). reverseIndex 0 (immediate parent) has no intermediates.
    const n = this.outer_fns_.length;
    if (reverseIndex === 0 || n === 0) return;
    if (reverseIndex > n) return; // defensive: keep stack alignment
    for (let i = n - reverseIndex; i < n; i++) {
      this.registerCaptureOn(this.outer_fns_[i], name, sym);
    }
  }

  private requireCaptureVisibility(fname: string): void {
    if (fname === "main") return;
    if (this.current_fn_ && fname === this.current_fn_.name) return;
    const it = this.fn_decls_.get(fname);
    if (!it) return;
    if (!this.resolved_functions_.has(fname)) return;
    for (const c of it.captures) {
      let s = this.findSymbol(c.name);
      if (!s) s = this.findOuterSymbol(c.name);
      if (!s) {
        throw this.err(
          this.line(),
          `cannot call '${fname}' from here: captured variable '${c.name}' is not in scope`
        );
      }
    }
  }

  private requireFunctionValue(fname: string): void {
    if (fname === "main") return;
    if (this.current_fn_ && this.current_fn_.name === fname) return;
    if (!this.resolved_functions_.has(fname)) {
      throw this.err(this.line(), `function '${fname}' must be declared before it is used as a value`);
    }
    const dit = this.fn_decls_.get(fname);
    if (dit && dit.has_nonlocal) {
      throw this.err(
        this.line(),
        `cannot use function '${fname}' as a value because it has a non-local break/continue target`
      );
    }
    this.requireCaptureVisibility(fname);
  }

  private requireNonlocalCall(fname: string, cdecl: FunctionDecl, errorLine: number): void {
    let targetLoop: Statement | null = null;
    for (let i = this.lex_loop_stack_.length - 1; i >= 0; i--) {
      const lp = this.lex_loop_stack_[i];
      if (lp.nl_id === cdecl.nl_target_loop_id) {
        targetLoop = lp;
        break;
      }
    }
    if (!targetLoop || this.current_fn_ !== targetLoop.nl_owner) {
      throw this.err(
        errorLine,
        `cannot call '${fname}' from here: its non-local break/continue target loop is not active here`
      );
    }
  }

  private isLoopStmt(stmt: Statement): boolean {
    return (
      stmt instanceof LoopStmt ||
      stmt instanceof ForeachStmt ||
      stmt instanceof WhileStmt ||
      stmt instanceof ForStmt ||
      stmt instanceof DoWhileStmt
    );
  }

  // ---- non-local exit analysis ----

  private rejectDeferInNonlocalLoop(body: Statement[], enclosing: FunctionDecl | null): void {
    const bad = findDeferStmt(body);
    if (bad) {
      throw this.err(
        bad.line,
        "defer is not supported inside a loop that a nested function exits non-locally",
        enclosing ? enclosing.file : ""
      );
    }
  }

  private analyzeNonlocalExits(program: Program): void {
    this.next_loop_id_ = 0;
    const lexStack: Statement[] = [];
    const switchDepths: number[] = [];
    this.analyzeNonlocalStmts(program.statements, null, lexStack, 0, switchDepths);
  }

  private analyzeNonlocalStmts(
    stmts: Statement[],
    enclosing: FunctionDecl | null,
    lexStack: Statement[],
    localDepth: number,
    switchDepths: number[]
  ): void {
    for (const stmt of stmts) {
      if (stmt instanceof FunctionDecl) {
        const fn = stmt;
        fn.has_nonlocal = false;
        fn.nl_target_loop_id = -1;
        fn.nl_use_break = false;
        fn.nl_use_continue = false;
        const savedSwitch = switchDepths;
        switchDepths.length = 0;
        this.analyzeNonlocalStmts(fn.body, fn, lexStack, 0, switchDepths);
        switchDepths.length = 0;
        switchDepths.push(...savedSwitch);
      } else if (stmt instanceof IfStmt) {
        this.analyzeNonlocalStmts(stmt.then_body, enclosing, lexStack, localDepth, switchDepths);
        this.analyzeNonlocalStmts(stmt.else_body, enclosing, lexStack, localDepth, switchDepths);
      } else if (stmt instanceof SwitchStmt) {
        switchDepths.push(localDepth);
        for (const c of stmt.cases) {
          this.analyzeNonlocalStmts(c.body, enclosing, lexStack, localDepth, switchDepths);
        }
        switchDepths.pop();
      } else if (stmt instanceof ForStmt) {
        stmt.nl_id = this.next_loop_id_++;
        stmt.nl_owner = enclosing;
        lexStack.push(stmt);
        this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth + 1, switchDepths);
        lexStack.pop();
        if (stmt.nl_target) this.rejectDeferInNonlocalLoop(stmt.body, enclosing);
      } else if (this.isLoopStmt(stmt)) {
        stmt.nl_id = this.next_loop_id_++;
        stmt.nl_owner = enclosing;
        lexStack.push(stmt);
        if (stmt instanceof LoopStmt) {
          this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth + 1, switchDepths);
        } else if (stmt instanceof ForeachStmt) {
          this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth + 1, switchDepths);
        } else if (stmt instanceof WhileStmt) {
          this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth + 1, switchDepths);
        } else if (stmt instanceof DoWhileStmt) {
          this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth + 1, switchDepths);
        }
        lexStack.pop();
        let body: Statement[] | null = null;
        if (
          stmt instanceof LoopStmt ||
          stmt instanceof ForeachStmt ||
          stmt instanceof WhileStmt ||
          stmt instanceof DoWhileStmt
        ) {
          body = stmt.body;
        }
        if (stmt.nl_target && body) this.rejectDeferInNonlocalLoop(body, enclosing);
      } else if (stmt instanceof DeferStmt) {
        this.analyzeNonlocalStmts(stmt.body, enclosing, lexStack, localDepth, switchDepths);
      } else if (stmt instanceof BreakStmt) {
        if (lexStack.length === 0) {
          throw this.err(stmt.line, "break outside of a loop", enclosing ? enclosing.file : "");
        }
        const nearest: Statement = lexStack[lexStack.length - 1];
        if (nearest.nl_owner === enclosing) {
          if (switchDepths.length !== 0 && localDepth <= switchDepths[switchDepths.length - 1]) {
            throw this.err(
              stmt.line,
              "break inside a switch case requires an enclosing loop within the case",
              enclosing ? enclosing.file : ""
            );
          }
        } else {
          stmt.nonlocal = true;
          if (enclosing) {
            enclosing.has_nonlocal = true;
            enclosing.nl_target_loop_id = nearest.nl_id;
            enclosing.nl_use_break = true;
          }
          nearest.nl_target = true;
        }
      } else if (stmt instanceof ContinueStmt) {
        if (lexStack.length === 0) {
          throw this.err(stmt.line, "continue outside of a loop", enclosing ? enclosing.file : "");
        }
        const nearest: Statement = lexStack[lexStack.length - 1];
        if (nearest.nl_owner === enclosing) {
          if (switchDepths.length !== 0 && localDepth <= switchDepths[switchDepths.length - 1]) {
            throw this.err(
              stmt.line,
              "continue inside a switch case requires an enclosing loop within the case",
              enclosing ? enclosing.file : ""
            );
          }
        } else {
          stmt.nonlocal = true;
          if (enclosing) {
            enclosing.has_nonlocal = true;
            enclosing.nl_target_loop_id = nearest.nl_id;
            enclosing.nl_use_continue = true;
          }
          nearest.nl_target = true;
        }
      }
    }
  }

  // ---- public queries ----

  hasType(name: string): boolean {
    const found = this.findSymbol(name);
    return found != null;
  }

  getType(name: string): TypeKind {
    const sym = this.findSymbol(name);
    return sym ? sym.type : TypeKind.Unknown;
  }

  getFunction(name: string): FunctionSig | null {
    const it = this.functions_.get(name);
    return it ? it : null;
  }

  // ---- expression descriptor helpers ----

  private exprElementDesc(expr: Expression): TypeDesc {
    if (expr instanceof ArrayLiteral) {
      return expr.elem;
    }
    if (expr instanceof Identifier) {
      let s = this.findSymbol(expr.name);
      if (!s) s = this.findOuterSymbol(expr.name);
      if (s && s.type === TypeKind.Array) return s.elem;
    }
    if (expr instanceof CallExpr) {
      const sig = this.getFunction(expr.name);
      if (sig && sig.return_type === TypeKind.Array) return sig.return_elem;
      if (expr.is_function_value_call && expr.fn_type.fn_info && expr.fn_type.fn_info.ret.type === TypeKind.Array)
        return elementOf(expr.fn_type.fn_info.ret);
      if (expr.name === "slice" || expr.name === "concat") {
        return this.exprElementDesc(expr.args[0]);
      }
      if (expr.name === "split") {
        return mkType(TypeKind.Text);
      }
      if (expr.name === "pop") {
        const inner = this.exprElementDesc(expr.args[0]);
        if (inner.type === TypeKind.Array) return elementOf(inner);
        return inner;
      }
    }
    if (expr instanceof ArrayIndexExpr) {
      if (expr.elem.type === TypeKind.Array) return elementOf(expr.elem);
    }
    if (expr instanceof MemberAccessExpr) {
      if (expr.is_field && expr.field_desc.type === TypeKind.Array) return elementOf(expr.field_desc);
    }
    return mkType(TypeKind.Unknown);
  }

  private exprDesc(expr: Expression): TypeDesc {
    const k = expr.resolved_type;
    if (k === TypeKind.Array) return arrayOf(this.exprElementDesc(expr));
    if (k === TypeKind.Tuple) {
      const d = mkType(TypeKind.Tuple);
      d.tuple_members = this.exprTupleMembers(expr);
      return d;
    }
    if (k === TypeKind.Function) return this.exprFunctionType(expr);
    if (k === TypeKind.Struct || k === TypeKind.Enum) {
      // Nominal descriptor: carry the declared type name so member access
      // and nominal equality checks can use it.
      if (expr instanceof Identifier) {
        let s = this.findSymbol(expr.name);
        if (!s) s = this.findOuterSymbol(expr.name);
        if (s && (s.type === TypeKind.Struct || s.type === TypeKind.Enum)) return s.desc;
      }
      if (expr instanceof CallExpr) {
        if (expr.is_struct_ctor) return expr.struct_ctor_desc;
        if (expr.is_function_value_call && expr.fn_type.fn_info &&
            (expr.fn_type.fn_info.ret.type === TypeKind.Struct ||
             expr.fn_type.fn_info.ret.type === TypeKind.Enum))
          return expr.fn_type.fn_info.ret;
        const sig = this.getFunction(expr.name);
        if (sig && (sig.return_type === TypeKind.Struct || sig.return_type === TypeKind.Enum))
          return sig.return_desc;
      }
      if (expr instanceof MemberAccessExpr) {
        if (expr.is_enum_member) {
          const d = mkType(TypeKind.Enum);
          d.type_name = expr.enum_type_name;
          return d;
        }
        if (expr.is_field) return expr.field_desc;
      }
      if (expr instanceof ArrayIndexExpr) {
        if (expr.elem.type === TypeKind.Struct || expr.elem.type === TypeKind.Enum)
          return expr.elem;
      }
      if (expr instanceof ConditionalExpr) {
        // Both branches carry the same nominal type (resolver-enforced).
        return this.exprDesc(expr.then_expr);
      }
      return mkType(k); // fallback
    }
    const d = mkType(k);
    return d;
  }

  private exprTupleMembers(expr: Expression): TypeDesc[] {
    if (expr instanceof Identifier) {
      let s = this.findSymbol(expr.name);
      if (!s) s = this.findOuterSymbol(expr.name);
      if (s && s.type === TypeKind.Tuple) return s.tuple_members;
    }
    if (expr instanceof CallExpr) {
      const sig = this.getFunction(expr.name);
      if (sig && sig.return_type === TypeKind.Tuple) return sig.return_tuple_members;
      if (expr.is_function_value_call && expr.fn_type.fn_info && expr.fn_type.fn_info.ret.type === TypeKind.Tuple)
        return expr.fn_type.fn_info.ret.tuple_members;
    }
    if (expr instanceof TupleLiteral) {
      return expr.resolved_members;
    }
    if (expr instanceof ArrayIndexExpr) {
      if (expr.resolved_type === TypeKind.Tuple) return expr.elem.tuple_members;
    }
    if (expr instanceof MemberAccessExpr) {
      if (expr.is_field && expr.field_desc.type === TypeKind.Tuple) return expr.field_desc.tuple_members;
    }
    return [];
  }

  private exprFunctionType(expr: Expression): TypeDesc {
    if (expr instanceof Identifier) {
      if (expr.is_function_reference) return expr.fn_type;
      let s = this.findSymbol(expr.name);
      if (!s) s = this.findOuterSymbol(expr.name);
      if (s && s.type === TypeKind.Function) return s.desc;
    }
    if (expr instanceof LambdaExpr) {
      return expr.lambda_type;
    }
    if (expr instanceof CallExpr) {
      if (expr.is_partial) return expr.partial_ftype;
      if (expr.is_function_value_call && expr.fn_type.fn_info) return expr.fn_type.fn_info.ret;
      const sig = this.getFunction(expr.name);
      if (sig && sig.return_type === TypeKind.Function) return sig.return_desc;
    }
    if (expr instanceof MemberAccessExpr) {
      if (expr.is_field && expr.field_desc.type === TypeKind.Function) return expr.field_desc;
    }
    return mkType(TypeKind.Unknown);
  }

  private resolveTupleIndex(idx: ArrayIndexExpr, members: TypeDesc[], line: number): TypeKind {
    const it = this.resolveExpr(idx.index);
    if (it !== TypeKind.Int) {
      throw this.err(line, `tuple index must be int, got ${typeToString(it)}`);
    }
    if (idx.index instanceof NumberLiteral) {
      const memberIndex = idx.index.value;
      if (memberIndex < 0 || memberIndex >= members.length) {
        throw this.err(
          line,
          `tuple index ${stdToStr(memberIndex)} out of range for ${tupleTypeToString(members)}`
        );
      }
      const member = members[memberIndex];
      idx.is_tuple = true;
      idx.member_index = memberIndex;
      idx.elem = member;
      return member.type;
    }
    const first = members[0];
    for (let m = 1; m < members.length; m++) {
      if (!typeDescEquals(members[m], first)) {
        throw this.err(
          line,
          `cannot index tuple ${tupleTypeToString(members)} with a non-constant index: tuple members must all be of the same type`
        );
      }
    }
    idx.is_tuple = true;
    idx.tuple_dynamic = true;
    idx.tuple_arity = members.length;
    idx.elem = first;
    return first.type;
  }

  private typesMatch(a: TypeDesc, b: TypeDesc): boolean {
    if (a.type !== b.type) return false;
    if (a.type === TypeKind.Array) return typeDescEquals(elementOf(a), elementOf(b));
    if (a.type === TypeKind.Tuple) return typeDescListEquals(a.tuple_members, b.tuple_members);
    // Structs and enums are nominal: identity is the declared type name plus,
    // for generic structs, the type arguments (`Box[int]` vs `Box[text]`).
    if (a.type === TypeKind.Struct || a.type === TypeKind.Enum) {
      return a.type_name === b.type_name && typeDescListEquals(a.type_args, b.type_args);
    }
    return true;
  }

  private bindDestructSlot(
    slot: { name: string; items: any[]; nested: boolean; is_rest: boolean; vdesc: TypeDesc },
    vd: TypeDesc,
    line: number,
    declare: boolean,
    is_mutable: boolean
  ): void {
    if (declare) {
      if (vd.type === TypeKind.Tuple) {
        this.define(slot.name, TypeKind.Tuple, is_mutable, mkType(TypeKind.Unknown), [...vd.tuple_members]);
      } else {
        this.define(
          slot.name,
          vd.type,
          is_mutable,
          elementOf(vd),
          [],
          vd.type === TypeKind.Function || vd.type === TypeKind.Struct || vd.type === TypeKind.Enum
            ? vd
            : mkType(TypeKind.Unknown)
        );
      }
      return;
    }
    const sym = this.findSymbol(slot.name);
    if (!sym) {
      throw this.err(line, `undefined variable '${slot.name}'`);
    }
    if (!sym.is_mutable) {
      throw this.err(line, `cannot modify immutable variable '${slot.name}'`);
    }
    const have: TypeDesc = { type: sym.type, elem: sym.elem, tuple_members: sym.tuple_members, fn_info: null, type_name: "", type_args: [] };
    if (!this.typesMatch(have, vd)) {
      throw this.err(
        line,
        `type mismatch: cannot assign ${typeDescToString(vd)} to ${typeDescToString(have)}`
      );
    }
  }

  private applyDestructPattern(
    slots: any[],
    val: TypeDesc,
    line: number,
    declare: boolean,
    is_mutable: boolean
  ): void {
    if (val.type === TypeKind.Tuple) {
      for (const p of slots) {
        if (p.is_rest) {
          throw this.err(line, "cannot use '...rest' when destructuring a tuple");
        }
      }
      if (val.tuple_members.length !== slots.length) {
        throw this.err(
          line,
          `cannot destructure tuple of ${stdToStr(val.tuple_members.length)} members into ${stdToStr(slots.length)} variables`
        );
      }
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const member = val.tuple_members[i];
        slot.vdesc = member;
        if (slot.nested) {
          this.applyDestructPattern(slot.items, member, line, declare, is_mutable);
        } else {
          this.bindDestructSlot(slot, member, line, declare, is_mutable);
        }
      }
      return;
    }
    if (val.type === TypeKind.Array) {
      const elem = elementOf(val);
      let seenRest = false;
      for (const p of slots) {
        if (p.is_rest) {
          seenRest = true;
        } else if (seenRest) {
          throw this.err(line, "cannot use '...rest' before another destructuring target");
        }
      }
      for (const p of slots) {
        if (p.is_rest) {
          const rest = arrayOf(elem);
          p.vdesc = rest;
          this.bindDestructSlot(p, rest, line, declare, is_mutable);
        } else if (p.nested) {
          p.vdesc = elem;
          this.applyDestructPattern(p.items, elem, line, declare, is_mutable);
        } else {
          p.vdesc = elem;
          this.bindDestructSlot(p, elem, line, declare, is_mutable);
        }
      }
      return;
    }
    if (val.type === TypeKind.Text) {
      const charDesc = mkType(TypeKind.Char);
      let seenRest = false;
      for (const p of slots) {
        if (p.is_rest) {
          seenRest = true;
        } else if (seenRest) {
          throw this.err(line, "cannot use '...rest' before another destructuring target");
        }
      }
      for (const p of slots) {
        if (p.is_rest) {
          const t = mkType(TypeKind.Text);
          p.vdesc = t;
          this.bindDestructSlot(p, t, line, declare, is_mutable);
        } else if (p.nested) {
          throw this.err(line, "cannot destructure a character into a nested pattern");
        } else {
          p.vdesc = charDesc;
          this.bindDestructSlot(p, charDesc, line, declare, is_mutable);
        }
      }
      return;
    }
    throw this.err(
      line,
      `cannot destructure a value of type ${typeToString(val.type)} into a nested pattern`
    );
  }

  private inferFromLiteral(expr: Expression): TypeKind {
    if (expr instanceof NumberLiteral) return TypeKind.Int;
    if (expr instanceof DecimalLiteral) return TypeKind.Decimal;
    if (expr instanceof StringLiteral) return TypeKind.Text;
    if (expr instanceof BoolLiteral) return TypeKind.Bool;
    if (expr instanceof CharLiteral) return TypeKind.Char;
    return TypeKind.Unknown;
  }

  // ---- expression resolution ----

  resolveExpr(expr: Expression): TypeKind {
    let result = TypeKind.Unknown;
    if (expr instanceof NumberLiteral) {
      result = TypeKind.Int;
    } else if (expr instanceof DecimalLiteral) {
      result = TypeKind.Decimal;
    } else if (expr instanceof StringLiteral) {
      result = TypeKind.Text;
    } else if (expr instanceof BoolLiteral) {
      result = TypeKind.Bool;
    } else if (expr instanceof CharLiteral) {
      result = TypeKind.Char;
    } else if (expr instanceof LambdaExpr) {
      if (expr.resolved) {
        // Re-resolving an already-synthesized lambda (e.g. a generic call
        // re-checks its arguments after inferring type parameters) must not
        // mint a second hoisted function.
        result = TypeKind.Function;
      } else {
      const synth = new FunctionDecl("");
      synth.name = `__lam_${this.lambda_counter_++}`;
      while (this.functions_.has(synth.name) || this.fn_decls_.has(synth.name)) {
        synth.name = `__lam_${this.lambda_counter_++}`;
      }
      synth.params = expr.params;
      synth.body = expr.body;
      synth.has_return_type = expr.has_return_type;
      synth.return_type = expr.return_type;
      synth.return_elem = expr.return_elem;
      synth.return_tuple_members = [...expr.return_tuple_members];
      synth.return_desc = expr.return_desc;
      synth.line = expr.line;
      synth.file = this.current_file_;
      synth.is_lambda = true;
      expr.resolved = synth;
      this.resolveFunctionDecl(synth);
      const ftd = mkType(TypeKind.Function);
      const res: FunctionTypeInfo = { params: [], ret: mkType(TypeKind.Unknown) };
      for (const p of synth.params) res.params.push(paramTypeDesc(p));
      res.ret = synth.has_return_type ? synth.return_desc : mkType(TypeKind.Unknown);
      ftd.fn_info = res;
      expr.lambda_type = ftd;
      this.lambda_fns_.push(synth);
      result = TypeKind.Function;
      }
    } else if (expr instanceof Identifier) {
      let sym = this.findSymbol(expr.name);
      if (!sym) {
        sym = this.findOuterSymbol(expr.name);
        if (!sym) {
          if (this.type_decls_.has(expr.name) || this.generic_structs_.has(expr.name)) {
            throw this.err(this.line(), `cannot use type '${expr.name}' as a value`);
          }
          const fit = this.functions_.get(expr.name);
          if (fit && fit !== undefined && fit !== null && expr.name !== "main") {
            this.requireFunctionValue(expr.name);
            expr.is_function_reference = true;
            expr.fn_type = fit.fn_type;
            result = TypeKind.Function;
          } else if (fit !== undefined && expr.name === "main") {
            throw this.err(this.line(), "cannot use function 'main' as a value");
          } else if (this.generic_fns_.has(expr.name)) {
            throw this.err(this.line(), `generic function '${expr.name}' cannot be used as a value`);
          } else {
            throw this.err(this.line(), `undefined variable '${expr.name}'`);
          }
        } else {
          result = sym.type;
        }
      } else {
        result = this.getType(expr.name);
      }
    } else if (expr instanceof CallExpr) {
      // -- builtin "simple" calls --
      if (
        expr.name === "length" || expr.name === "substring" || expr.name === "input" ||
        expr.name === "tostr" || expr.name === "parse_int" || expr.name === "parse_decimal"
      ) {
        let expected = 1;
        if (expr.name === "substring") expected = 3;
        if (expr.name === "input") expected = 0;
        if (expr.args.length !== expected) {
          throw this.err(
            this.line(),
            `builtin '${expr.name}' expects ${stdToStr(expected)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
        if (expr.name === "input") {
          result = TypeKind.Text;
        } else if (expr.name === "tostr") {
          const arg0 = this.resolveExpr(expr.args[0]);
          if (
            arg0 !== TypeKind.Int && arg0 !== TypeKind.Decimal && arg0 !== TypeKind.Bool &&
            arg0 !== TypeKind.Char && arg0 !== TypeKind.Byte && arg0 !== TypeKind.Text
          ) {
            throw this.err(this.line(), "builtin 'tostr' expects int, decimal, bool, byte, char, or text");
          }
          result = TypeKind.Text;
        } else if (expr.name === "parse_int" || expr.name === "parse_decimal") {
          const arg0 = this.resolveExpr(expr.args[0]);
          if (arg0 !== TypeKind.Text) {
            throw this.err(
              this.line(),
              `builtin '${expr.name}' expects text, got ${typeToString(arg0)}`
            );
          }
          result = expr.name === "parse_int" ? TypeKind.Int : TypeKind.Decimal;
        } else {
          const arg0 = this.resolveExpr(expr.args[0]);
          if (expr.name === "length") {
            if (arg0 === TypeKind.Text || arg0 === TypeKind.Array) {
              result = TypeKind.Int;
            } else {
              throw this.err(this.line(), `builtin 'length' expects text or array, got ${typeToString(arg0)}`);
            }
          } else {
            if (arg0 !== TypeKind.Text) {
              throw this.err(this.line(), "builtin 'substring' expects text as argument 1");
            }
            for (let i = 1; i < 3; i++) {
              if (this.resolveExpr(expr.args[i]) !== TypeKind.Int) {
                throw this.err(this.line(), "builtin 'substring' expects int indexes");
              }
            }
            result = TypeKind.Text;
          }
        }
        expr.resolved_type = result;
        return result;
      }
      // -- builtin array/collection calls --
      if (
        expr.name === "push" || expr.name === "pop" || expr.name === "sort" ||
        expr.name === "slice" || expr.name === "concat" ||
        expr.name === "index_of" || expr.name === "contains"
      ) {
        let expected: number;
        if (expr.name === "sort" || expr.name === "pop") expected = 1;
        else if (expr.name === "slice") expected = 3;
        else expected = 2;
        if (expr.args.length !== expected) {
          throw this.err(
            this.line(),
            `builtin '${expr.name}' expects ${stdToStr(expected)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
        if (this.resolveExpr(expr.args[0]) !== TypeKind.Array) {
          throw this.err(this.line(), `builtin '${expr.name}' expects an array as argument 1`);
        }
        const arrElem = this.exprElementDesc(expr.args[0]);
        expr.array_aux = arrElem;
        if (!descFullyKnown(arrElem)) {
          throw this.err(this.line(), `builtin '${expr.name}' requires a fully-known array element type`);
        }
        if (expr.name === "push" || expr.name === "sort" || expr.name === "pop") {
          if (expr.args[0] instanceof Identifier) {
            const sym = this.findSymbol((expr.args[0] as Identifier).name);
            if (!sym && this.isInOuterScopes((expr.args[0] as Identifier).name)) {
              throw this.err(this.line(), `cannot modify captured variable '${(expr.args[0] as Identifier).name}'`);
            }
            if (sym && !sym.is_mutable) {
              throw this.err(this.line(), `cannot modify immutable array '${(expr.args[0] as Identifier).name}'`);
            }
          }
        }
        if (expr.name === "push") {
          this.resolveExpr(expr.args[1]);
          const vt = this.exprDesc(expr.args[1]);
          if (!typeDescEquals(vt, arrElem)) {
            throw this.err(
              this.line(),
              `type mismatch: cannot push ${typeDescToString(vt)} to array of ${typeDescToString(arrElem)}`
            );
          }
          if (!this.allow_void_call_) {
            throw this.err(this.line(), "builtin 'push' returns nothing and cannot be used as a value");
          }
          result = TypeKind.Unknown;
        } else if (expr.name === "pop") {
          result = arrElem.type === TypeKind.Array ? TypeKind.Array : arrElem.type;
        } else if (expr.name === "sort") {
          if (
            arrElem.type !== TypeKind.Int && arrElem.type !== TypeKind.Decimal &&
            arrElem.type !== TypeKind.Byte && arrElem.type !== TypeKind.Char &&
            arrElem.type !== TypeKind.Text
          ) {
            throw this.err(
              this.line(),
              "builtin 'sort' requires an array of int, decimal, byte, char, or text"
            );
          }
          if (!this.allow_void_call_) {
            throw this.err(this.line(), "builtin 'sort' returns nothing and cannot be used as a value");
          }
          result = TypeKind.Unknown;
        } else if (expr.name === "slice") {
          for (let i = 1; i < 3; i++) {
            const it = this.resolveExpr(expr.args[i]);
            if (it !== TypeKind.Int) {
              throw this.err(this.line(), `builtin 'slice' expects int indexes, got ${typeToString(it)}`);
            }
          }
          result = TypeKind.Array;
        } else if (expr.name === "concat") {
          const at = this.resolveExpr(expr.args[1]);
          if (at !== TypeKind.Array) {
            throw this.err(this.line(), "builtin 'concat' expects two arrays");
          }
          const a2 = this.exprElementDesc(expr.args[1]);
          if (!typeDescEquals(a2, arrElem)) {
            throw this.err(
              this.line(),
              `type mismatch: cannot concatenate array of ${typeDescToString(a2)} with array of ${typeDescToString(arrElem)}`
            );
          }
          result = TypeKind.Array;
        } else {
          // index_of / contains
          this.resolveExpr(expr.args[1]);
          const vt = this.exprDesc(expr.args[1]);
          if (!typeDescEquals(vt, arrElem)) {
            throw this.err(
              this.line(),
              `type mismatch: ${expr.name} value of ${typeDescToString(vt)} does not match array of ${typeDescToString(arrElem)}`
            );
          }
          if (arrElem.type === TypeKind.Array || arrElem.type === TypeKind.Function) {
            throw this.err(
              this.line(),
              `builtin '${expr.name}' requires an array of scalar or text elements`
            );
          }
          result = expr.name === "index_of" ? TypeKind.Int : TypeKind.Bool;
        }
        expr.resolved_type = result;
        return result;
      }
      // -- builtin char/string calls --
      if (expr.name === "ord" || expr.name === "chr" || expr.name === "split") {
        let expected = 1;
        if (expr.name === "split") expected = 2;
        if (expr.args.length !== expected) {
          throw this.err(
            this.line(),
            `builtin '${expr.name}' expects ${stdToStr(expected)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
        if (expr.name === "ord") {
          const a0 = this.resolveExpr(expr.args[0]);
          if (a0 !== TypeKind.Char) {
            throw this.err(this.line(), `builtin 'ord' expects char, got ${typeToString(a0)}`);
          }
          result = TypeKind.Int;
        } else if (expr.name === "chr") {
          const a0 = this.resolveExpr(expr.args[0]);
          if (a0 !== TypeKind.Int) {
            throw this.err(this.line(), `builtin 'chr' expects int, got ${typeToString(a0)}`);
          }
          result = TypeKind.Char;
        } else {
          const a0 = this.resolveExpr(expr.args[0]);
          if (a0 !== TypeKind.Text) {
            throw this.err(this.line(), `builtin 'split' expects text as argument 1, got ${typeToString(a0)}`);
          }
          const a1 = this.resolveExpr(expr.args[1]);
          if (a1 !== TypeKind.Text) {
            throw this.err(this.line(), `builtin 'split' expects text as argument 2, got ${typeToString(a1)}`);
          }
          result = TypeKind.Array;
        }
        expr.resolved_type = result;
        return result;
      }
      if (expr.name === "main") {
        throw this.err(this.line(), "cannot call function 'main'");
      }
      // M16: struct construction — `Name(args)` where Name is a user type.
      // M17.3: `Box(5)` where `Box` is a generic struct template — the type
      // arguments are inferred from the constructor arguments (SYNTAX §20.2),
      // the specialization is instantiated, and only then does the ordinary
      // struct-constructor path below run against the concrete fields.
      let ctorDecl: TypeDecl | null = null;
      let target = mkType(TypeKind.Unknown);
      const git = this.generic_structs_.get(expr.name);
      if (git) {
        const tmpl = git;
        if (expr.args.length !== tmpl.fields.length) {
          throw this.err(
            this.line(),
            `struct '${expr.name}' constructor expects ${stdToStr(tmpl.fields.length)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
        const tparams = new Set(tmpl.type_params);
        const bind = new Map<string, TypeDesc>();
        for (let i = 0; i < tmpl.fields.length; i++) {
          // Resolve each argument once for inference; the shared path
          // below re-resolves it, which is idempotent for every
          // expression node (lambda synthesis is guarded).
          this.resolveExpr(expr.args[i]);
          const ad = this.exprDesc(expr.args[i]);
          this.unifyTypeParams(tmpl.fields[i].desc, ad, tparams, bind, `generic type '${expr.name}'`, this.line());
        }
        for (const tp of tmpl.type_params) {
          if (!bind.has(tp)) {
            throw this.err(
              this.line(),
              `cannot infer type argument '${tp}' for generic type '${expr.name}'`
            );
          }
        }
        target = mkType(TypeKind.Struct);
        target.type_name = expr.name;
        for (const tp of tmpl.type_params) target.type_args.push(bind.get(tp)!);
        // Registers the specialization under its key and expands its
        // fields in place (no-op when it already exists).
        this.resolveNamedType(expr.name, target.type_args, true);
        ctorDecl = this.type_decls_.get(typeInstName(target))!;
      } else {
        const tdecl = this.type_decls_.get(expr.name);
        if (tdecl) {
          if (tdecl.tdecl_kind === TypeDeclKind.Struct) {
            target = mkType(TypeKind.Struct);
            target.type_name = tdecl.name;
            ctorDecl = tdecl;
          } else if (tdecl.tdecl_kind === TypeDeclKind.Alias) {
            target = this.resolveNamedType(tdecl.name, [], true);
            if (target.type === TypeKind.Enum) {
              throw this.err(this.line(), `enum type '${expr.name}' cannot be constructed`);
            }
            if (target.type !== TypeKind.Struct) {
              throw this.err(this.line(), `cannot construct type '${expr.name}'`);
            }
            ctorDecl = this.type_decls_.get(typeInstName(target))!;
          } else {
            throw this.err(this.line(), `enum type '${expr.name}' cannot be constructed`);
          }
        }
      }
      if (ctorDecl) {
        const st = ctorDecl;
        if (st.tdecl_kind !== TypeDeclKind.Struct) {
          throw this.err(this.line(), `internal: constructor for type '${expr.name}' is not a struct`);
        }
        // Display name of the specialization: `Point` for an ordinary
        // struct, `Box[int]` for a generic one (st.name is the internal
        // specialization key `Box__int`, which must not leak into
        // diagnostics).
        const disp = typeDescToString(target);
        if (expr.args.length !== st.fields.length) {
          throw this.err(
            this.line(),
            `struct '${disp}' constructor expects ${stdToStr(st.fields.length)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
        for (let i = 0; i < st.fields.length; i++) {
          this.resolveExpr(expr.args[i]);
          const ad = this.exprDesc(expr.args[i]);
          if (ad.type === TypeKind.Unknown) {
            throw this.err(
              this.line(),
              `cannot infer type of argument ${stdToStr(i + 1)} to struct constructor '${disp}'`
            );
          }
          if (!this.typesMatch(ad, st.fields[i].desc)) {
            throw this.err(
              this.line(),
              `type mismatch: field '${st.fields[i].name}' of struct '${disp}' expects ${typeDescToString(st.fields[i].desc)}, got ${typeDescToString(ad)}`
            );
          }
        }
        const fields: TypeDesc[] = st.fields.map((f) => f.desc);
        expr.is_struct_ctor = true;
        expr.struct_ctor_name = typeInstName(target);
        expr.struct_ctor_fields = fields;
        expr.struct_ctor_desc = target;
        result = TypeKind.Struct;
        expr.resolved_type = result;
        return result;
      }
      // -- M17 generic call: monomorphize and rewrite to the instantiation --
      const generic = this.generic_fns_.get(expr.name);
      if (generic) {
        expr.name = this.monomorphizeCall(expr, generic);
      }
      // -- call by function name --
      const sig = this.getFunction(expr.name);
      if (!sig) {
        const lsym = this.findSymbol(expr.name);
        const lsymOrOuter = lsym ? lsym : this.findOuterSymbol(expr.name);
        if (lsymOrOuter && lsymOrOuter.type === TypeKind.Function && lsymOrOuter.desc.fn_info) {
          const info = lsymOrOuter.desc.fn_info;
          expr.is_function_value_call = true;
          expr.fn_type = lsymOrOuter.desc;
          const partial = expr.args.length > 0 && expr.args.length < info.params.length;
          if (partial) {
            expr.is_partial = true;
            expr.partial_applied = expr.args.length;
            expr.partial_full_params = info.params;
            expr.partial_params = info.params.slice(expr.args.length);
            expr.partial_ret = info.ret;
            const ftd = mkType(TypeKind.Function);
            ftd.fn_info = { params: expr.partial_params, ret: expr.partial_ret };
            expr.partial_ftype = ftd;
          } else if (expr.args.length !== info.params.length) {
            throw this.err(
              this.line(),
              `function '${expr.name}' expects ${stdToStr(info.params.length)} arguments, got ${stdToStr(expr.args.length)}`
            );
          }
          for (let i = 0; i < expr.args.length; i++) {
            const at = this.resolveExpr(expr.args[i]);
            const expected = info.params[i];
            if (at !== expected.type) {
              throw this.err(
                this.line(),
                `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects ${typeDescToString(expected)}, got ${typeToString(at)}`
              );
            }
            if (expected.type === TypeKind.Array) {
              const argElem = this.exprElementDesc(expr.args[i]);
              if (!typeDescEquals(argElem, elementOf(expected))) {
                throw this.err(
                  this.line(),
                  `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects array of ${typeDescToString(elementOf(expected))}, got array of ${typeDescToString(argElem)}`
                );
              }
            }
            if (expected.type === TypeKind.Tuple) {
              const argMembers = this.exprTupleMembers(expr.args[i]);
              if (!typeDescListEquals(argMembers, expected.tuple_members)) {
                throw this.err(
                  this.line(),
                  `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects tuple ${tupleTypeToString(expected.tuple_members)}, got tuple ${tupleTypeToString(argMembers)}`
                );
              }
            }
            if (expected.type === TypeKind.Function) {
              const atd = this.exprFunctionType(expr.args[i]);
              if (!typeDescEquals(atd, expected)) {
                throw this.err(
                  this.line(),
                  `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects ${typeDescToString(expected)}, got ${
                    atd.type === TypeKind.Function ? typeDescToString(atd) : typeToString(at)
                  }`
                );
              }
            }
          }
          if (expr.is_partial) {
            result = TypeKind.Function;
          } else if (info.ret.type === TypeKind.Unknown) {
            if (!this.allow_void_call_) {
              throw this.err(
                this.line(),
                `function '${expr.name}' returns nothing and cannot be used as a value`
              );
            }
            result = TypeKind.Unknown;
          } else {
            result = info.ret.type;
          }
          expr.resolved_type = result;
          return result;
        }
        throw this.err(this.line(), `undefined function '${expr.name}'`);
      }
      this.requireCaptureVisibility(expr.name);
      const ndit = this.fn_decls_.get(expr.name);
      if (ndit && ndit.has_nonlocal) {
        this.requireNonlocalCall(expr.name, ndit, this.line());
      }
      const fixed = sig.variadic ? sig.param_types.length - 1 : sig.param_types.length;
      let hasDefault = false;
      for (const d of sig.param_has_default) if (d) { hasDefault = true; break; }
      if (!hasDefault && !sig.variadic) {
        const partial = expr.args.length > 0 && expr.args.length < sig.param_types.length;
        if (partial) {
          expr.is_partial = true;
          expr.partial_applied = expr.args.length;
          expr.partial_full_params = sig.param_descs;
          expr.partial_params = sig.param_descs.slice(expr.args.length);
          expr.partial_ret = sig.return_desc;
          const ftd = mkType(TypeKind.Function);
          ftd.fn_info = { params: expr.partial_params, ret: expr.partial_ret };
          expr.partial_ftype = ftd;
        } else if (expr.args.length !== sig.param_types.length) {
          throw this.err(
            this.line(),
            `function '${expr.name}' expects ${stdToStr(sig.param_types.length)} arguments, got ${stdToStr(expr.args.length)}`
          );
        }
      } else {
        let minArgs = 0;
        while (minArgs < fixed && !sig.param_has_default[minArgs]) minArgs++;
        if (expr.args.length < minArgs) {
          throw this.err(
            this.line(),
            `function '${expr.name}' expects at least ${stdToStr(minArgs)} argument${minArgs === 1 ? "" : "s"}, got ${stdToStr(expr.args.length)}`
          );
        }
        if (!sig.variadic && expr.args.length > sig.param_types.length) {
          throw this.err(
            this.line(),
            `function '${expr.name}' expects ${stdToStr(sig.param_types.length)} argument${sig.param_types.length === 1 ? "" : "s"}, got ${stdToStr(expr.args.length)}`
          );
        }
      }
      for (let i = 0; i < fixed && i < expr.args.length; i++) {
        const at = this.resolveExpr(expr.args[i]);
        if (at !== sig.param_types[i]) {
          throw this.err(
            this.line(),
            `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects ${typeToString(sig.param_types[i])}, got ${typeToString(at)}`
          );
        }
        if (sig.param_types[i] === TypeKind.Array) {
          const argElem = this.exprElementDesc(expr.args[i]);
          if (!typeDescEquals(argElem, sig.param_elems[i])) {
            throw this.err(
              this.line(),
              `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects array of ${typeDescToString(sig.param_elems[i])}, got array of ${typeDescToString(argElem)}`
            );
          }
        }
        if (sig.param_types[i] === TypeKind.Tuple) {
          const argMembers = this.exprTupleMembers(expr.args[i]);
          if (!typeDescListEquals(argMembers, sig.param_tuple_members[i])) {
            throw this.err(
              this.line(),
              `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects tuple ${tupleTypeToString(sig.param_tuple_members[i])}, got tuple ${tupleTypeToString(argMembers)}`
            );
          }
        }
        if (sig.param_types[i] === TypeKind.Function) {
          const atd = this.exprFunctionType(expr.args[i]);
          const expected = sig.param_descs[i];
          if (!atd.fn_info || !typeDescEquals(atd, expected)) {
            throw this.err(
              this.line(),
              `type mismatch: argument ${stdToStr(i + 1)} of '${expr.name}' expects ${typeDescToString(expected)}, got ${
                atd.type === TypeKind.Function ? typeDescToString(atd) : typeToString(at)
              }`
            );
          }
        }
      }
      if (sig.variadic) {
        for (let i = fixed; i < expr.args.length; i++) {
          const at = this.resolveExpr(expr.args[i]);
          if (at !== sig.variadic_elem.type) {
            throw this.err(
              this.line(),
              `type mismatch: variadic argument ${stdToStr(i + 1)} of '${expr.name}' expects ${typeDescToString(sig.variadic_elem)}, got ${typeToString(at)}`
            );
          }
        }
      }
      if (expr.is_partial) {
        result = TypeKind.Function;
        expr.resolved_type = result;
        return result;
      }
      if (sig.has_return) {
        result = sig.return_type;
      } else {
        if (!this.allow_void_call_) {
          throw this.err(
            this.line(),
            `function '${expr.name}' returns nothing and cannot be used as a value`
          );
        }
        result = TypeKind.Unknown;
      }
    } else if (expr instanceof ArrayLiteral) {
      if (expr.elements.length === 0) {
        result = TypeKind.Array;
      } else {
        this.resolveExpr(expr.elements[0]);
        const first = this.exprDesc(expr.elements[0]);
        if (first.type === TypeKind.Unknown) {
          throw this.err(this.line(), "cannot infer array element type");
        }
        if (first.type === TypeKind.Array && !descFullyKnown(first)) {
          throw this.err(this.line(), "cannot infer nested array element type");
        }
        for (let i = 1; i < expr.elements.length; i++) {
          this.resolveExpr(expr.elements[i]);
          const t = this.exprDesc(expr.elements[i]);
          if (!typeDescEquals(t, first)) {
            throw this.err(
              this.line(),
              `array elements must all be the same type, got ${typeDescToString(first)} and ${typeDescToString(t)}`
            );
          }
        }
        expr.elem = first;
        result = TypeKind.Array;
      }
    } else if (expr instanceof TupleLiteral) {
      expr.resolved_members = [];
      for (let i = 0; i < expr.values.length; i++) {
        this.resolveExpr(expr.values[i]);
        const m = this.exprDesc(expr.values[i]);
        if (m.type === TypeKind.Unknown) {
          throw this.err(this.line(), "cannot infer tuple member type");
        }
        expr.resolved_members.push(m);
      }
      result = TypeKind.Tuple;
    } else if (expr instanceof ArrayIndexExpr) {
      if (expr.base) {
        const bt = this.resolveExpr(expr.base);
        if (bt === TypeKind.Unknown) {
          throw this.err(this.line(), "cannot index value with unknown type");
        }
        const bd = this.exprDesc(expr.base);
        if (bd.type === TypeKind.Array) {
          const it = this.resolveExpr(expr.index);
          if (it !== TypeKind.Int && it !== TypeKind.Enum) {
            throw this.err(this.line(), `array index must be int, got ${typeToString(it)}`);
          }
          expr.elem = elementOf(bd);
          result = expr.elem.type;
        } else if (bd.type === TypeKind.Text) {
          const it = this.resolveExpr(expr.index);
          if (it !== TypeKind.Int) {
            throw this.err(this.line(), `text index must be int, got ${typeToString(it)}`);
          }
          expr.is_text = true;
          expr.elem = mkType(TypeKind.Char);
          result = TypeKind.Char;
        } else if (bd.type === TypeKind.Tuple) {
          result = this.resolveTupleIndex(expr, bd.tuple_members, this.line());
        } else {
          throw this.err(this.line(), `cannot index value of type ${typeToString(bd.type)}`);
        }
        expr.resolved_type = result;
        return result;
      }
      let sym = this.findSymbol(expr.name);
      if (!sym) sym = this.findOuterSymbol(expr.name);
      if (!sym) {
        throw this.err(this.line(), `undefined variable '${expr.name}'`);
      }
      if (sym.type === TypeKind.Array) {
        const it = this.resolveExpr(expr.index);
        if (it !== TypeKind.Int && it !== TypeKind.Enum) {
          throw this.err(this.line(), `array index must be int, got ${typeToString(it)}`);
        }
        if (sym.elem.type === TypeKind.Unknown) {
          throw this.err(this.line(), `cannot index array '${expr.name}' with unknown element type`);
        }
        expr.elem = sym.elem;
        result = sym.elem.type;
      } else if (sym.type === TypeKind.Text) {
        const it = this.resolveExpr(expr.index);
        if (it !== TypeKind.Int) {
          throw this.err(this.line(), `text index must be int, got ${typeToString(it)}`);
        }
        expr.is_text = true;
        expr.elem = mkType(TypeKind.Char);
        result = TypeKind.Char;
      } else if (sym.type === TypeKind.Tuple) {
        result = this.resolveTupleIndex(expr, sym.tuple_members, this.line());
      } else {
        throw this.err(this.line(), `variable '${expr.name}' is not an array`);
      }
    } else if (expr instanceof MemberAccessExpr) {
        // base.member — enum member reference (base = enum type name) or
        // struct field access (base = struct value).
        if (expr.base instanceof Identifier) {
          const tit = this.type_decls_.get(expr.base.name);
          if (tit) {
            let enumDesc = mkType(TypeKind.Unknown);
            const td = tit;
            if (td.tdecl_kind === TypeDeclKind.Enum) {
              enumDesc = mkType(TypeKind.Enum);
              enumDesc.type_name = td.name;
            } else if (td.tdecl_kind === TypeDeclKind.Alias) {
              const decomp = this.resolveNamedType(td.name, [], true);
              if (decomp.type === TypeKind.Enum) enumDesc = decomp;
            }
            if (enumDesc.type === TypeKind.Enum) {
              const et = this.type_decls_.get(enumDesc.type_name)!;
              if (et.tdecl_kind !== TypeDeclKind.Enum) {
                throw this.err(this.line(), `internal: '${enumDesc.type_name}' is not an enum`);
              }
              let vi = -1;
              for (let i = 0; i < et.variants.length; i++) {
                if (et.variants[i] === expr.member) { vi = i; break; }
              }
              if (vi < 0) {
                throw this.err(
                  this.line(),
                  `enum type '${enumDesc.type_name}' has no variant '${expr.member}'`
                );
              }
              expr.is_enum_member = true;
              expr.enum_type_name = enumDesc.type_name;
              expr.enum_index = vi;
              result = TypeKind.Enum;
              expr.resolved_type = result;
              return result;
            }
            throw this.err(this.line(), `cannot use type '${expr.base.name}' as a value`);
          }
        }
        const bt = this.resolveExpr(expr.base);
        if (bt === TypeKind.Unknown) {
          throw this.err(this.line(), "cannot resolve type in member access");
        }
        const bd = this.exprDesc(expr.base);
        if (bd.type !== TypeKind.Struct) {
          throw this.err(
            this.line(),
            `cannot access member '${expr.member}' of ${typeDescToString(bd)}`
          );
        }
        const stt = this.type_decls_.get(typeInstName(bd));
        if (!stt || stt.tdecl_kind !== TypeDeclKind.Struct) {
          throw this.err(this.line(), `internal: unknown struct type '${typeInstName(bd)}'`);
        }
        const sfields = stt.fields;
        let sfi = -1;
        for (let i = 0; i < sfields.length; i++) {
          if (sfields[i].name === expr.member) { sfi = i; break; }
        }
        if (sfi < 0) {
          throw this.err(
            this.line(),
            `struct type '${typeDescToString(bd)}' has no field '${expr.member}'`
          );
        }
        expr.is_field = true;
        expr.struct_name = typeInstName(bd);
        expr.field_index = sfi;
        expr.field_desc = sfields[sfi].desc;
        result = expr.field_desc.type;
      } else if (expr instanceof ConditionalExpr) {
      const conditionType = this.resolveExpr(expr.condition);
      if (conditionType !== TypeKind.Bool) {
        throw this.err(this.line(), `ternary condition must be bool, got ${typeToString(conditionType)}`);
      }
      const thenType = this.resolveExpr(expr.then_expr);
      const elseType = this.resolveExpr(expr.else_expr);
      if (thenType === TypeKind.Array || elseType === TypeKind.Array) {
        throw this.err(this.line(), "ternary branches cannot be arrays");
      }
      if (thenType === TypeKind.Tuple || elseType === TypeKind.Tuple) {
        throw this.err(this.line(), "ternary branches cannot be tuples");
      }
      if (thenType === TypeKind.Function || elseType === TypeKind.Function) {
        throw this.err(this.line(), "ternary branches cannot be functions");
      }
      if (thenType !== elseType) {
        throw this.err(
          this.line(),
          `ternary branches must have the same type, got ${typeToString(thenType)} and ${typeToString(elseType)}`
        );
      }
      result = thenType;
    } else if (expr instanceof CastExpr) {
      const operandType = this.resolveExpr(expr.operand);
      const operandNumeric =
        operandType === TypeKind.Int || operandType === TypeKind.Decimal ||
        operandType === TypeKind.Char || operandType === TypeKind.Byte;
      const targetNumeric =
        expr.target_type === TypeKind.Int || expr.target_type === TypeKind.Decimal ||
        expr.target_type === TypeKind.Char || expr.target_type === TypeKind.Byte;
      const numeric = operandNumeric && targetNumeric;
      if (!numeric) {
        throw this.err(this.line(), "casts are only supported between int and decimal");
      }
      result = expr.target_type;
    } else if (expr instanceof BinaryExpr) {
      const lt = this.resolveExpr(expr.left);
      const rt = this.resolveExpr(expr.right);
      if (lt === TypeKind.Unknown || rt === TypeKind.Unknown) {
        throw this.err(this.line(), "cannot resolve type in expression");
      }
      if (lt === TypeKind.Array || rt === TypeKind.Array) {
        throw this.err(this.line(), `operator '${expr.op}' not defined for type array`);
      }
      if (lt === TypeKind.Tuple || rt === TypeKind.Tuple) {
        throw this.err(this.line(), `operator '${expr.op}' not defined for type tuple`);
      }
      if (lt === TypeKind.Struct || rt === TypeKind.Struct) {
        throw this.err(this.line(), `operator '${expr.op}' not defined for type struct`);
      }
      // M16: enum operands. Two enums: only ==/!= across the same enum
      // (nominal). Enum + int: implicit enum->int for arithmetic and
      // relational operators; ==/!= with an int is rejected.
      if (lt === TypeKind.Enum || rt === TypeKind.Enum) {
        if (lt === TypeKind.Enum && rt === TypeKind.Enum) {
          if (expr.op !== "==" && expr.op !== "!=") {
            throw this.err(
              this.line(),
              `operator '${expr.op}' not defined for enum types (only == and != allowed)`
            );
          }
          const ld = this.exprDesc(expr.left);
          const rd = this.exprDesc(expr.right);
          if (ld.type_name !== rd.type_name) {
            throw this.err(
              this.line(),
              `type mismatch: cannot compare enum '${typeDescToString(ld)}' with '${typeDescToString(rd)}'`
            );
          }
          result = TypeKind.Bool;
          expr.resolved_type = result;
          return result;
        }
        const other = lt === TypeKind.Enum ? rt : lt;
        if (other !== TypeKind.Int) {
          throw this.err(
            this.line(),
            `type mismatch in binary expression: ${typeToString(lt)} ${expr.op} ${typeToString(rt)}`
          );
        }
        if (expr.op === "==" || expr.op === "!=") {
          throw this.err(
            this.line(),
            "cannot compare an enum value with an int; compare it with another enum value instead"
          );
        }
        if (expr.ekind === ExprKind.Logical) {
          throw this.err(this.line(), `operator '${expr.op}' not defined for enum types`);
        }
        result = expr.ekind === ExprKind.Arithmetic ? TypeKind.Int : TypeKind.Bool;
        expr.resolved_type = result;
        return result;
      }
      if (lt !== rt) {
        const byteNumericMix =
          (lt === TypeKind.Byte && (rt === TypeKind.Int || rt === TypeKind.Decimal)) ||
          (rt === TypeKind.Byte && (lt === TypeKind.Int || lt === TypeKind.Decimal));
        if (!byteNumericMix) {
          throw this.err(
            this.line(),
            `type mismatch in binary expression: ${typeToString(lt)} ${expr.op} ${typeToString(rt)}`
          );
        }
      }
      switch (expr.ekind) {
        case ExprKind.Arithmetic:
          if (expr.op === "%") {
            if (
              !(
                (lt === TypeKind.Int || lt === TypeKind.Byte) &&
                (rt === TypeKind.Int || rt === TypeKind.Byte)
              )
            ) {
              throw this.err(this.line(), `operator '%' not defined for type ${typeToString(lt)}`);
            }
            result = TypeKind.Int;
            break;
          }
          if (lt === TypeKind.Text && expr.op === "+") {
            result = TypeKind.Text;
            break;
          }
          if (lt === TypeKind.Text || lt === TypeKind.Bool || lt === TypeKind.Char) {
            throw this.err(this.line(), `operator '${expr.op}' not defined for type ${typeToString(lt)}`);
          }
          if (lt === TypeKind.Byte || rt === TypeKind.Byte) {
            // byte participates in arithmetic via numeric promotion; the
            // result is int (or decimal when a decimal is present).
            result =
              lt === TypeKind.Decimal || rt === TypeKind.Decimal
                ? TypeKind.Decimal
                : TypeKind.Int;
            break;
          }
          result = lt;
          break;
        case ExprKind.Comparison:
          if (lt === TypeKind.Text) {
            if (expr.op !== "==" && expr.op !== "!=") {
              throw this.err(this.line(), `operator '${expr.op}' not defined for type text`);
            }
          }
          result = TypeKind.Bool;
          break;
        case ExprKind.Logical:
          if (lt !== TypeKind.Bool) {
            throw this.err(this.line(), `operator '${expr.op}' requires bool operands, got ${typeToString(lt)}`);
          }
          result = TypeKind.Bool;
          break;
      }
    } else if (expr instanceof NotExpr) {
      const ot = this.resolveExpr(expr.operand);
      if (ot !== TypeKind.Bool) {
        throw this.err(this.line(), `operator 'not' requires bool operand, got ${typeToString(ot)}`);
      }
      result = TypeKind.Bool;
    } else if (expr instanceof NegExpr) {
      const ot = this.resolveExpr(expr.operand);
      if (ot === TypeKind.Byte) {
        // Numeric promotion: -(byte) is an int.
        result = TypeKind.Int;
      } else if (ot !== TypeKind.Int && ot !== TypeKind.Decimal) {
        throw this.err(this.line(), `operator '-' not defined for type ${typeToString(ot)}`);
      } else {
        result = ot;
      }
    }
    expr.resolved_type = result;
    return result;
  }

  // ---- statement resolution ----

  /**
   * M14 (audit #5): resolve + define an individual top-level state declaration.
   * Used for VarDecl and DestructDecl, which may come from the entry file or an
   * imported module (carrying their own `file` for the diagnostics prefix).
   */
  resolveVarDecl(vd: VarDecl): void {
    const initType = this.resolveExpr(vd.initializer);
    if (vd.has_annotation) {
      if (vd.annotation === TypeKind.Byte) {
        const number = vd.initializer instanceof NumberLiteral ? vd.initializer : null;
        if (number && (number.value < 0 || number.value > 255)) {
          throw this.err(vd.line, "byte value must be between 0 and 255");
        }
      }
      if (initType !== TypeKind.Unknown && initType !== vd.annotation) {
        const byteLiteral = vd.annotation === TypeKind.Byte && vd.initializer instanceof NumberLiteral;
        if (!byteLiteral) {
          throw this.err(
            vd.line,
            `type mismatch: variable '${vd.name}' declared as ${typeToString(vd.annotation)} but initialized with ${typeToString(initType)}`
          );
        }
      }
      if (vd.annotation === TypeKind.Function) {
        const initDesc = this.exprFunctionType(vd.initializer);
        if (!typeDescEquals(initDesc, vd.annotation_desc)) {
          throw this.err(
            vd.line,
            `type mismatch: variable '${vd.name}' declared as ${typeDescToString(vd.annotation_desc)} but initialized with ${
              initDesc.type === TypeKind.Function ? typeDescToString(initDesc) : typeToString(initType)
            }`
          );
        }
        this.define(vd.name, TypeKind.Function, vd.is_mutable, mkType(TypeKind.Unknown), [], vd.annotation_desc);
      } else if (vd.annotation === TypeKind.Array) {
        if (vd.initializer instanceof ArrayLiteral) {
          fixEmptyArrayLiteral(vd.initializer, vd.elem_desc);
          if (!typeDescEquals(vd.initializer.elem, vd.elem_desc)) {
            throw this.err(
              vd.line,
              `type mismatch: variable '${vd.name}' declared as array of ${typeDescToString(vd.elem_desc)} but initialized with array of ${typeDescToString(vd.initializer.elem)}`
            );
          }
        } else if (!descFullyKnown(vd.elem_desc)) {
          throw this.err(
            vd.line,
            `cannot infer array element type for '${vd.name}'; use a complete annotation like [[int]]`
          );
        }
        this.define(vd.name, TypeKind.Array, vd.is_mutable, vd.elem_desc);
      } else if (vd.annotation === TypeKind.Tuple) {
        if (initType !== TypeKind.Tuple) {
          throw this.err(
            vd.line,
            `type mismatch: variable '${vd.name}' declared as ${tupleTypeToString(vd.tuple_members)} but initialized with ${typeToString(initType)}`
          );
        }
        if (!typeDescListEquals(this.exprTupleMembers(vd.initializer), vd.tuple_members)) {
          throw this.err(
            vd.line,
            `type mismatch: variable '${vd.name}' declared as ${tupleTypeToString(vd.tuple_members)} but initialized with ${tupleTypeToString(this.exprTupleMembers(vd.initializer))}`
          );
        }
        this.define(vd.name, TypeKind.Tuple, vd.is_mutable, mkType(TypeKind.Unknown), [...vd.tuple_members]);
      } else if (vd.annotation === TypeKind.Struct || vd.annotation === TypeKind.Enum) {
        const initDesc = this.exprDesc(vd.initializer);
        if (!this.typesMatch(initDesc, vd.annotation_desc)) {
          throw this.err(
            vd.line,
            `type mismatch: variable '${vd.name}' declared as ${typeDescToString(vd.annotation_desc)} but initialized with ${typeDescToString(initDesc)}`
          );
        }
        this.define(vd.name, vd.annotation, vd.is_mutable, mkType(TypeKind.Unknown), [], vd.annotation_desc);
      } else {
        this.define(vd.name, vd.annotation, vd.is_mutable);
      }
    } else {
      if (initType === TypeKind.Unknown) {
        throw this.err(vd.line, `cannot infer type for '${vd.name}'`);
      }
      let elem = mkType(TypeKind.Unknown);
      if (initType === TypeKind.Array) {
        elem = this.exprElementDesc(vd.initializer);
        if (!descFullyKnown(elem)) {
          throw this.err(
            vd.line,
            `cannot infer array element type for '${vd.name}'; use an annotation like [int]`
          );
        }
        vd.elem_desc = elem;
      }
      if (initType === TypeKind.Tuple) {
        vd.tuple_members = this.exprTupleMembers(vd.initializer);
        if (vd.tuple_members.length === 0) {
          throw this.err(
            vd.line,
            `cannot infer tuple type for '${vd.name}'; use an annotation like (int, int)`
          );
        }
      }
      vd.annotation = initType;
      if (initType === TypeKind.Function) {
        const initDesc = this.exprFunctionType(vd.initializer);
        if (!initDesc.fn_info) {
          throw this.err(
            vd.line,
            `cannot infer function type for '${vd.name}'; use an annotation like fn(int) -> int`
          );
        }
        vd.annotation_desc = initDesc;
        this.define(vd.name, initType, vd.is_mutable, mkType(TypeKind.Unknown), [], initDesc);
      } else if (initType === TypeKind.Struct || initType === TypeKind.Enum) {
        const initDesc = this.exprDesc(vd.initializer);
        vd.annotation_desc = initDesc;
        this.define(vd.name, initType, vd.is_mutable, mkType(TypeKind.Unknown), [], initDesc);
      } else {
        this.define(vd.name, initType, vd.is_mutable, elem, vd.tuple_members);
      }
    }
  }

  /** M14: resolve + define an individual top-level destructuring declaration. */
  resolveDestructDecl(td: DestructDecl): void {
    const srcType = this.resolveExpr(td.rhs);
    let val = mkType(TypeKind.Unknown);
    if (srcType === TypeKind.Tuple) {
      td.destruct_type = TypeKind.Tuple;
      td.tuple_members = this.exprTupleMembers(td.rhs);
      val.type = TypeKind.Tuple;
      val.tuple_members = td.tuple_members;
    } else if (srcType === TypeKind.Array) {
      const ed = this.exprElementDesc(td.rhs);
      if (!descFullyKnown(ed)) {
        throw this.err(td.line, "cannot infer element type for this array destructuring");
      }
      td.destruct_type = TypeKind.Array;
      td.destruct_elem = ed;
      val.type = TypeKind.Array;
      val.elem = ed;
    } else if (srcType === TypeKind.Text) {
      td.destruct_type = TypeKind.Text;
      val.type = TypeKind.Text;
    } else {
      throw this.err(
        td.line,
        `right side of destructuring must be a tuple, array, or text, got ${typeToString(srcType)}`
      );
    }
    this.applyDestructPattern(td.patterns, val, td.line, true, td.is_mutable);
  }

  resolveStatement(stmt: Statement): boolean {
    this.current_line_ = stmt.line;
    let always_returns = false;
    if (stmt instanceof TypeDecl) {
      throw this.err(stmt.line, "type declarations are only allowed at the top level");
    } else if (stmt instanceof FunctionDecl) {
      // M17: templates are never resolved directly; their instantiations are.
      if (stmt.type_params.length === 0) this.resolveFunctionDecl(stmt);
      always_returns = false;
    } else if (stmt instanceof VarDecl) {
      this.resolveVarDecl(stmt);
    } else if (stmt instanceof ArrayAssignStmt) {
      const aassign = stmt;
      const sym = this.findSymbol(aassign.name);
      if (!sym) {
        if (this.isInOuterScopes(aassign.name)) {
          throw this.err(stmt.line, `cannot assign to captured variable '${aassign.name}'`);
        }
        throw this.err(stmt.line, `undefined variable '${aassign.name}'`);
      }
      if (sym.type === TypeKind.Text) {
        throw this.err(stmt.line, "cannot assign to a character of a text value");
      }
      if (sym.type !== TypeKind.Array) {
        throw this.err(stmt.line, `variable '${aassign.name}' is not an array`);
      }
      if (!sym.is_mutable) {
        throw this.err(stmt.line, `cannot modify immutable variable '${aassign.name}'`);
      }
      const it = this.resolveExpr(aassign.index);
      if (it !== TypeKind.Int) {
        throw this.err(stmt.line, `array index must be int, got ${typeToString(it)}`);
      }
      if (sym.elem.type === TypeKind.Unknown) {
        throw this.err(stmt.line, `cannot index array '${aassign.name}' with unknown element type`);
      }
      const vt = this.resolveExpr(aassign.rhs);
      if (vt !== sym.elem.type) {
        throw this.err(
          stmt.line,
          `type mismatch: cannot assign ${typeToString(vt)} to array element of ${typeDescToString(sym.elem)}`
        );
      }
    } else if (stmt instanceof ElementAssignStmt) {
      const eassign = stmt;
      const tt = this.resolveExpr(eassign.target);
      const tidx = eassign.target as ArrayIndexExpr;
      if (tidx.is_text) {
        throw this.err(stmt.line, "cannot assign to a character of a text value");
      }
      if (tidx.is_tuple) {
        const base = tidx.base;
        const tsym = base ? this.findSymbol((base as ArrayIndexExpr).name) : null;
        if (tsym && tsym.type === TypeKind.Tuple && !tsym.is_mutable) {
          throw this.err(stmt.line, "cannot modify immutable tuple");
        }
      }
      const vt = this.resolveExpr(eassign.rhs);
      if (vt !== tt) {
        throw this.err(
          stmt.line,
          `type mismatch: cannot assign ${typeToString(vt)} to element of ${typeDescToString(tidx.elem)}`
        );
      }
    } else if (stmt instanceof AssignStmt) {
      const assign = stmt;
      if (!this.hasType(assign.name)) {
        if (this.isInOuterScopes(assign.name)) {
          throw this.err(stmt.line, `cannot assign to captured variable '${assign.name}'`);
        }
        throw this.err(stmt.line, `undefined variable '${assign.name}'`);
      }
      const symbol = this.findSymbol(assign.name);
      if (symbol && !symbol.is_mutable) {
        throw this.err(stmt.line, `cannot modify immutable variable '${assign.name}'`);
      }
      const varType = this.getType(assign.name);
      // Stash the target's declared type so codegen can apply byte wrap-around
      // semantics (uint8) for ++/--/compound stores, mirroring C's unsigned
      // char. Nothing else reads a statement's resolved_type.
      assign.resolved_type = varType;
      if (assign.op === "++" || assign.op === "--") {
        if (
          varType !== TypeKind.Int &&
          varType !== TypeKind.Decimal &&
          varType !== TypeKind.Byte
        ) {
          throw this.err(
            stmt.line,
            `operator '${assign.op}' requires int or decimal, got ${typeToString(varType)}`
          );
        }
      } else if (assign.op === "=") {
        const rhsType = this.resolveExpr(assign.rhs!);
        if (rhsType !== varType) {
          throw this.err(
            stmt.line,
            `type mismatch: cannot assign ${typeToString(rhsType)} to ${typeToString(varType)}`
          );
        }
        if (varType === TypeKind.Array && symbol) {
          const rd = this.exprElementDesc(assign.rhs!);
          if (!typeDescEquals(rd, symbol.elem)) {
            throw this.err(
              stmt.line,
              `type mismatch: cannot assign array of ${typeDescToString(rd)} to ${typeDescToString(symbol.elem)}`
            );
          }
        }
        if (varType === TypeKind.Tuple && symbol) {
          if (!typeDescListEquals(this.exprTupleMembers(assign.rhs!), symbol.tuple_members)) {
            throw this.err(
              stmt.line,
              `type mismatch: cannot assign tuple ${tupleTypeToString(this.exprTupleMembers(assign.rhs!))} to ${tupleTypeToString(symbol.tuple_members)}`
            );
          }
        }
        if (varType === TypeKind.Function && symbol) {
          const rhsDesc = this.exprFunctionType(assign.rhs!);
          if (!typeDescEquals(rhsDesc, symbol.desc)) {
            throw this.err(
              stmt.line,
              `type mismatch: cannot assign ${
                rhsDesc.type === TypeKind.Function ? typeDescToString(rhsDesc) : typeToString(rhsType)
              } to ${typeDescToString(symbol.desc)}`
            );
          }
        }
        if ((varType === TypeKind.Struct || varType === TypeKind.Enum) && symbol) {
          const rd = this.exprDesc(assign.rhs!);
          if (!this.typesMatch(rd, symbol.desc)) {
            throw this.err(
              stmt.line,
              `type mismatch: cannot assign ${typeDescToString(rd)} to ${typeDescToString(symbol.desc)}`
            );
          }
        }
      } else {
        if (
          assign.op === "%=" &&
          varType !== TypeKind.Int &&
          varType !== TypeKind.Byte
        ) {
          throw this.err(stmt.line, `operator '%=' requires int, got ${typeToString(varType)}`);
        }
        if (
          varType !== TypeKind.Int &&
          varType !== TypeKind.Decimal &&
          varType !== TypeKind.Byte
        ) {
          throw this.err(
            stmt.line,
            `operator '${assign.op}' requires int or decimal, got ${typeToString(varType)}`
          );
        }
        const rhsType = this.resolveExpr(assign.rhs!);
        const rhsOk =
          rhsType === varType ||
          (varType === TypeKind.Byte && (rhsType === TypeKind.Int || rhsType === TypeKind.Byte));
        if (!rhsOk) {
          throw this.err(
            stmt.line,
            `type mismatch in compound assignment: ${typeToString(varType)} ${assign.op} ${typeToString(rhsType)}`
          );
        }
      }
    } else if (stmt instanceof MemberAssignStmt) {
      const massign = stmt;
      // Reject assignment to an enum member (`Color.Red = ...`).
      if (massign.base instanceof Identifier) {
        const bite = this.type_decls_.get(massign.base.name);
        if (bite) {
          let probe = mkType(TypeKind.Unknown);
          if (bite.tdecl_kind === TypeDeclKind.Enum) {
            probe = mkType(TypeKind.Enum);
            probe.type_name = bite.name;
          } else if (bite.tdecl_kind === TypeDeclKind.Alias) {
            const decomp = this.resolveNamedType(bite.name, [], true);
            if (decomp.type === TypeKind.Enum) probe = decomp;
          }
          if (probe.type === TypeKind.Enum) {
            throw this.err(
              stmt.line,
              `cannot assign to enum member '${massign.base.name}.${massign.member}'`
            );
          }
        }
      }
      const mbt = this.resolveExpr(massign.base);
      if (mbt === TypeKind.Unknown) {
        throw this.err(stmt.line, "cannot resolve type in member assignment");
      }
      const mbd = this.exprDesc(massign.base);
      if (mbd.type !== TypeKind.Struct) {
        throw this.err(
          stmt.line,
          `cannot assign to member '${massign.member}' of ${typeDescToString(mbd)}`
        );
      }
      const mast = this.type_decls_.get(typeInstName(mbd));
      if (!mast || mast.tdecl_kind !== TypeDeclKind.Struct) {
        throw this.err(stmt.line, `internal: unknown struct type '${typeInstName(mbd)}'`);
      }
      const mfields = mast.fields;
      let mfi = -1;
      for (let i = 0; i < mfields.length; i++) {
        if (mfields[i].name === massign.member) { mfi = i; break; }
      }
      if (mfi < 0) {
        throw this.err(
          stmt.line,
          `struct type '${mbd.type_name}' has no field '${massign.member}'`
        );
      }
      // Root-identifier walk for immutability / capture checks.
      let rootName = "";
      let cur: Expression | null = massign.base;
      while (cur) {
        if (cur instanceof MemberAccessExpr) {
          cur = cur.base;
        } else if (cur instanceof ArrayIndexExpr) {
          if (cur.base) {
            cur = cur.base;
          } else {
            rootName = cur.name;
            break;
          }
        } else if (cur instanceof Identifier) {
          rootName = cur.name;
          break;
        } else {
          break;
        }
      }
      if (rootName === "") {
        throw this.err(
          stmt.line,
          "cannot modify a struct held in an expression; assign through a variable"
        );
      }
      const tsym = this.findSymbol(rootName);
      if (!tsym && this.isInOuterScopes(rootName)) {
        throw this.err(stmt.line, `cannot modify captured variable '${rootName}'`);
      }
      if (tsym && !tsym.is_mutable) {
        throw this.err(stmt.line, `cannot modify immutable variable '${rootName}'`);
      }
      const mfd = mfields[mfi].desc;
      if (massign.op === "++" || massign.op === "--") {
        if (mfd.type !== TypeKind.Int && mfd.type !== TypeKind.Decimal && mfd.type !== TypeKind.Byte) {
          throw this.err(
            stmt.line,
            `operator '${massign.op}' requires int or decimal, got ${typeDescToString(mfd)}`
          );
        }
      } else if (massign.op === "=") {
        this.resolveExpr(massign.rhs!);
        const mrd = this.exprDesc(massign.rhs!);
        if (!this.typesMatch(mrd, mfd)) {
          throw this.err(
            stmt.line,
            `type mismatch: cannot assign ${typeDescToString(mrd)} to field '${massign.member}' (expects ${typeDescToString(mfd)})`
          );
        }
      } else {
        if (mfd.type === TypeKind.Enum) {
          throw this.err(stmt.line, "compound assignment is not allowed on enum fields");
        }
        if (mfd.type !== TypeKind.Int && mfd.type !== TypeKind.Decimal && mfd.type !== TypeKind.Byte) {
          throw this.err(
            stmt.line,
            `operator '${massign.op}' requires int or decimal, got ${typeDescToString(mfd)}`
          );
        }
        const mvt = this.resolveExpr(massign.rhs!);
        const mrhsOk =
          mvt === mfd.type ||
          (mfd.type === TypeKind.Byte && (mvt === TypeKind.Int || mvt === TypeKind.Byte));
        if (!mrhsOk) {
          throw this.err(
            stmt.line,
            `type mismatch in compound assignment: ${typeDescToString(mfd)} ${massign.op} ${typeToString(mvt)}`
          );
        }
      }
      massign.struct_name = typeInstName(mbd);
      massign.field_index = mfi;
      massign.field_desc = mfd;
    } else if (stmt instanceof PrintStmt) {
      for (const arg of stmt.args) {
        const pt = this.resolveExpr(arg);
        if (pt === TypeKind.Array) {
          throw this.err(stmt.line, "cannot print an array; index its elements or use length(arr)");
        }
        if (pt === TypeKind.Function) {
          throw this.err(stmt.line, "cannot print a function");
        }
        if (pt === TypeKind.Tuple) {
          throw this.err(stmt.line, "cannot print a tuple; destructure it or index its elements");
        }
        if (pt === TypeKind.Struct) {
          throw this.err(stmt.line, "cannot print a struct value");
        }
      }
    } else if (stmt instanceof ExprStmt) {
      const saved = this.allow_void_call_;
      this.allow_void_call_ = true;
      this.resolveExpr(stmt.expr);
      this.allow_void_call_ = saved;
    } else if (stmt instanceof DeferStmt) {
      const bad = findDeferExit(stmt.body);
      if (bad) {
        const what =
          bad instanceof ReturnStmt ? "return" : bad instanceof BreakStmt ? "break" : "continue";
        throw this.err(bad.line, `${what} is not allowed inside a defer block`);
      }
      this.pushScope();
      for (const s of stmt.body) this.resolveStatement(s);
      this.popScope();
    } else if (stmt instanceof DestructDecl) {
      this.resolveDestructDecl(stmt);
    } else if (stmt instanceof MultiAssignStmt) {
      const ma = stmt;
      const srcType = this.resolveExpr(ma.rhs);
      let val = mkType(TypeKind.Unknown);
      if (srcType === TypeKind.Tuple) {
        ma.destruct_type = TypeKind.Tuple;
        ma.tuple_members = this.exprTupleMembers(ma.rhs);
        val.type = TypeKind.Tuple;
        val.tuple_members = ma.tuple_members;
      } else if (srcType === TypeKind.Array) {
        const ed = this.exprElementDesc(ma.rhs);
        if (!descFullyKnown(ed)) {
          throw this.err(stmt.line, "cannot infer element type for this array destructuring");
        }
        ma.destruct_type = TypeKind.Array;
        ma.destruct_elem = ed;
        val.type = TypeKind.Array;
        val.elem = ed;
      } else if (srcType === TypeKind.Text) {
        ma.destruct_type = TypeKind.Text;
        val.type = TypeKind.Text;
      } else {
        throw this.err(
          stmt.line,
          `right side of destructuring must be a tuple, array, or text, got ${typeToString(srcType)}`
        );
      }
      this.applyDestructPattern(ma.patterns, val, stmt.line, false, false);
    } else if (stmt instanceof LoopStmt) {
      const loop = stmt;
      const ct = this.resolveExpr(loop.count);
      if (ct !== TypeKind.Int) {
        throw this.err(stmt.line, `loop count must be int, got ${typeToString(ct)}`);
      }
      this.pushScope();
      this.loop_depth_++;
      this.lex_loop_stack_.push(loop);
      for (const s of loop.body) this.resolveStatement(s);
      this.lex_loop_stack_.pop();
      this.loop_depth_--;
      this.popScope();
    } else if (stmt instanceof ForeachStmt) {
      const fe = stmt;
      const it = this.resolveExpr(fe.iterable);
      if (it !== TypeKind.Array && it !== TypeKind.Text) {
        throw this.err(stmt.line, `foreach iterable must be an array or text, got ${typeToString(it)}`);
      }
      this.pushScope();
      if (fe.index_name.length > 0) {
        this.define(fe.index_name, TypeKind.Int);
      }
      if (it === TypeKind.Array) {
        const ed = this.exprElementDesc(fe.iterable);
        if (!descFullyKnown(ed)) {
          throw this.err(stmt.line, "foreach cannot infer element type for this array");
        }
        fe.elem = ed;
        this.define(fe.value_name, ed.type, true, elementOf(ed), ed.tuple_members, ed);
      } else {
        fe.elem = mkType(TypeKind.Char);
        this.define(fe.value_name, TypeKind.Char);
      }
      this.loop_depth_++;
      this.lex_loop_stack_.push(fe);
      for (const s of fe.body) this.resolveStatement(s);
      this.lex_loop_stack_.pop();
      this.loop_depth_--;
      this.popScope();
    } else if (stmt instanceof WhileStmt) {
      const ct = this.resolveExpr(stmt.condition);
      if (ct !== TypeKind.Bool) {
        throw this.err(stmt.line, `while condition must be bool, got ${typeToString(ct)}`);
      }
      this.pushScope();
      this.loop_depth_++;
      this.lex_loop_stack_.push(stmt);
      for (const s of stmt.body) this.resolveStatement(s);
      this.lex_loop_stack_.pop();
      this.loop_depth_--;
      this.popScope();
    } else if (stmt instanceof ForStmt) {
      const for_stmt = stmt;
      if (for_stmt.init instanceof DestructDecl) {
        throw this.err(stmt.line, "tuple destructuring is not supported in for loop headers");
      }
      if (for_stmt.update instanceof MultiAssignStmt) {
        throw this.err(stmt.line, "tuple destructuring is not supported in for loop update");
      }
      this.pushScope();
      this.resolveStatement(for_stmt.init);
      this.current_line_ = stmt.line;
      const ct = this.resolveExpr(for_stmt.condition);
      if (ct !== TypeKind.Bool) {
        throw this.err(stmt.line, `for condition must be bool, got ${typeToString(ct)}`);
      }
      this.current_line_ = for_stmt.update.line;
      this.resolveStatement(for_stmt.update);
      this.loop_depth_++;
      this.lex_loop_stack_.push(for_stmt);
      for (const s of for_stmt.body) this.resolveStatement(s);
      this.lex_loop_stack_.pop();
      this.loop_depth_--;
      this.popScope();
    } else if (stmt instanceof DoWhileStmt) {
      const do_while = stmt;
      this.pushScope();
      this.loop_depth_++;
      this.lex_loop_stack_.push(do_while);
      for (const s of do_while.body) this.resolveStatement(s);
      this.lex_loop_stack_.pop();
      this.loop_depth_--;
      this.popScope();
      this.current_line_ = stmt.line;
      const ct = this.resolveExpr(do_while.condition);
      if (ct !== TypeKind.Bool) {
        throw this.err(stmt.line, `do-while condition must be bool, got ${typeToString(ct)}`);
      }
    } else if (stmt instanceof IfStmt) {
      const condType = this.resolveExpr(stmt.condition);
      if (condType !== TypeKind.Bool) {
        throw this.err(stmt.line, `if condition must be bool, got ${typeToString(condType)}`);
      }
      this.pushScope();
      const thenReturns = this.resolveStatementBlock(stmt.then_body);
      this.popScope();
      let elseReturns = false;
      if (stmt.has_else) {
        this.pushScope();
        elseReturns = this.resolveStatementBlock(stmt.else_body);
        this.popScope();
      }
      always_returns = stmt.has_else && thenReturns && elseReturns;
    } else if (stmt instanceof SwitchStmt) {
      const switchType = this.resolveExpr(stmt.value);
      const enumSwitch = switchType === TypeKind.Enum;
      if (switchType !== TypeKind.Int && switchType !== TypeKind.Byte && switchType !== TypeKind.Char && switchType !== TypeKind.Enum) {
        throw this.err(stmt.line, `switch value must be int, byte, char, or enum, got ${typeToString(switchType)}`);
      }
      const switchDesc = this.exprDesc(stmt.value);
      let hasDefault = false;
      const seenValues: number[] = [];
      let allCasesReturn = true;
      this.switch_entry_loop_depths_.push(this.loop_depth_);
      for (const c of stmt.cases) {
        if (c.is_default) {
          if (hasDefault) {
            throw this.err(stmt.line, "switch cannot have multiple default cases");
          }
          hasDefault = true;
        } else {
          const caseType = this.resolveExpr(c.value!);
          let caseValue = 0;
          if (enumSwitch) {
            // Cases may be enum members of the switched enum (nominal match,
            // codegen uses the ordinal) or int literals (implicit enum->int).
            if (c.value instanceof MemberAccessExpr) {
              if (!c.value.is_enum_member) {
                throw this.err(stmt.line, "switch case must be an enum member or int literal");
              }
              if (c.value.enum_type_name !== switchDesc.type_name) {
                throw this.err(stmt.line, "switch case enum type must match switch value type");
              }
              caseValue = c.value.enum_index;
            } else if (c.value instanceof NumberLiteral) {
              caseValue = c.value.value;
            } else {
              throw this.err(stmt.line, "switch cases must be enum members or int literals");
            }
          } else {
            if (caseType !== switchType) {
              throw this.err(stmt.line, "switch case type must match switch value type");
            }
            if (c.value instanceof NumberLiteral) {
              caseValue = c.value.value;
            } else if (c.value instanceof CharLiteral) {
              caseValue = c.value.value.charCodeAt(0);
            } else {
              throw this.err(stmt.line, "switch cases must be literal values");
            }
          }
          if (seenValues.includes(caseValue)) {
            throw this.err(stmt.line, "duplicate switch case value");
          }
          seenValues.push(caseValue);
        }
        this.pushScope();
        const caseReturns = this.resolveStatementBlock(c.body);
        this.popScope();
        if (!caseReturns) allCasesReturn = false;
      }
      this.switch_entry_loop_depths_.pop();
      always_returns = hasDefault && allCasesReturn;
    } else if (stmt instanceof ReturnStmt) {
      const ret = stmt;
      if (!this.in_function_) {
        throw this.err(stmt.line, "return outside of function");
      }
      ret.return_tuple_members = [...this.current_return_tuple_];
      if (ret.values.length === 0) {
        if (this.in_function_ && this.current_return_ !== TypeKind.Unknown) {
          throw this.err(
            stmt.line,
            `function expected to return ${typeToString(this.current_return_)} but bare return used`
          );
        }
      } else if (this.current_return_ === TypeKind.Unknown) {
        throw this.err(stmt.line, "return value in void function");
      } else if (this.current_return_ === TypeKind.Tuple) {
        if (ret.values.length === 1) {
          const vt = this.resolveExpr(ret.values[0]);
          if (vt !== TypeKind.Tuple) {
            throw this.err(
              stmt.line,
              `type mismatch: return ${typeToString(vt)} but function returns ${tupleTypeToString(this.current_return_tuple_)}`
            );
          }
          if (!typeDescListEquals(this.exprTupleMembers(ret.values[0]), this.current_return_tuple_)) {
            throw this.err(
              stmt.line,
              `type mismatch: return tuple ${tupleTypeToString(this.exprTupleMembers(ret.values[0]))} but function returns ${tupleTypeToString(this.current_return_tuple_)}`
            );
          }
        } else {
          if (ret.values.length !== this.current_return_tuple_.length) {
            throw this.err(
              stmt.line,
              `type mismatch: function returns ${stdToStr(this.current_return_tuple_.length)} values but return statement provides ${stdToStr(ret.values.length)}`
            );
          }
          for (let i = 0; i < ret.values.length; i++) {
            this.resolveExpr(ret.values[i]);
            const expected = this.current_return_tuple_[i];
            const ok = this.typesMatch(this.exprDesc(ret.values[i]), expected);
            if (!ok) {
              throw this.err(
                stmt.line,
                `type mismatch: return value ${stdToStr(i + 1)} has type ${typeDescToString(this.exprDesc(ret.values[i]))} but function member ${stdToStr(i + 1)} expects ${typeDescToString(expected)}`
              );
            }
          }
        }
      } else {
        if (ret.values.length !== 1) {
          throw this.err(
            stmt.line,
            `type mismatch: function returns a single ${typeToString(this.current_return_)} value but return statement provides ${stdToStr(ret.values.length)}`
          );
        }
        const vt = this.resolveExpr(ret.values[0]);
        if (vt !== this.current_return_) {
          throw this.err(
            stmt.line,
            `type mismatch: return ${typeToString(vt)} but function returns ${typeToString(this.current_return_)}`
          );
        }
        if (this.current_return_ === TypeKind.Struct || this.current_return_ === TypeKind.Enum) {
          const rt = this.exprDesc(ret.values[0]);
          if (!this.typesMatch(rt, this.current_return_desc_)) {
            throw this.err(
              stmt.line,
              `type mismatch: return ${typeDescToString(rt)} but function returns ${typeDescToString(this.current_return_desc_)}`
            );
          }
        }
        if (this.current_return_ === TypeKind.Function) {
          const rt = this.exprFunctionType(ret.values[0]);
          if (!typeDescEquals(rt, this.current_return_desc_)) {
            throw this.err(
              stmt.line,
              `type mismatch: return ${
                rt.type === TypeKind.Function ? typeDescToString(rt) : typeToString(vt)
              } but function returns ${typeDescToString(this.current_return_desc_)}`
            );
          }
        }
        if (this.current_return_ === TypeKind.Array) {
          const ed = this.exprElementDesc(ret.values[0]);
          if (!typeDescEquals(ed, this.current_return_elem_)) {
            throw this.err(
              stmt.line,
              `type mismatch: return array of ${typeDescToString(ed)} but function returns array of ${typeDescToString(this.current_return_elem_)}`
            );
          }
        }
      }
    } else if (stmt instanceof BreakStmt) {
      if (!stmt.nonlocal) {
        if (this.loop_depth_ === 0) {
          throw this.err(stmt.line, "break outside of a loop");
        }
        if (
          this.switch_entry_loop_depths_.length > 0 &&
          this.loop_depth_ <= this.switch_entry_loop_depths_[this.switch_entry_loop_depths_.length - 1]
        ) {
          throw this.err(stmt.line, "break inside a switch case requires an enclosing loop within the case");
        }
      }
    } else if (stmt instanceof ContinueStmt) {
      if (!stmt.nonlocal) {
        if (this.loop_depth_ === 0) {
          throw this.err(stmt.line, "continue outside of a loop");
        }
        if (
          this.switch_entry_loop_depths_.length > 0 &&
          this.loop_depth_ <= this.switch_entry_loop_depths_[this.switch_entry_loop_depths_.length - 1]
        ) {
          throw this.err(stmt.line, "continue inside a switch case requires an enclosing loop within the case");
        }
      }
    }
    if (stmt instanceof ReturnStmt) always_returns = true;
    return always_returns;
  }

  private resolveFunctionDecl(fn: FunctionDecl): void {
    const subject = fn.is_lambda ? "lambda" : `function '${fn.name}'`;
    const savedScopes = this.scopes_;
    this.scopes_ = [];
    this.pushScope();
    const savedOuter = this.outer_scope_stack_;
    this.outer_scope_stack_ = savedOuter;
    this.outer_scope_stack_.push(savedScopes);
    const savedFn = this.current_fn_;
    const savedOuterFns = this.outer_fns_;
    this.outer_fns_ = savedOuterFns;
    this.outer_fns_.push(savedFn);
    const savedFile = this.current_file_;
    this.current_fn_ = fn;
    if (fn.file.length > 0) this.current_file_ = fn.file;
    fn.captures = [];
    for (const p of fn.params) {
      this.define(p.name, p.type, true, p.elem_desc, p.tuple_members, paramTypeDesc(p));
      if (p.default_value) {
        const dt = this.inferFromLiteral(p.default_value);
        const expect = p.type === TypeKind.Byte ? TypeKind.Int : p.type;
        if (p.type === TypeKind.Function || dt === TypeKind.Unknown || dt !== expect) {
          throw this.err(
            fn.line,
            `default value for parameter '${p.name}' of ${subject} must be a literal of type ${
              p.type === TypeKind.Byte ? "byte" : typeToString(p.type)
            }`,
            fn.file
          );
        }
        if (p.type === TypeKind.Byte) {
          const n = p.default_value instanceof NumberLiteral ? p.default_value : null;
          if (n && (n.value < 0 || n.value > 255)) {
            throw this.err(
              fn.line,
              `default value for byte parameter '${p.name}' must be between 0 and 255`,
              fn.file
            );
          }
        }
      }
    }
    const savedRet = this.current_return_;
    const savedRetElem = this.current_return_elem_;
    const savedRetDesc = this.current_return_desc_;
    const savedRetTuple = this.current_return_tuple_;
    const savedInFn = this.in_function_;
    const savedLoopDepth = this.loop_depth_;
    const savedSwitchDepths = this.switch_entry_loop_depths_;
    this.loop_depth_ = 0;
    this.switch_entry_loop_depths_ = [];
    this.current_return_ = fn.has_return_type ? fn.return_type : TypeKind.Unknown;
    this.current_return_elem_ = fn.has_return_type ? fn.return_elem : mkType(TypeKind.Unknown);
    this.current_return_desc_ = fn.has_return_type ? fn.return_desc : mkType(TypeKind.Unknown);
    this.current_return_tuple_ = fn.has_return_type ? fn.return_tuple_members : [];
    this.in_function_ = true;
    const functionReturns = this.resolveStatementBlock(fn.body);
    if (fn.has_return_type && !functionReturns) {
      throw this.err(
        fn.line,
        `${subject} may exit without returning ${typeDescToString(fn.return_desc)}`,
        fn.file
      );
    }
    this.in_function_ = savedInFn;
    this.current_return_ = savedRet;
    this.current_return_elem_ = savedRetElem;
    this.current_return_desc_ = savedRetDesc;
    this.current_return_tuple_ = savedRetTuple;
    this.loop_depth_ = savedLoopDepth;
    this.switch_entry_loop_depths_ = savedSwitchDepths;
    this.current_fn_ = savedFn;
    this.current_file_ = savedFile;
    this.outer_scope_stack_ = savedOuter;
    this.outer_fns_ = savedOuterFns;
    this.resolved_functions_.add(fn.name);
    this.popScope();
    this.scopes_ = savedScopes;
  }

  private resolveStatementBlock(statements: Statement[]): boolean {
    let alwaysReturns = false;
    for (const stmt of statements) {
      const statementReturns = this.resolveStatement(stmt);
      if (statementReturns) alwaysReturns = true;
    }
    return alwaysReturns;
  }

  private collectFunctions(program: Program): void {
    for (const stmt of program.statements) {
      this.collectFunctionsStmt(stmt);
    }
  }

  private collectFunctionsStmt(stmt: Statement): void {
    const recurse = (list: Statement[]): void => {
      for (const s of list) this.collectFunctionsStmt(s);
    };
    if (stmt instanceof FunctionDecl) {
      const fn = stmt;
      if (fn.type_params.length > 0) {
        // M17: a template is registered aside and produces no signature/code.
        this.registerGenericTemplate(fn);
        return;
      }
      if (this.generic_fns_.has(fn.name)) {
        throw this.err(fn.line, `function '${fn.name}' is already declared`, fn.file);
      }
      if (this.functions_.has(fn.name)) {
        throw this.err(fn.line, `duplicate declaration of function '${fn.name}'`, fn.file);
      }
      if (this.type_decls_.has(fn.name) || this.generic_structs_.has(fn.name)) {
        throw this.err(
          fn.line,
          `cannot declare function '${fn.name}': a type with that name already exists`,
          fn.file
        );
      }
      const sig: FunctionSig = {
        param_types: [], param_elems: [], param_tuple_members: [], param_descs: [],
        param_has_default: [], variadic: false, variadic_elem: mkType(TypeKind.Unknown),
        return_type: TypeKind.Unknown, return_elem: mkType(TypeKind.Unknown),
        return_tuple_members: [], return_desc: mkType(TypeKind.Unknown), has_return: false,
        fn_type: mkType(TypeKind.Unknown),
      };
      const param_descs: TypeDesc[] = [];
      for (const p of fn.params) {
        sig.param_types.push(p.type);
        sig.param_elems.push(p.elem_desc);
        sig.param_tuple_members.push(p.tuple_members);
        sig.param_has_default.push(p.default_value != null);
        const pd = paramTypeDesc(p);
        sig.param_descs.push(pd);
        param_descs.push(pd);
      }
      if (fn.params.length === 0) {
        sig.variadic = false;
      } else {
        sig.variadic = fn.params[fn.params.length - 1].variadic;
        if (sig.variadic) {
          sig.variadic_elem = fn.params[fn.params.length - 1].elem_desc;
          if (
            sig.variadic_elem.type === TypeKind.Array ||
            sig.variadic_elem.type === TypeKind.Tuple ||
            fn.params[fn.params.length - 1].desc.type === TypeKind.Function
          ) {
            throw this.err(
              fn.line,
              `variadic parameter of function '${fn.name}' must collect a scalar type`,
              fn.file
            );
          }
          for (let i = 0; i + 1 < fn.params.length; i++) {
            if (fn.params[i].variadic) {
              throw this.err(
                fn.line,
                `function '${fn.name}' has more than one variadic parameter`,
                fn.file
              );
            }
          }
        }
        let seenDefault = false;
        let seenVariadic = false;
        for (let i = 0; i < fn.params.length; i++) {
          const p = fn.params[i];
          if (p.variadic) seenVariadic = true;
          if (seenVariadic && !p.variadic) {
            throw this.err(
              fn.line,
              `variadic parameter '${p.name}' of function '${fn.name}' must be the last parameter`,
              fn.file
            );
          }
          if (p.variadic && p.default_value) {
            throw this.err(
              fn.line,
              `variadic parameter '${p.name}' cannot have a default value`,
              fn.file
            );
          }
          if (p.default_value) seenDefault = true;
          if (seenDefault && !p.default_value && !p.variadic) {
            throw this.err(
              fn.line,
              `parameter '${p.name}' cannot follow a parameter with a default value`,
              fn.file
            );
          }
        }
      }
      sig.return_type = fn.has_return_type ? fn.return_type : TypeKind.Unknown;
      sig.return_elem = fn.has_return_type ? fn.return_elem : mkType(TypeKind.Unknown);
      sig.return_tuple_members = fn.has_return_type ? fn.return_tuple_members : [];
      sig.return_desc = fn.has_return_type ? fn.return_desc : mkType(TypeKind.Unknown);
      sig.has_return = fn.has_return_type;
      const ftd = mkType(TypeKind.Function);
      ftd.fn_info = { params: param_descs, ret: fn.has_return_type ? fn.return_desc : mkType(TypeKind.Unknown) };
      sig.fn_type = ftd;
      this.functions_.set(fn.name, sig);
      this.fn_decls_.set(fn.name, fn);
      recurse(fn.body);
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

  resolve(program: Program): void {
    // Reject runaway nesting before any recursive walk (mirrors the guard at
    // the top of TypeResolver::resolve in src/type_resolver.cpp). Without it a
    // deep program would blow the JS call stack with a RangeError instead of a
    // proper diagnostic.
    const nesting = astMaxDepth(program);
    if (nesting.depth > HMX_MAX_NESTING) {
      throw cmsg(
        nesting.line,
        `program nests too deeply (maximum depth is ${HMX_MAX_NESTING})`
      );
    }
    this.entry_file_ = program.source_file;
    this.current_file_ = program.source_file;
    this.collectTypeDecls(program);
    this.expandTypeRefs(program);
    this.collectFunctions(program);
    this.analyzeNonlocalExits(program);
    this.pushScope();
    const topState = new Set<Statement>();
    // Pass 1 (M14, audit #5): register all top-level state declarations — from
    // the entry file AND every imported module — before any function body runs,
    // so functions can reference module/entry `let`/`const` regardless of file
    // or declaration order. Each statement resolves with its own stamped file.
    for (const stmt of program.statements) {
      const savedFile = this.current_file_;
      if (stmt instanceof VarDecl) {
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        if (this.type_decls_.has(stmt.name) || this.generic_structs_.has(stmt.name)) {
          throw this.err(
            stmt.line,
            `cannot declare variable '${stmt.name}': a type with that name already exists`
          );
        }
        this.resolveVarDecl(stmt);
        topState.add(stmt);
      } else if (stmt instanceof DestructDecl) {
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        for (const pat of stmt.patterns) {
          if (this.type_decls_.has(pat.name) || this.generic_structs_.has(pat.name)) {
            throw this.err(
              stmt.line,
              `cannot declare variable '${pat.name}': a type with that name already exists`
            );
          }
        }
        this.resolveDestructDecl(stmt);
        topState.add(stmt);
      }
      this.current_file_ = savedFile;
    }
    // Pass 2: resolve everything else (functions, module/entry init statements,
    // main). Top-level state is already registered above.
    for (const stmt of program.statements) {
      if (topState.has(stmt)) continue;
      if (stmt instanceof TypeDecl) continue;
      this.resolveStatement(stmt);
    }
    this.popScope();
    for (const f of this.lambda_fns_) {
      program.statements.push(f);
    }
    this.lambda_fns_ = [];
    // Monomorphized generic instantiations are regular functions from here on:
    // they were resolved during pass 2 and just need to join the program so
    // codegen emits them. The same holds for generic struct specializations
    // (M17.3): their fields were expanded the moment they were instantiated,
    // so they only need to reach codegen's struct registry.
    for (const f of this.generic_instances_) {
      program.statements.push(f);
    }
    this.generic_instances_ = [];
    for (const t of this.generic_struct_instances_) {
      program.statements.push(t);
    }
    this.generic_struct_instances_ = [];
    // Generic templates are compile-time only — every use was monomorphized
    // above — so drop them before codegen. Their declarations are never
    // registered in functions_/fn_decls_/type_decls_ and produce no code.
    for (let i = program.statements.length - 1; i >= 0; i--) {
      const s = program.statements[i];
      if (s instanceof FunctionDecl && s.type_params.length > 0) {
        program.statements.splice(i, 1);
      }
      if (s instanceof TypeDecl && s.type_params.length > 0) {
        program.statements.splice(i, 1);
      }
    }
    this.generic_fns_.clear();
    this.generic_structs_.clear();
  }

  // ---- M16: type declarations (alias / struct / enum) ----

  private collectTypeDecls(program: Program): void {
    for (const stmt of program.statements) {
      if (stmt instanceof TypeDecl) {
        if (stmt.type_params.length > 0) {
          // M17.3: a generic struct template. It never enters type_decls_
          // (like generic functions never enter functions_); uses instantiate
          // concrete specializations that do.
          if (stmt.tdecl_kind !== TypeDeclKind.Struct) {
            throw this.err(
              stmt.line,
              `type parameters are only supported on struct declarations`,
              stmt.file
            );
          }
          if (this.type_decls_.has(stmt.name) || this.generic_structs_.has(stmt.name)) {
            throw this.err(
              stmt.line,
              `duplicate declaration of type '${stmt.name}'`,
              stmt.file
            );
          }
          // Type parameters are looked up by name within one declaration, so
          // a repeat would silently alias one parameter to another.
          const seenTp = new Set<string>();
          for (const tp of stmt.type_params) {
            if (seenTp.has(tp)) {
              throw this.err(
                stmt.line,
                `duplicate type parameter '${tp}' in struct '${stmt.name}'`,
                stmt.file
              );
            }
            seenTp.add(tp);
          }
          this.generic_structs_.set(stmt.name, stmt);
          continue;
        }
        if (this.type_decls_.has(stmt.name) || this.generic_structs_.has(stmt.name)) {
          throw this.err(
            stmt.line,
            `duplicate declaration of type '${stmt.name}'`,
            stmt.file
          );
        }
        // Variants are looked up by name within one enum, so a repeat would
        // silently shadow the earlier ordinal.
        if (stmt.tdecl_kind === TypeDeclKind.Enum) {
          const seen = new Set<string>();
          for (const v of stmt.variants) {
            if (seen.has(v)) {
              throw this.err(
                stmt.line,
                `duplicate variant '${v}' in enum '${stmt.name}'`,
                stmt.file
              );
            }
            seen.add(v);
          }
        }
        this.type_decls_.set(stmt.name, stmt);
      }
    }
  }

  private expandDesc(d: TypeDesc, byValue: boolean): TypeDesc {
    if (d.type === TypeKind.Unknown && d.type_name !== "") {
      // M17.3: type arguments are themselves type expressions — expand them
      // first so `alias L = Box[Other]` resolves `Other`, and an undefined
      // or generic name inside the brackets fails here with its own
      // diagnostic. by_value: an explicit type argument occupies the
      // instantiation (its own self-containment is checked normally).
      const args = d.type_args.map((a) => this.expandDesc(a, true));
      return this.resolveNamedType(d.type_name, args, byValue);
    }
    if (d.type === TypeKind.Array) {
      const out: TypeDesc = { type: d.type, elem: null, tuple_members: d.tuple_members, fn_info: d.fn_info, type_name: d.type_name, type_args: d.type_args };
      out.elem = this.expandDesc(elementOf(d), false);
      return out;
    }
    if (d.type === TypeKind.Tuple) {
      return { type: d.type, elem: d.elem, tuple_members: d.tuple_members.map((m) => this.expandDesc(m, true)), fn_info: d.fn_info, type_name: d.type_name, type_args: d.type_args };
    }
    if (d.type === TypeKind.Function && d.fn_info) {
      return {
        type: d.type,
        elem: null,
        tuple_members: [],
        fn_info: {
          params: d.fn_info.params.map((p) => this.expandDesc(p, false)),
          ret: this.expandDesc(d.fn_info.ret, false),
        },
        type_name: d.type_name,
        type_args: d.type_args,
      };
    }
    return d;
  }

  private resolveNamedType(name: string, args: TypeDesc[], byValue: boolean): TypeDesc {
    // M17.3: a generic struct resolves through instantiation — the clone
    // registers itself in type_decls_ under the specialization key, and every
    // later lookup (this call included) finds it there like an ordinary struct.
    let key = name;
    const git = this.generic_structs_.get(name);
    if (git) {
      if (args.length === 0) {
        throw this.err(this.line(), `generic type '${name}' requires type arguments`);
      }
      const probe = mkType(TypeKind.Struct);
      probe.type_name = name;
      probe.type_args = args;
      key = typeInstName(probe);
      if (!this.type_decls_.has(key)) {
        this.instantiateStruct(git, args, this.line());
      }
    } else if (args.length > 0) {
      throw this.err(this.line(), `type '${name}' does not take type arguments`);
    }
    const t = this.type_decls_.get(key);
    if (!t) {
      throw this.err(this.line(), `undefined type '${name}'`);
    }
    switch (t.tdecl_kind) {
      case TypeDeclKind.Alias: {
        if (this.expanding_aliases_.has(name)) {
          throw this.err(t.line, `alias cycle detected involving type '${name}'`, t.file);
        }
        this.expanding_aliases_.add(name);
        const out = this.expandDesc(t.alias_target, true);
        this.expanding_aliases_.delete(name);
        return out;
      }
      case TypeDeclKind.Struct: {
        if (byValue && this.building_structs_.has(key)) {
          // Diagnose with the source-level spelling of the reference
          // (`Node[int]`), not the internal specialization key.
          const disp = mkType(TypeKind.Struct);
          disp.type_name = name;
          disp.type_args = args;
          throw this.err(
            t.line,
            `struct type '${typeDescToString(disp)}' cannot contain itself by value`,
            t.file
          );
        }
        const cached = this.expanded_structs_.get(key);
        if (cached) return cached;
        const out = mkType(TypeKind.Struct);
        // The *base* name plus the type arguments identify the
        // specialization; the TypeDecl registered under `key` carries the
        // substituted fields for exactly this (base, args) pair.
        out.type_name = name;
        out.type_args = args;
        // Cache before expanding fields so (indirect, heap) self-references
        // resolve to the descriptor instead of recursing forever.
        this.expanded_structs_.set(key, out);
        this.building_structs_.add(key);
        for (const f of t.fields) {
          f.desc = this.expandDesc(f.desc, true);
        }
        this.building_structs_.delete(key);
        return out;
      }
      case TypeDeclKind.Enum: {
        const out = mkType(TypeKind.Enum);
        out.type_name = name;
        return out;
      }
    }
    return mkType(TypeKind.Unknown);
  }

  private instantiateStruct(tmpl: TypeDecl, args: TypeDesc[], lineNo: number): string {
    if (args.length !== tmpl.type_params.length) {
      throw this.err(
        lineNo,
        `type '${tmpl.name}' expects ${tmpl.type_params.length} type argument` +
          (tmpl.type_params.length === 1 ? "" : "s") +
          `, got ${args.length}`
      );
    }
    const keyDesc = mkType(TypeKind.Struct);
    keyDesc.type_name = tmpl.name;
    keyDesc.type_args = args;
    const key = typeInstName(keyDesc);
    if (this.type_decls_.has(key)) return key; // specialization already exists
    const bind = new Map<string, TypeDesc>();
    tmpl.type_params.forEach((tp, i) => bind.set(tp, args[i]));
    // The template body is never resolved on its own; the clone carries the
    // substituted (still unexpanded) field descriptors, which resolveNamedType's
    // struct case expands right after this function returns.
    const inst = deepCloneAst(tmpl);
    inst.name = key; // codegen registers structs by this key
    inst.type_params = []; // an instantiation is not a template
    for (const f of inst.fields) f.desc = this.substituteDesc(f.desc, bind);
    this.type_decls_.set(key, inst);
    this.generic_struct_instances_.push(inst);
    return key;
  }

  private expandTypeRefs(program: Program): void {
    // Force-expand every declared type (in declaration order) so unused types
    // are still validated and all descriptors are cached.
    for (const stmt of program.statements) {
      if (stmt instanceof TypeDecl) {
        // Generic struct templates are skipped: their fields mention type
        // parameters and are expanded per instantiation (M17.3), exactly like
        // a generic function's parameter types.
        if (stmt.type_params.length > 0) continue;
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        this.resolveNamedType(stmt.name, [], true);
      }
    }
    // Expand every annotation/parameter/return reference in the program.
    for (const stmt of program.statements) {
      this.expandTypeRefsStmt(stmt);
    }
  }

  private expandTypeRefsStmt(stmt: Statement): void {
    const savedFile = this.current_file_;
    if (stmt instanceof VarDecl) {
      if (stmt.has_annotation) {
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        let d: TypeDesc;
        if (stmt.annotation_desc.type !== TypeKind.Unknown || stmt.annotation_desc.type_name !== "") {
          d = stmt.annotation_desc;
        } else {
          d = mkType(stmt.annotation);
          if (d.type === TypeKind.Array) {
            if (stmt.elem_desc.type !== TypeKind.Unknown || stmt.elem_desc.type_name !== "") {
              d.elem = stmt.elem_desc;
            }
          } else if (d.type === TypeKind.Tuple) {
            d.tuple_members = stmt.tuple_members;
          }
        }
        const e = this.expandDesc(d, true);
        stmt.annotation = e.type;
        stmt.elem_desc = e.type === TypeKind.Array ? elementOf(e) : mkType(TypeKind.Unknown);
        stmt.tuple_members = e.type === TypeKind.Tuple ? e.tuple_members : [];
        stmt.annotation_desc =
          e.type === TypeKind.Function || e.type === TypeKind.Struct || e.type === TypeKind.Enum
            ? e
            : mkType(TypeKind.Unknown);
      }
      if (stmt.initializer) this.expandTypeRefsExpr(stmt.initializer);
    } else if (stmt instanceof FunctionDecl) {
      // M17: templates are not expanded; their instantiations are, after
      // substitution. (Native nests this check inside the arm.)
      if (stmt.type_params.length === 0) {
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        for (const p of stmt.params) this.syncParamDesc(p);
        this.syncReturnDesc(stmt);
        for (const s of stmt.body) this.expandTypeRefsStmt(s);
      }
    } else if (stmt instanceof IfStmt) {
      for (const s of stmt.then_body) this.expandTypeRefsStmt(s);
      for (const s of stmt.else_body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof SwitchStmt) {
      for (const c of stmt.cases) for (const s of c.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof LoopStmt) {
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof ForeachStmt) {
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof WhileStmt) {
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof ForStmt) {
      if (stmt.init) this.expandTypeRefsStmt(stmt.init);
      if (stmt.update) this.expandTypeRefsStmt(stmt.update);
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof DoWhileStmt) {
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof ExprStmt) {
      if (stmt.expr) this.expandTypeRefsExpr(stmt.expr);
    } else if (stmt instanceof DeferStmt) {
      for (const s of stmt.body) this.expandTypeRefsStmt(s);
    } else if (stmt instanceof DestructDecl) {
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof MultiAssignStmt) {
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof AssignStmt) {
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof ArrayAssignStmt) {
      if (stmt.index) this.expandTypeRefsExpr(stmt.index);
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof ElementAssignStmt) {
      if (stmt.target) this.expandTypeRefsExpr(stmt.target);
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof MemberAssignStmt) {
      if (stmt.base) this.expandTypeRefsExpr(stmt.base);
      if (stmt.rhs) this.expandTypeRefsExpr(stmt.rhs);
    } else if (stmt instanceof ReturnStmt) {
      for (const v of stmt.values) this.expandTypeRefsExpr(v);
    } else if (stmt instanceof PrintStmt) {
      for (const a of stmt.args) this.expandTypeRefsExpr(a);
    }
    // Native keeps a second, already-exhausted if-chain here that only reaches
    // condition expressions of statements handled above (see the duplicated
    // `dynamic_cast<IfStmt*>` tail in type_resolver.cpp:expand_type_refs_stmt).
    // It is dead code there too; it is kept as a separate call so the port
    // stays readable and does not trip no-dupe-else-if on the narrowed union.
    this.expandTypeRefsStmtConditionTail(stmt);
    this.current_file_ = savedFile;
  }

  private expandTypeRefsStmtConditionTail(stmt: Statement): void {
    if (stmt instanceof IfStmt) {
      if (stmt.condition) this.expandTypeRefsExpr(stmt.condition);
    } else if (stmt instanceof SwitchStmt) {
      if (stmt.value) this.expandTypeRefsExpr(stmt.value);
      for (const c of stmt.cases) if (c.value) this.expandTypeRefsExpr(c.value);
    } else if (stmt instanceof WhileStmt) {
      if (stmt.condition) this.expandTypeRefsExpr(stmt.condition);
    } else if (stmt instanceof DoWhileStmt) {
      if (stmt.condition) this.expandTypeRefsExpr(stmt.condition);
    } else if (stmt instanceof ForStmt) {
      if (stmt.condition) this.expandTypeRefsExpr(stmt.condition);
    } else if (stmt instanceof ForeachStmt) {
      if (stmt.iterable) this.expandTypeRefsExpr(stmt.iterable);
    } else if (stmt instanceof LoopStmt) {
      if (stmt.count) this.expandTypeRefsExpr(stmt.count);
    }
  }

  private expandTypeRefsExpr(expr: Expression): void {
    if (expr instanceof LambdaExpr) {
      this.current_line_ = expr.line;
      for (const p of expr.params) this.syncParamDesc(p);
      this.syncReturnDesc(expr);
      for (const s of expr.body) this.expandTypeRefsStmt(s);
      return;
    }
    if (expr instanceof ArrayLiteral) {
      for (const e of expr.elements) this.expandTypeRefsExpr(e);
    } else if (expr instanceof TupleLiteral) {
      for (const v of expr.values) this.expandTypeRefsExpr(v);
    } else if (expr instanceof CallExpr) {
      for (const a of expr.args) this.expandTypeRefsExpr(a);
    } else if (expr instanceof BinaryExpr) {
      this.expandTypeRefsExpr(expr.left);
      this.expandTypeRefsExpr(expr.right);
    } else if (expr instanceof NotExpr) {
      this.expandTypeRefsExpr(expr.operand);
    } else if (expr instanceof NegExpr) {
      this.expandTypeRefsExpr(expr.operand);
    } else if (expr instanceof ConditionalExpr) {
      this.expandTypeRefsExpr(expr.condition);
      this.expandTypeRefsExpr(expr.then_expr);
      this.expandTypeRefsExpr(expr.else_expr);
    } else if (expr instanceof CastExpr) {
      this.expandTypeRefsExpr(expr.operand);
    } else if (expr instanceof ArrayIndexExpr) {
      if (expr.base) this.expandTypeRefsExpr(expr.base);
      this.expandTypeRefsExpr(expr.index);
    } else if (expr instanceof MemberAccessExpr) {
      this.expandTypeRefsExpr(expr.base);
    }
  }

  private syncParamDesc(p: Param): void {
    if (p.variadic) {
      if (p.elem_desc.type !== TypeKind.Unknown || p.elem_desc.type_name !== "") {
        const e = this.expandDesc(p.elem_desc, true);
        p.elem_desc = e;
        p.desc = arrayOf(e);
      }
      return;
    }
    const e = this.expandDesc(p.desc, true);
    p.desc = e;
    p.type = e.type;
    p.elem_desc = e.type === TypeKind.Array ? elementOf(e) : mkType(TypeKind.Unknown);
    p.tuple_members = e.type === TypeKind.Tuple ? e.tuple_members : [];
  }

  private syncReturnDesc(fn: {
    has_return_type: boolean;
    return_type: TypeKind;
    return_desc: TypeDesc;
    return_elem: TypeDesc;
    return_tuple_members: TypeDesc[];
  }): void {
    if (!fn.has_return_type) return;
    const e = this.expandDesc(fn.return_desc, true);
    fn.return_desc = e;
    fn.return_type = e.type;
    fn.return_elem = e.type === TypeKind.Array ? elementOf(e) : mkType(TypeKind.Unknown);
    if (e.type === TypeKind.Tuple) fn.return_tuple_members = e.tuple_members;
  }

  // ---- M17 generics: monomorphization ----

  /** Encode a concrete descriptor as an identifier-safe token for mangling.
   * Delegates to the shared implementation in ast.ts so struct specializations
   * mangle by their specialization key (`n_Box__int`) — the same token the JS
   * codegen uses for the C type of `Box[int]`. */
  private mangleDesc(d: TypeDesc): string {
    return typeMangle(d);
  }

  private mangleGeneric(
    fname: string,
    typeParams: string[],
    bind: Map<string, TypeDesc>
  ): string {
    let s = `__gen_${fname}`;
    for (const tp of typeParams) {
      s += "_";
      const it = bind.get(tp);
      s += it ? this.mangleDesc(it) : "unbound";
    }
    return s;
  }

  private substituteDesc(d: TypeDesc, bind: Map<string, TypeDesc>): TypeDesc {
    if (d.type === TypeKind.Unknown && d.type_name.length > 0) {
      const it = bind.get(d.type_name);
      // Value-copy the binding so later in-place field edits cannot alias it.
      if (it) return deepCloneAst(it);
      // A generic struct reference (`Box[T]`) whose arguments mention a type
      // parameter: substitute through the argument list (M17.3).
      if (d.type_args.length > 0) {
        return { ...d, type_args: d.type_args.map((a) => this.substituteDesc(a, bind)) };
      }
      return d;
    }
    if (d.type === TypeKind.Array) {
      return arrayOf(this.substituteDesc(elementOf(d), bind));
    }
    if (d.type === TypeKind.Tuple) {
      const out: TypeDesc = { ...d, tuple_members: d.tuple_members.map((m) => this.substituteDesc(m, bind)) };
      return out;
    }
    if (d.type === TypeKind.Function && d.fn_info) {
      return {
        type: d.type,
        elem: d.elem,
        tuple_members: d.tuple_members,
        fn_info: {
          params: d.fn_info.params.map((p) => this.substituteDesc(p, bind)),
          ret: this.substituteDesc(d.fn_info.ret, bind),
        },
        type_name: d.type_name,
        type_args: d.type_args,
      };
    }
    return d;
  }

  private substituteStmt(stmt: Statement, bind: Map<string, TypeDesc>): void {
    if (stmt instanceof VarDecl) {
      stmt.annotation_desc = this.substituteDesc(stmt.annotation_desc, bind);
      stmt.elem_desc = this.substituteDesc(stmt.elem_desc, bind);
      stmt.tuple_members = stmt.tuple_members.map((m) => this.substituteDesc(m, bind));
      if (stmt.initializer) this.substituteExpr(stmt.initializer, bind);
    } else if (stmt instanceof FunctionDecl) {
      for (const p of stmt.params) {
        p.desc = this.substituteDesc(p.desc, bind);
        p.elem_desc = this.substituteDesc(p.elem_desc, bind);
        p.tuple_members = p.tuple_members.map((m) => this.substituteDesc(m, bind));
        if (p.default_value) this.substituteExpr(p.default_value, bind);
      }
      stmt.return_desc = this.substituteDesc(stmt.return_desc, bind);
      stmt.return_elem = this.substituteDesc(stmt.return_elem, bind);
      stmt.return_tuple_members = stmt.return_tuple_members.map((m) => this.substituteDesc(m, bind));
      for (const s of stmt.body) this.substituteStmt(s, bind);
    } else if (stmt instanceof IfStmt) {
      if (stmt.condition) this.substituteExpr(stmt.condition, bind);
      for (const s of stmt.then_body) this.substituteStmt(s, bind);
      for (const s of stmt.else_body) this.substituteStmt(s, bind);
    } else if (stmt instanceof SwitchStmt) {
      if (stmt.value) this.substituteExpr(stmt.value, bind);
      for (const c of stmt.cases) {
        if (c.value) this.substituteExpr(c.value, bind);
        for (const s of c.body) this.substituteStmt(s, bind);
      }
    } else if (stmt instanceof LoopStmt) {
      if (stmt.count) this.substituteExpr(stmt.count, bind);
      for (const s of stmt.body) this.substituteStmt(s, bind);
    } else if (stmt instanceof ForeachStmt) {
      if (stmt.iterable) this.substituteExpr(stmt.iterable, bind);
      for (const s of stmt.body) this.substituteStmt(s, bind);
    } else if (stmt instanceof WhileStmt) {
      if (stmt.condition) this.substituteExpr(stmt.condition, bind);
      for (const s of stmt.body) this.substituteStmt(s, bind);
    } else if (stmt instanceof ForStmt) {
      if (stmt.init) this.substituteStmt(stmt.init, bind);
      if (stmt.condition) this.substituteExpr(stmt.condition, bind);
      if (stmt.update) this.substituteStmt(stmt.update, bind);
      for (const s of stmt.body) this.substituteStmt(s, bind);
    } else if (stmt instanceof DoWhileStmt) {
      for (const s of stmt.body) this.substituteStmt(s, bind);
      if (stmt.condition) this.substituteExpr(stmt.condition, bind);
    } else if (stmt instanceof AssignStmt) {
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof MultiAssignStmt) {
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof DestructDecl) {
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof ArrayAssignStmt) {
      if (stmt.index) this.substituteExpr(stmt.index, bind);
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof ElementAssignStmt) {
      if (stmt.target) this.substituteExpr(stmt.target, bind);
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof MemberAssignStmt) {
      if (stmt.base) this.substituteExpr(stmt.base, bind);
      if (stmt.rhs) this.substituteExpr(stmt.rhs, bind);
    } else if (stmt instanceof ReturnStmt) {
      for (const v of stmt.values) this.substituteExpr(v, bind);
    } else if (stmt instanceof PrintStmt) {
      for (const a of stmt.args) this.substituteExpr(a, bind);
    } else if (stmt instanceof ExprStmt) {
      if (stmt.expr) this.substituteExpr(stmt.expr, bind);
    } else if (stmt instanceof DeferStmt) {
      for (const s of stmt.body) this.substituteStmt(s, bind);
    }
  }

  private substituteExpr(expr: Expression, bind: Map<string, TypeDesc>): void {
    if (expr instanceof LambdaExpr) {
      for (const p of expr.params) {
        p.desc = this.substituteDesc(p.desc, bind);
        p.elem_desc = this.substituteDesc(p.elem_desc, bind);
        p.tuple_members = p.tuple_members.map((m) => this.substituteDesc(m, bind));
        if (p.default_value) this.substituteExpr(p.default_value, bind);
      }
      expr.return_desc = this.substituteDesc(expr.return_desc, bind);
      expr.return_elem = this.substituteDesc(expr.return_elem, bind);
      expr.return_tuple_members = expr.return_tuple_members.map((m) => this.substituteDesc(m, bind));
      for (const s of expr.body) this.substituteStmt(s, bind);
    } else if (expr instanceof BinaryExpr) {
      this.substituteExpr(expr.left, bind);
      this.substituteExpr(expr.right, bind);
    } else if (expr instanceof NotExpr) {
      this.substituteExpr(expr.operand, bind);
    } else if (expr instanceof NegExpr) {
      this.substituteExpr(expr.operand, bind);
    } else if (expr instanceof ConditionalExpr) {
      this.substituteExpr(expr.condition, bind);
      this.substituteExpr(expr.then_expr, bind);
      this.substituteExpr(expr.else_expr, bind);
    } else if (expr instanceof CastExpr) {
      this.substituteExpr(expr.operand, bind);
    } else if (expr instanceof CallExpr) {
      for (const a of expr.args) this.substituteExpr(a, bind);
    } else if (expr instanceof ArrayLiteral) {
      for (const e of expr.elements) this.substituteExpr(e, bind);
    } else if (expr instanceof TupleLiteral) {
      for (const v of expr.values) this.substituteExpr(v, bind);
    } else if (expr instanceof ArrayIndexExpr) {
      if (expr.base) this.substituteExpr(expr.base, bind);
      this.substituteExpr(expr.index, bind);
    } else if (expr instanceof MemberAccessExpr) {
      this.substituteExpr(expr.base, bind);
    }
  }

  private bodyHasNestedFn(body: Statement[]): boolean {
    for (const st of body) {
      if (st instanceof FunctionDecl) return true;
      if (st instanceof IfStmt) {
        if (this.bodyHasNestedFn(st.then_body) || this.bodyHasNestedFn(st.else_body)) return true;
      } else if (st instanceof SwitchStmt) {
        for (const c of st.cases) if (this.bodyHasNestedFn(c.body)) return true;
      } else if (st instanceof LoopStmt) {
        if (this.bodyHasNestedFn(st.body)) return true;
      } else if (st instanceof ForeachStmt) {
        if (this.bodyHasNestedFn(st.body)) return true;
      } else if (st instanceof WhileStmt) {
        if (this.bodyHasNestedFn(st.body)) return true;
      } else if (st instanceof ForStmt) {
        if (this.bodyHasNestedFn(st.body)) return true;
      } else if (st instanceof DoWhileStmt) {
        if (this.bodyHasNestedFn(st.body)) return true;
      }
    }
    return false;
  }

  private registerGenericTemplate(fn: FunctionDecl): void {
    if (this.generic_fns_.has(fn.name) || this.functions_.has(fn.name)) {
      throw this.err(fn.line, `function '${fn.name}' is already declared`, fn.file);
    }
    if (this.type_decls_.has(fn.name) || this.generic_structs_.has(fn.name)) {
      throw this.err(
        fn.line,
        `cannot declare function '${fn.name}': a type with that name already exists`,
        fn.file
      );
    }
    const typeParams = new Set<string>();
    for (const tp of fn.type_params) {
      if (typeParams.has(tp)) {
        throw this.err(fn.line, `duplicate type parameter '${tp}' in function '${fn.name}'`, fn.file);
      }
      typeParams.add(tp);
    }
    for (const p of fn.params) {
      if (p.variadic) {
        throw this.err(fn.line, `generic function '${fn.name}' cannot have a variadic parameter`, fn.file);
      }
      if (p.default_value != null) {
        throw this.err(
          fn.line,
          `parameter '${p.name}' of generic function '${fn.name}' cannot have a default value`,
          fn.file
        );
      }
    }
    if (this.bodyHasNestedFn(fn.body)) {
      throw this.err(fn.line, `generic function '${fn.name}' cannot declare nested functions`, fn.file);
    }
    this.generic_fns_.set(fn.name, { decl: fn, type_params: typeParams });
  }

  private unifyTypeParams(
    param: TypeDesc,
    arg: TypeDesc,
    typeParams: Set<string>,
    bind: Map<string, TypeDesc>,
    ctx: string,
    line: number
  ): void {
    // `ctx` names the declaration being inferred against — "generic function
    // 'f'" or "generic type 'Box'" — so the shared unification messages read
    // correctly for both M17.1 function calls and M17.3 struct constructors.
    if (!descFullyKnown(arg)) {
      throw this.err(
        line,
        `cannot infer type parameter for ${ctx} from an argument whose type is not fully known`
      );
    }
    if (param.type === TypeKind.Unknown && param.type_name.length > 0 && typeParams.has(param.type_name)) {
      const it = bind.get(param.type_name);
      if (!it) {
        bind.set(param.type_name, arg);
      } else if (!typeDescEquals(it, arg)) {
        throw this.err(
          line,
          `type mismatch: type parameter '${param.type_name}' of ${ctx} inferred as both ${typeDescToString(it)} and ${typeDescToString(arg)}`
        );
      }
      return;
    }
    // A struct type parameter (M17.3): `fn wrap[T](x: T)` applied to `Box[int]`.
    // The declared name is a generic struct template; the argument must be an
    // instantiation of it, and the type arguments unify positionally so `T := int`.
    if (param.type === TypeKind.Unknown && this.generic_structs_.has(param.type_name)) {
      if (
        arg.type !== TypeKind.Struct ||
        arg.type_name !== param.type_name ||
        arg.type_args.length !== param.type_args.length
      ) {
        throw this.err(
          line,
          `type mismatch: argument for ${ctx} expects ${typeDescToString(param)}, got ${typeDescToString(arg)}`
        );
      }
      for (let i = 0; i < param.type_args.length; i++) {
        this.unifyTypeParams(param.type_args[i], arg.type_args[i], typeParams, bind, ctx, line);
      }
      return;
    }
    if (param.type === TypeKind.Array) {
      if (arg.type !== TypeKind.Array) {
        throw this.err(
          line,
          `type mismatch: argument for ${ctx} expects array of ${typeDescToString(elementOf(param))}, got ${typeDescToString(arg)}`
        );
      }
      this.unifyTypeParams(elementOf(param), elementOf(arg), typeParams, bind, ctx, line);
      return;
    }
    if (param.type === TypeKind.Tuple) {
      if (arg.type !== TypeKind.Tuple || arg.tuple_members.length !== param.tuple_members.length) {
        throw this.err(
          line,
          `type mismatch: argument for ${ctx} expects tuple ${tupleTypeToString(param.tuple_members)}, got ${typeDescToString(arg)}`
        );
      }
      for (let i = 0; i < param.tuple_members.length; i++) {
        this.unifyTypeParams(param.tuple_members[i], arg.tuple_members[i], typeParams, bind, ctx, line);
      }
      return;
    }
    if (param.type === TypeKind.Function && param.fn_info) {
      if (arg.type !== TypeKind.Function || !arg.fn_info || arg.fn_info.params.length !== param.fn_info.params.length) {
        throw this.err(
          line,
          `type mismatch: argument for ${ctx} expects ${typeDescToString(param)}, got ${typeDescToString(arg)}`
        );
      }
      for (let i = 0; i < param.fn_info.params.length; i++) {
        this.unifyTypeParams(param.fn_info.params[i], arg.fn_info!.params[i], typeParams, bind, ctx, line);
      }
      this.unifyTypeParams(param.fn_info.ret, arg.fn_info.ret, typeParams, bind, ctx, line);
      return;
    }
    const resolved = this.expandDesc(param, true);
    if (!typeDescEquals(resolved, arg)) {
      throw this.err(
        line,
        `type mismatch: argument for ${ctx} expects ${typeDescToString(resolved)}, got ${typeDescToString(arg)}`
      );
    }
  }

  private monomorphizeCall(call: CallExpr, tmpl: GenericTemplate): string {
    const decl = tmpl.decl;
    if (call.args.length !== decl.params.length) {
      throw this.err(
        this.line(),
        `generic function '${decl.name}' expects ${decl.params.length} argument${decl.params.length === 1 ? "" : "s"}, got ${call.args.length}`
      );
    }
    const bind = new Map<string, TypeDesc>();
    for (let i = 0; i < call.args.length; i++) {
      // Resolve the argument once to discover its type. The ordinary call path
      // below re-resolves it, which is idempotent (lambda synthesis is guarded).
      this.resolveExpr(call.args[i]);
      const ad = this.exprDesc(call.args[i]);
      this.unifyTypeParams(decl.params[i].desc, ad, tmpl.type_params, bind, `generic function '${decl.name}'`, this.line());
    }
    for (const tp of decl.type_params) {
      if (!bind.has(tp)) {
        throw this.err(this.line(), `cannot infer type parameter '${tp}' for generic function '${decl.name}'`);
      }
    }
    return this.instantiateGeneric(tmpl, bind);
  }

  private instantiateGeneric(tmpl: GenericTemplate, bind: Map<string, TypeDesc>): string {
    const name = this.mangleGeneric(tmpl.decl.name, tmpl.decl.type_params, bind);
    if (this.instantiated_.has(name)) return name;
    const inst = deepCloneAst(tmpl.decl);
    inst.name = name;
    inst.type_params = [];
    inst.is_lambda = false;
    this.substituteStmt(inst, bind);
    // No type variables remain, so the ordinary expansion can resolve named
    // types and sync the param/return descriptors on the clone.
    {
      const savedLine = this.current_line_;
      const savedFile = this.current_file_;
      this.current_line_ = inst.line;
      if (inst.file.length > 0) this.current_file_ = inst.file;
      this.expandTypeRefsStmt(inst);
      this.current_line_ = savedLine;
      this.current_file_ = savedFile;
    }
    this.generic_instances_.push(inst);
    // Register the signature before resolving the body so a recursive generic
    // call resolves against the instantiation already in flight.
    this.collectFunctionsStmt(inst);
    this.instantiated_.add(name);
    this.resolveFunctionDecl(inst);
    return name;
  }

  // ---- error construction ----

  private line(): number {
    return this.current_line_;
  }

  private err(line: number, msg: string, file?: string): CompileError {
    // Two-arg call sites use the current file; three-arg sites (a direct port
    // of the native `err(line, msg, file)` overload) pass it explicitly.
    return this.errFile(line, msg, file === undefined ? this.current_file_ : file);
  }

  private errFile(line: number, msg: string, file: string): CompileError {
    if (file.length === 0 || file === this.entry_file_) return cmsg(line, msg);
    return fmsg(line, msg, file);
  }
}