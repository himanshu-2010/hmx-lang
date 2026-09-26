// TypeResolver — a full port of src/type_resolver.cpp (1,983 lines).
// dynamic_cast becomes instanceof checks on the ast.ts class hierarchy.
// Error messages must match native verbatim (the parity contract).

import type {
  Expression,
  FunctionTypeInfo,
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
  elementOf,
  mkType,
  typeDescEquals,
  typeDescToString,
  typeDescListEquals,
  typeToString,
  tupleTypeToString,
} from "./ast";

// ---------------------------------------------------------------------------
// Module-level helpers (mirroring the file-static helpers in type_resolver.cpp)
// ---------------------------------------------------------------------------

function paramTypeDesc(p: { desc: TypeDesc; type: TypeKind; elem_desc: TypeDesc; tuple_members: TypeDesc[] }): TypeDesc {
  if (p.desc.type !== TypeKind.Unknown) return p.desc;
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
          vd.type === TypeKind.Function ? vd : mkType(TypeKind.Unknown)
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
    const have: TypeDesc = { type: sym.type, elem: sym.elem, tuple_members: sym.tuple_members, fn_info: null };
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
    } else if (expr instanceof Identifier) {
      let sym = this.findSymbol(expr.name);
      if (!sym) {
        sym = this.findOuterSymbol(expr.name);
        if (!sym) {
          const fit = this.functions_.get(expr.name);
          if (fit && fit !== undefined && fit !== null && expr.name !== "main") {
            this.requireFunctionValue(expr.name);
            expr.is_function_reference = true;
            expr.fn_type = fit.fn_type;
            result = TypeKind.Function;
          } else if (fit !== undefined && expr.name === "main") {
            throw this.err(this.line(), "cannot use function 'main' as a value");
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
          if (it !== TypeKind.Int) {
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
        if (it !== TypeKind.Int) {
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
    if (stmt instanceof FunctionDecl) {
      this.resolveFunctionDecl(stmt);
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
      }
    } else if (stmt instanceof ExprStmt) {
      const saved = this.allow_void_call_;
      this.allow_void_call_ = true;
      this.resolveExpr(stmt.expr);
      this.allow_void_call_ = saved;
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
        this.define(fe.value_name, ed.type, true, elementOf(ed), ed.tuple_members);
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
      if (switchType !== TypeKind.Int && switchType !== TypeKind.Byte && switchType !== TypeKind.Char) {
        throw this.err(stmt.line, `switch value must be int, byte, or char, got ${typeToString(switchType)}`);
      }
      let hasDefault = false;
      const seenValues: number[] = [];
      this.switch_entry_loop_depths_.push(this.loop_depth_);
      for (const c of stmt.cases) {
        if (c.is_default) {
          if (hasDefault) {
            throw this.err(stmt.line, "switch cannot have multiple default cases");
          }
          hasDefault = true;
        } else {
          const caseType = this.resolveExpr(c.value!);
          if (caseType !== switchType) {
            throw this.err(stmt.line, "switch case type must match switch value type");
          }
          let caseValue = 0;
          if (c.value instanceof NumberLiteral) {
            caseValue = c.value.value;
          } else if (c.value instanceof CharLiteral) {
            caseValue = c.value.value.charCodeAt(0);
          } else {
            throw this.err(stmt.line, "switch cases must be literal values");
          }
          if (seenValues.includes(caseValue)) {
            throw this.err(stmt.line, "duplicate switch case value");
          }
          seenValues.push(caseValue);
        }
        this.pushScope();
        this.resolveStatementBlock(c.body);
        this.popScope();
      }
      this.switch_entry_loop_depths_.pop();
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
      if (this.functions_.has(fn.name)) {
        throw this.err(fn.line, `duplicate declaration of function '${fn.name}'`, fn.file);
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
    this.entry_file_ = program.source_file;
    this.current_file_ = program.source_file;
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
        this.resolveVarDecl(stmt);
        topState.add(stmt);
      } else if (stmt instanceof DestructDecl) {
        this.current_line_ = stmt.line;
        if (stmt.file.length > 0) this.current_file_ = stmt.file;
        this.resolveDestructDecl(stmt);
        topState.add(stmt);
      }
      this.current_file_ = savedFile;
    }
    // Pass 2: resolve everything else (functions, module/entry init statements,
    // main). Top-level state is already registered above.
    for (const stmt of program.statements) {
      if (topState.has(stmt)) continue;
      this.resolveStatement(stmt);
    }
    this.popScope();
    for (const f of this.lambda_fns_) {
      program.statements.push(f);
    }
    this.lambda_fns_ = [];
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