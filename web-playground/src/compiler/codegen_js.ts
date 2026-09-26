// JS backend for HMX: walks the *resolved* AST (mirroring src/codegen.cpp)
// and emits a single self-contained JS program executed against the `SD`
// runtime. Every statement/expression mapping below is a direct port of the
// C codegen so runtime behaviour — including tuple struct-copy boundaries,
// non-local break/continue, and error messages — matches the native binary.
//
// The emitted module is `new Function("SD", src)`'d with a fresh runtime per
// run. Identifier mangling:
//   - variables  -> v_<name>
//   - functions  -> f_<name>   (main maps to the inline _sd_entry function)
//   - internals  -> _sd_*      (never collides with user identifiers)

import {
  FunctionDecl,
  VarDecl,
  AssignStmt,
  ArrayAssignStmt,
  ElementAssignStmt,
  DestructDecl,
  MultiAssignStmt,
  PrintStmt,
  LoopStmt,
  ForeachStmt,
  WhileStmt,
  ForStmt,
  DoWhileStmt,
  ReturnStmt,
  IfStmt,
  SwitchStmt,
  BreakStmt,
  ContinueStmt,
  ExprStmt,
  NumberLiteral,
  DecimalLiteral,
  StringLiteral,
  CharLiteral,
  BoolLiteral,
  Identifier,
  LambdaExpr,
  CallExpr,
  ArrayLiteral,
  TupleLiteral,
  ArrayIndexExpr,
  ConditionalExpr,
  CastExpr,
  BinaryExpr,
  NotExpr,
  NegExpr,
  ExprKind,
  TypeKind,
  type TypeDesc,
  type Program,
  type Statement,
  type Expression,
  type DestructPattern,
  elementOf,
  mkType,
  typeToString,
} from "./ast";

/** Decode the interior of an HMX string literal the way gcc decodes a C
 * string literal (the native lexer stores the raw interior verbatim). */
export function cUnescape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    if (i + 1 >= s.length) {
      out += "\\";
      break;
    }
    const e = s[++i];
    switch (e) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "\\": out += "\\"; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case "?": out += "?"; break;
      case "0": case "1": case "2": case "3":
      case "4": case "5": case "6": case "7": {
        let v = e.charCodeAt(0) - 48;
        let k = 1;
        while (k < 3 && i + 1 < s.length && s[i + 1] >= "0" && s[i + 1] <= "7") {
          v = v * 8 + (s[++i].charCodeAt(0) - 48);
          k++;
        }
        out += String.fromCharCode(v);
        break;
      }
      case "x": {
        let v = 0;
        let k = 0;
        const hex = (ch: string): boolean =>
          (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
        const hv = (ch: string): number =>
          ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 :
          ch >= "a" && ch <= "f" ? ch.charCodeAt(0) - 87 : ch.charCodeAt(0) - 55;
        while (k < 2 && i + 1 < s.length && hex(s[i + 1])) {
          v = v * 16 + hv(s[++i]);
          k++;
        }
        if (k === 0) out += "x";
        else out += String.fromCharCode(v & 0xff);
        break;
      }
      default:
        // Unknown escape: gcc drops the backslash.
        out += e;
    }
  }
  return out;
}

function jsString(v: string): string {
  return JSON.stringify(v);
}

interface PappSig {
  applied: number;
  full: TypeDesc[];
  ret: TypeDesc;
}

export class CodeGenJs {
  private out = "";
  private ind = 0;

  private allFns: FunctionDecl[] = [];
  private fnDeclsSeen = new Set<FunctionDecl>();
  private lambdaSeen = new Set<FunctionDecl>();
  private fnsByName = new Map<string, FunctionDecl>();
  private currentFn: FunctionDecl | null = null;
  private pappSigs = new Map<string, PappSig>();
  private tempCounter = 0;

  // ------------------------------------------------------------------ setup

  private ol(line: string): void {
    this.out += "  ".repeat(this.ind) + line + "\n";
  }

  private mVar(name: string): string {
    return `v_${name}`;
  }

  private fnJsName(fn: FunctionDecl): string {
    return fn.name === "main" ? "_sd_entry" : `f_${fn.name}`;
  }

  private isCapture(fn: FunctionDecl | null, name: string): boolean {
    if (!fn) return false;
    return fn.captures.some((c) => c.name === name);
  }

  private captureRead(name: string): string {
    if (this.currentFn && this.isCapture(this.currentFn, name)) {
      return `_sd_env.${this.mVar(name)}`;
    }
    return this.mVar(name);
  }

  private envValue(c: { name: string; desc: TypeDesc }): string {
    const read = this.captureRead(c.name);
    return c.desc.type === TypeKind.Tuple ? `SD.copy(${read})` : read;
  }

  private envArg(callee: FunctionDecl): string {
    if (callee.name === "main" || callee.captures.length === 0) return "null";
    return `{ ${callee.captures.map((c) => `${this.mVar(c.name)}: ${this.envValue(c)}`).join(", ")} }`;
  }

  private envHeapArg(callee: FunctionDecl): string {
    return this.envArg(callee);
  }

  // ------------------------------------------------------------ collection

  generate(program: Program): string {
    const topLevel: Statement[] = [];

    for (const stmt of program.statements) {
      if (stmt instanceof FunctionDecl) {
        this.allFns.push(stmt);
        this.fnDeclsSeen.add(stmt);
        for (const b of stmt.body) this.collectFunctionDecls(b);
      } else {
        topLevel.push(stmt);
      }
    }
    for (const s of topLevel) this.collectLambdasStmt(s);
    for (let fi = 0; fi < this.allFns.length; fi++) {
      this.collectLambdasStmt(this.allFns[fi]);
    }

    // Dedupe (lambdas collected via expressions also appear as hoisted fns).
    const unique: FunctionDecl[] = [];
    const seen = new Set<FunctionDecl>();
    for (const f of this.allFns) {
      if (seen.has(f)) continue;
      seen.add(f);
      unique.push(f);
    }
    this.allFns = unique;

    for (const fn of this.allFns) this.fnsByName.set(fn.name, fn);

    // ---- emit ------------------------------------------------------------
    this.emitPappHelpers();
    for (const fn of this.allFns) {
      if (fn.name !== "main") this.emitFunction(fn);
    }

    this.ol("function _sd_entry() {");
    this.ind++;
    for (const s of topLevel) this.emitStmt(s);
    const mainFn = this.fnsByName.get("main") ?? null;
    if (mainFn) {
      this.currentFn = mainFn;
      for (const s of mainFn.body) this.emitStmt(s);
      this.currentFn = null;
    }
    if (!mainFn || !mainFn.has_return_type) this.ol("return 0;");
    this.ind--;
    this.ol("}");

    this.ol("var _sd_rc = _sd_entry();");
    this.ol("return typeof _sd_rc === 'number' ? _sd_rc : 0;");
    return this.out;
  }

  private forEachChildStmt(stmt: Statement, cb: (s: Statement) => void): void {
    if (stmt instanceof FunctionDecl) {
      for (const s of stmt.body) cb(s);
    } else if (stmt instanceof IfStmt) {
      for (const s of stmt.then_body) cb(s);
      for (const s of stmt.else_body) cb(s);
    } else if (stmt instanceof SwitchStmt) {
      for (const c of stmt.cases) for (const s of c.body) cb(s);
    } else if (stmt instanceof LoopStmt) {
      for (const s of stmt.body) cb(s);
    } else if (stmt instanceof ForeachStmt) {
      for (const s of stmt.body) cb(s);
    } else if (stmt instanceof WhileStmt) {
      for (const s of stmt.body) cb(s);
    } else if (stmt instanceof ForStmt) {
      for (const s of stmt.body) cb(s);
    } else if (stmt instanceof DoWhileStmt) {
      for (const s of stmt.body) cb(s);
    }
  }

  private collectFunctionDecls(stmt: Statement): void {
    if (!(stmt instanceof FunctionDecl)) {
      this.forEachChildStmt(stmt, (s) => this.collectFunctionDecls(s));
      return;
    }
    if (this.fnDeclsSeen.has(stmt)) return;
    this.fnDeclsSeen.add(stmt);
    this.allFns.push(stmt);
    for (const b of stmt.body) this.collectFunctionDecls(b);
  }

  private collectLambdasStmt(stmt: Statement): void {
    if (stmt instanceof FunctionDecl) {
      for (const b of stmt.body) this.collectLambdasStmt(b);
    } else if (stmt instanceof VarDecl) {
      this.collectLambdasExpr(stmt.initializer);
    } else if (stmt instanceof AssignStmt) {
      if (stmt.rhs) this.collectLambdasExpr(stmt.rhs);
    } else if (stmt instanceof DestructDecl || stmt instanceof MultiAssignStmt) {
      this.collectLambdasExpr(stmt.rhs);
    } else if (stmt instanceof ArrayAssignStmt) {
      this.collectLambdasExpr(stmt.index);
      this.collectLambdasExpr(stmt.rhs);
    } else if (stmt instanceof ElementAssignStmt) {
      this.collectLambdasExpr(stmt.target);
      this.collectLambdasExpr(stmt.rhs);
    } else if (stmt instanceof PrintStmt) {
      for (const a of stmt.args) this.collectLambdasExpr(a);
    } else if (stmt instanceof ReturnStmt) {
      for (const v of stmt.values) this.collectLambdasExpr(v);
    } else if (stmt instanceof ExprStmt) {
      this.collectLambdasExpr(stmt.expr);
    } else if (stmt instanceof IfStmt) {
      this.collectLambdasExpr(stmt.condition);
      for (const s of stmt.then_body) this.collectLambdasStmt(s);
      for (const s of stmt.else_body) this.collectLambdasStmt(s);
    } else if (stmt instanceof SwitchStmt) {
      this.collectLambdasExpr(stmt.value);
      for (const c of stmt.cases) {
        if (c.value) this.collectLambdasExpr(c.value);
        for (const s of c.body) this.collectLambdasStmt(s);
      }
    } else if (stmt instanceof LoopStmt) {
      this.collectLambdasExpr(stmt.count);
      for (const s of stmt.body) this.collectLambdasStmt(s);
    } else if (stmt instanceof ForeachStmt) {
      this.collectLambdasExpr(stmt.iterable);
      for (const s of stmt.body) this.collectLambdasStmt(s);
    } else if (stmt instanceof WhileStmt) {
      this.collectLambdasExpr(stmt.condition);
      for (const s of stmt.body) this.collectLambdasStmt(s);
    } else if (stmt instanceof ForStmt) {
      this.collectLambdasStmt(stmt.init);
      this.collectLambdasExpr(stmt.condition);
      this.collectLambdasStmt(stmt.update);
      for (const s of stmt.body) this.collectLambdasStmt(s);
    } else if (stmt instanceof DoWhileStmt) {
      for (const s of stmt.body) this.collectLambdasStmt(s);
      this.collectLambdasExpr(stmt.condition);
    }
  }

  private collectLambdasExpr(expr: Expression): void {
    if (expr instanceof LambdaExpr) {
      if (!expr.resolved) {
        throw new Error("internal error: unresolved lambda expression");
      }
      if (!this.lambdaSeen.has(expr.resolved)) {
        this.lambdaSeen.add(expr.resolved);
        this.collectLambdasStmt(expr.resolved);
        this.allFns.push(expr.resolved);
      }
    } else if (expr instanceof CallExpr) {
      if (expr.is_partial) {
        this.registerPappSig(expr);
      }
      for (const a of expr.args) this.collectLambdasExpr(a);
    } else if (expr instanceof ArrayLiteral) {
      for (const e of expr.elements) this.collectLambdasExpr(e);
    } else if (expr instanceof TupleLiteral) {
      for (const v of expr.values) this.collectLambdasExpr(v);
    } else if (expr instanceof ArrayIndexExpr) {
      if (expr.base) this.collectLambdasExpr(expr.base);
      this.collectLambdasExpr(expr.index);
    } else if (expr instanceof BinaryExpr) {
      this.collectLambdasExpr(expr.left);
      this.collectLambdasExpr(expr.right);
    } else if (expr instanceof NotExpr || expr instanceof NegExpr) {
      this.collectLambdasExpr(expr.operand);
    } else if (expr instanceof ConditionalExpr) {
      this.collectLambdasExpr(expr.condition);
      this.collectLambdasExpr(expr.then_expr);
      this.collectLambdasExpr(expr.else_expr);
    } else if (expr instanceof CastExpr) {
      this.collectLambdasExpr(expr.operand);
    }
  }

  // ------------------------------------------------------------ papp helpers

  private pappMangleType(d: TypeDesc): string {
    if (d.type === TypeKind.Array) return `arr_of_${this.pappMangleType(elementOf(d))}`;
    if (d.type === TypeKind.Tuple) {
      let s = "tup";
      for (const m of d.tuple_members) s += `_${this.pappMangleType(m)}`;
      return s;
    }
    if (d.type === TypeKind.Function) {
      let s = "fn";
      if (d.fn_info) {
        for (const p of d.fn_info.params) s += `_${this.pappMangleType(p)}`;
        s += `_r_${this.pappMangleType(d.fn_info.ret)}`;
      }
      return s;
    }
    return typeToString(d.type);
  }

  private pappMangle(applied: number, full: TypeDesc[], ret: TypeDesc): string {
    let s = "sd_papp";
    for (const p of full) s += `_${this.pappMangleType(p)}`;
    s += `_to_${this.pappMangleType(ret)}_k${applied}`;
    return s;
  }

  private registerPappSig(call: CallExpr): void {
    const mangle = this.pappMangle(call.partial_applied, call.partial_full_params, call.partial_ret);
    if (!this.pappSigs.has(mangle)) {
      this.pappSigs.set(mangle, {
        applied: call.partial_applied,
        full: call.partial_full_params,
        ret: call.partial_ret,
      });
    }
    // Nested lambdas inside the applied args / call residue are collected by
    // walking call.args below in collectLambdasExpr.
  }

  private emitPappHelpers(): void {
    for (const [mangle, ps] of this.pappSigs) {
      const aps: string[] = [];
      for (let i = 0; i < ps.applied; i++) aps.push(`_sd_env.a${i}`);
      // `_sd_rest` collects the remaining call args; spread them back in.
      const callArgs = ["_sd_o.e", ...aps, "..._sd_rest"].join(", ");
      this.ol(`function ${mangle}(_sd_env, ..._sd_rest) {`);
      this.ind++;
      this.ol("var _sd_o = _sd_env.f;");
      if (ps.ret.type === TypeKind.Unknown) {
        this.ol(`_sd_o.f(${callArgs});`);
      } else {
        this.ol(`return _sd_o.f(${callArgs});`);
      }
      this.ind--;
      this.ol("}");
    }
    if (this.pappSigs.size > 0) this.ol("");
  }

  // ------------------------------------------------------------ expressions

  private copyIfTuple(expr: Expression | null): string {
    if (!expr) throw new Error("internal error: null expression");
    const s = this.emitExpr(expr);
    if (expr.resolved_type === TypeKind.Tuple) return `SD.copy(${s})`;
    return s;
  }

  private emitExpr(expr: Expression): string {
    if (expr instanceof NumberLiteral) return `${expr.value}`;
    if (expr instanceof DecimalLiteral) return `${expr.value}`;
    if (expr instanceof StringLiteral) return jsString(cUnescape(expr.value));
    if (expr instanceof CharLiteral) return jsString(expr.value);
    if (expr instanceof BoolLiteral) return expr.value ? "1" : "0";
    if (expr instanceof Identifier) {
      if (expr.is_function_reference) {
        const fn = this.fnsByName.get(expr.name);
        if (!fn) {
          throw new Error(`internal error: unknown function reference '${expr.name}'`);
        }
        return `{ f: ${this.fnJsName(fn)}, e: ${this.envHeapArg(fn)} }`;
      }
      return this.captureRead(expr.name);
    }
    if (expr instanceof LambdaExpr) {
      if (!expr.resolved) throw new Error("internal error: unresolved lambda expression");
      return `{ f: ${this.fnJsName(expr.resolved)}, e: ${this.envHeapArg(expr.resolved)} }`;
    }
    if (expr instanceof CallExpr) return this.emitCall(expr);
    if (expr instanceof NotExpr) return `(!(${this.emitExpr(expr.operand)}) ? 1 : 0)`;
    if (expr instanceof NegExpr) return `(-(${this.emitExpr(expr.operand)}))`;
    if (expr instanceof ArrayLiteral) {
      if (expr.elements.length === 0) return "[]";
      return `[${expr.elements.map((e) => this.copyIfTuple(e)).join(", ")}]`;
    }
    if (expr instanceof TupleLiteral) {
      return `[${expr.values
        .map((v, i) => {
          const s = this.emitExpr(v);
          return expr.resolved_members[i] && expr.resolved_members[i].type === TypeKind.Tuple
            ? `SD.copy(${s})`
            : s;
        })
        .join(", ")}]`;
    }
    if (expr instanceof ArrayIndexExpr) {
      if (expr.base) {
        if (expr.is_tuple) {
          if (expr.tuple_dynamic) {
            return `SD.tupleIdx(${this.emitExpr(expr.base)}, ${this.emitExpr(expr.index)}, ${expr.tuple_arity})`;
          }
          return `(${this.emitExpr(expr.base)})[${expr.member_index}]`;
        }
        if (expr.is_text) {
          return `SD.textIdx(${this.emitExpr(expr.base)}, ${this.emitExpr(expr.index)})`;
        }
        return `SD.arrIdx(${this.emitExpr(expr.base)}, ${this.emitExpr(expr.index)})`;
      }
      if (expr.is_tuple) {
        if (expr.tuple_dynamic) {
          return `SD.tupleIdx(${this.captureRead(expr.name)}, ${this.emitExpr(expr.index)}, ${expr.tuple_arity})`;
        }
        return `${this.captureRead(expr.name)}[${expr.member_index}]`;
      }
      if (expr.is_text) {
        return `SD.textIdx(${this.captureRead(expr.name)}, ${this.emitExpr(expr.index)})`;
      }
      return `SD.arrIdx(${this.captureRead(expr.name)}, ${this.emitExpr(expr.index)})`;
    }
    if (expr instanceof ConditionalExpr) {
      return `(${this.emitExpr(expr.condition)} ? ${this.emitExpr(expr.then_expr)} : ${this.emitExpr(expr.else_expr)})`;
    }
    if (expr instanceof CastExpr) {
      // `SD.num` converts char (JS string) operands to their code; toChar
      // wraps like the native `(char)` C cast (mod 256).
      const src = this.emitExpr(expr.operand);
      if (expr.target_type === TypeKind.Int) return `Math.trunc(SD.num(${src}))`;
      if (expr.target_type === TypeKind.Byte) return `SD.toByte(SD.num(${src}))`;
      if (expr.target_type === TypeKind.Char) return `SD.toChar(${src})`;
      return `SD.num(${src})`; // decimal
    }
    if (expr instanceof BinaryExpr) {
      const lt = expr.left.resolved_type;
      if (expr.ekind === ExprKind.Arithmetic && expr.op === "+" && lt === TypeKind.Text) {
        return `(${this.emitExpr(expr.left)} + ${this.emitExpr(expr.right)})`;
      }
      if (expr.ekind === ExprKind.Comparison && lt === TypeKind.Text) {
        const eq = expr.op === "==";
        return `((${this.emitExpr(expr.left)}) ${eq ? "===" : "!=="} (${this.emitExpr(expr.right)}) ? 1 : 0)`;
      }
      const L = this.emitExpr(expr.left);
      const R = this.emitExpr(expr.right);
      if (expr.ekind === ExprKind.Logical) {
        return `(((${L}) ${expr.op} (${R})) ? 1 : 0)`;
      }
      if (expr.ekind === ExprKind.Comparison) {
        return `((${L}) ${expr.op} (${R}) ? 1 : 0)`;
      }
      // Arithmetic
      if (expr.op === "/" && lt === TypeKind.Int && expr.right.resolved_type === TypeKind.Int) {
        return `SD.idiv(${L}, ${R})`;
      }
      return `((${L}) ${expr.op} (${R}))`;
    }
    throw new Error(`internal error: unhandled expression node ${expr.kind}`);
  }

  private emitCall(call: CallExpr): string {
    switch (call.name) {
      case "length":
        return `(${this.emitExpr(call.args[0])}).length`;
      case "substring":
        return `SD.substring(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])}, ${this.emitExpr(call.args[2])})`;
      case "ord":
        return `SD.ord(${this.emitExpr(call.args[0])})`;
      case "chr":
        return `SD.chr(${this.emitExpr(call.args[0])})`;
      case "split":
        return `SD.split(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])})`;
      case "push":
        return `SD.push(${this.emitExpr(call.args[0])}, ${this.copyIfTuple(call.args[1])})`;
      case "pop":
        return `SD.pop(${this.emitExpr(call.args[0])})`;
      case "sort": {
        const isText = call.array_aux.type === TypeKind.Text;
        return `SD.sort(${this.emitExpr(call.args[0])}, ${isText ? 1 : 0})`;
      }
      case "slice":
        return `SD.slice(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])}, ${this.emitExpr(call.args[2])})`;
      case "concat":
        return `SD.arrConcat(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])})`;
      case "index_of":
        return `SD.indexOf(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])})`;
      case "contains":
        return `SD.contains(${this.emitExpr(call.args[0])}, ${this.emitExpr(call.args[1])})`;
      case "input":
        return "SD.input()";
      case "tostr": {
        const at = call.args[0].resolved_type;
        const arg = this.emitExpr(call.args[0]);
        if (at === TypeKind.Text || at === TypeKind.Char) return arg;
        if (at === TypeKind.Decimal) return `SD.fD(${arg})`;
        return `SD.fI(${arg})`;
      }
      case "parse_int":
        return `SD.parseInt(${this.emitExpr(call.args[0])})`;
      case "parse_decimal":
        return `SD.parseDecimal(${this.emitExpr(call.args[0])})`;
    }

    if (call.is_partial) {
      const mangle = this.pappMangle(call.partial_applied, call.partial_full_params, call.partial_ret);
      if (!this.pappSigs.has(mangle)) {
        throw new Error("internal error: partial application signature not registered");
      }
      let orig: string;
      if (call.is_function_value_call) {
        orig = this.captureRead(call.name);
      } else {
        const fn = this.fnsByName.get(call.name);
        if (!fn) {
          throw new Error(`internal error: unknown function '${call.name}'`);
        }
        orig = `{ f: ${this.fnJsName(fn)}, e: ${this.envHeapArg(fn)} }`;
      }
      const applied = call.args.map((a) => this.copyIfTuple(a));
      const envFields = [`f: ${orig}`];
      for (let i = 0; i < applied.length; i++) envFields.push(`a${i}: ${applied[i]}`);
      return `{ f: ${mangle}, e: { ${envFields.join(", ")} } }`;
    }

    if (call.is_function_value_call) {
      const id = this.captureRead(call.name);
      const args = call.args.map((a) => this.emitExpr(a)).join(", ");
      return `${id}.f(${id}.e${args ? ", " + args : ""})`;
    }

    const callee = this.fnsByName.get(call.name);
    if (!callee) {
      // Mirrors the C fallback (calls an unknown C function = broken native);
      // the resolver guarantees this never happens for valid programs.
      throw new Error(`internal error: unknown function '${call.name}'`);
    }
    return this.emitDirectCall(callee, call);
  }

  private variadicIndexOf(fn: FunctionDecl): number {
    for (let i = 0; i < fn.params.length; i++) {
      if (fn.params[i].variadic) return i;
    }
    return -1;
  }

  private emitDirectCall(callee: FunctionDecl, call: CallExpr): string {
    const parts: string[] = [this.envArg(callee)];
    if (callee.has_nonlocal) {
      parts.push(`_sd_nl_marker_${callee.nl_target_loop_id}`);
    }
    const variadicIndex = this.variadicIndexOf(callee);
    const fixed = variadicIndex === -1 ? callee.params.length : variadicIndex;
    for (let i = 0; i < fixed; i++) {
      if (i < call.args.length) {
        parts.push(this.copyIfTuple(call.args[i]));
      } else {
        parts.push(this.copyIfTuple(callee.params[i].default_value));
      }
    }
    if (variadicIndex !== -1) {
      const elem = callee.params[variadicIndex].elem_desc;
      if (call.args.length > fixed) {
        const rest = call.args
          .slice(fixed)
          .map((a) =>
            elem.type === TypeKind.Tuple
              ? this.copyIfTuple(a)
              : this.emitExpr(a)
          )
          .join(", ");
        parts.push(`[${rest}]`);
      } else {
        parts.push("[]");
      }
    }
    return `${this.fnJsName(callee)}(${parts.join(", ")})`;
  }

  // -------------------------------------------------------------- statements

  private emitStmt(stmt: Statement): void {
    if (stmt instanceof VarDecl) {
      this.ol(
        `${stmt.is_mutable ? "let" : "const"} ${this.mVar(stmt.name)} = ${this.copyIfTuple(stmt.initializer)};`
      );
    } else if (stmt instanceof AssignStmt) {
      const isByte = stmt.resolved_type === TypeKind.Byte;
      if (stmt.op === "++" || stmt.op === "--") {
        if (isByte) {
          // uint8 wrap-around, matching the native unsigned char store.
          this.ol(`${this.mVar(stmt.name)} = (${this.mVar(stmt.name)} ${stmt.op === "++" ? "+" : "-"} 1) & 0xFF;`);
        } else {
          this.ol(`${this.mVar(stmt.name)}${stmt.op};`);
        }
      } else if (isByte && stmt.op !== "=") {
        this.ol(
          `${this.mVar(stmt.name)} = (${this.mVar(stmt.name)} ${stmt.op} ${this.emitExpr(stmt.rhs!)}) & 0xFF;`
        );
      } else {
        this.ol(`${this.mVar(stmt.name)} ${stmt.op} ${this.copyIfTuple(stmt.rhs)};`);
      }
    } else if (stmt instanceof ArrayAssignStmt) {
      this.ol(
        `SD.idxSet(${this.mVar(stmt.name)}, ${this.emitExpr(stmt.index)}, ${this.copyIfTuple(stmt.rhs)});`
      );
    } else if (stmt instanceof ElementAssignStmt) {
      this.emitElementAssign(stmt);
    } else if (stmt instanceof DestructDecl) {
      this.emitDestruct(stmt.patterns, stmt.rhs, stmt, true);
    } else if (stmt instanceof MultiAssignStmt) {
      this.emitDestruct(stmt.patterns, stmt.rhs, stmt, false);
    } else if (stmt instanceof PrintStmt) {
      const args = stmt.args
        .map((a) => {
          const t = a.resolved_type;
          const e = this.emitExpr(a);
          if (t === TypeKind.Int || t === TypeKind.Bool || t === TypeKind.Byte) return `SD.fI(${e})`;
          if (t === TypeKind.Decimal) return `SD.fD(${e})`;
          return e;
        })
        .join(", ");
      this.ol(`SD.print(${args});`);
    } else if (stmt instanceof ExprStmt) {
      this.ol(`${this.emitExpr(stmt.expr)};`);
    } else if (stmt instanceof ReturnStmt) {
      if (stmt.values.length > 1) {
        const vals = stmt.values
          .map((v, i) => {
            const s = this.emitExpr(v);
            return stmt.return_tuple_members[i] &&
              stmt.return_tuple_members[i].type === TypeKind.Tuple
              ? `SD.copy(${s})`
              : s;
          })
          .join(", ");
        this.ol(`return [${vals}];`);
      } else if (stmt.values.length === 1) {
        this.ol(`return ${this.copyIfTuple(stmt.values[0])};`);
      } else {
        this.ol("return;");
      }
    } else if (stmt instanceof IfStmt) {
      this.ol(`if (${this.emitExpr(stmt.condition)}) {`);
      this.ind++;
      for (const s of stmt.then_body) this.emitStmt(s);
      this.ind--;
      if (stmt.has_else) {
        this.ol("} else {");
        this.ind++;
        for (const s of stmt.else_body) this.emitStmt(s);
        this.ind--;
        this.ol("}");
      } else {
        this.ol("}");
      }
    } else if (stmt instanceof SwitchStmt) {
      const swt = stmt.value.resolved_type === TypeKind.Char
        ? `SD.ord(${this.emitExpr(stmt.value)})`
        : this.emitExpr(stmt.value);
      this.ol(`switch (${swt}) {`);
      for (const c of stmt.cases) {
        if (c.is_default) {
          this.ol("default:");
        } else {
          const label = c.value instanceof CharLiteral
            ? `SD.ord(${jsString(c.value.value)})`
            : this.emitExpr(c.value!);
          this.ol(`case ${label}:`);
        }
        this.ind++;
        for (const s of c.body) this.emitStmt(s);
        this.ol("break;");
        this.ind--;
      }
      this.ol("}");
    } else if (stmt instanceof LoopStmt) {
      this.emitLoopPrologue(stmt, `for (let _sd_i = 0; _sd_i < ${this.emitExpr(stmt.count)}; _sd_i++) {`, stmt.body);
    } else if (stmt instanceof ForeachStmt) {
      const idx = stmt.index_name.length > 0 ? this.mVar(stmt.index_name) : "_sd_fe";
      const itExpr = this.emitExpr(stmt.iterable);
      this.emitLoopPrologue(
        stmt,
        `for (let ${idx} = 0; ${idx} < (${itExpr}).length; ${idx}++) {`,
        stmt.body,
        () => {
          // Element binding (mirrors C: declared per iteration, before body).
          const elemIsTuple = stmt.elem.type === TypeKind.Tuple;
          const src = `(${itExpr})[${idx}]`;
          this.ol(`let ${this.mVar(stmt.value_name)} = ${elemIsTuple ? `SD.copy(${src})` : src};`);
        }
      );
    } else if (stmt instanceof WhileStmt) {
      this.emitLoopPrologue(stmt, `while (${this.emitExpr(stmt.condition)}) {`, stmt.body);
    } else if (stmt instanceof ForStmt) {
      const header = `for (${this.emitForComponent(stmt.init)}; ${this.emitExpr(stmt.condition)}; ${this.emitForComponent(stmt.update)}) {`;
      this.emitLoopPrologue(stmt, header, stmt.body);
    } else if (stmt instanceof DoWhileStmt) {
      this.emitLoopPrologue(stmt, `do {`, stmt.body, undefined, `while (${this.emitExpr(stmt.condition)});`);
    } else if (stmt instanceof BreakStmt) {
      this.ol(stmt.nonlocal ? "SD.nlBrk(_sd_nl);" : "break;");
    } else if (stmt instanceof ContinueStmt) {
      this.ol(stmt.nonlocal ? "SD.nlCont(_sd_nl);" : "continue;");
    } else if (stmt instanceof FunctionDecl) {
      // Hoisted to module scope; nothing emitted at the definition site.
    }
  }

  private emitElementAssign(ea: ElementAssignStmt): void {
    const t = ea.target;
    const rhs = this.copyIfTuple(ea.rhs);
    if (t.is_tuple) {
      if (t.tuple_dynamic) {
        const base = t.base ? this.emitExpr(t.base) : this.captureRead(t.name);
        this.ol(`SD.tupleSet(${base}, ${this.emitExpr(t.index)}, ${t.tuple_arity}, ${rhs});`);
        return;
      }
      const base = t.base ? `(${this.emitExpr(t.base)})` : this.captureRead(t.name);
      this.ol(`${base}[${t.member_index}] = ${rhs};`);
      return;
    }
    const base = t.base ? this.emitExpr(t.base) : this.captureRead(t.name);
    this.ol(`SD.idxSet(${base}, ${this.emitExpr(t.index)}, ${rhs});`);
  }

  private emitLoopPrologue(
    stmt: Statement,
    header: string,
    body: Statement[],
    beforeBody?: () => void,
    afterLoop?: string
  ): void {
    const nlId = (stmt as { nl_id: number }).nl_id;
    const nlTarget = (stmt as { nl_target: boolean }).nl_target;
    if (nlTarget) {
      this.ol(`const _sd_nl_marker_${nlId} = {};`);
    }
    this.ol(header);
    this.ind++;
    if (nlTarget) {
      this.ol("try {");
      this.ind++;
    }
    if (beforeBody) beforeBody();
    for (const s of body) this.emitStmt(s);
    if (nlTarget) {
      this.ind--;
      this.ol(`} catch (_sd_e) {`);
      this.ind++;
      this.ol(`if (_sd_e && _sd_e.m === _sd_nl_marker_${nlId} && _sd_e.k === 1) break;`);
      this.ol(`if (_sd_e && _sd_e.m === _sd_nl_marker_${nlId} && _sd_e.k === 2) continue;`);
      this.ol("throw _sd_e;");
      this.ind--;
      this.ol("}");
    }
    this.ind--;
    if (afterLoop) this.ol(`} ${afterLoop}`);
    else this.ol("}");
  }

  private emitForComponent(stmt: Statement): string {
    if (stmt instanceof VarDecl) {
      return `${stmt.is_mutable ? "let" : "const"} ${this.mVar(stmt.name)} = ${this.copyIfTuple(stmt.initializer)}`;
    }
    if (stmt instanceof AssignStmt) {
      const isByte = stmt.resolved_type === TypeKind.Byte;
      if (stmt.op === "++" || stmt.op === "--") {
        if (isByte) {
          return `${this.mVar(stmt.name)} = (${this.mVar(stmt.name)} ${stmt.op === "++" ? "+" : "-"} 1) & 0xFF`;
        }
        return `${this.mVar(stmt.name)}${stmt.op}`;
      }
      if (isByte && stmt.op !== "=") {
        return `${this.mVar(stmt.name)} = (${this.mVar(stmt.name)} ${stmt.op} ${this.emitExpr(stmt.rhs!)}) & 0xFF`;
      }
      return `${this.mVar(stmt.name)} ${stmt.op} ${this.copyIfTuple(stmt.rhs)}`;
    }
    return "";
  }

  private emitDestruct(
    patterns: DestructPattern[],
    rhs: Expression,
    stmt: DestructDecl | MultiAssignStmt,
    declare: boolean
  ): void {
    const tmp = `_sd_d${this.tempCounter++}`;
    const value = this.copyIfTuple(rhs);
    this.ol(`const ${tmp} = ${value};`);
    // The C emitter threads the full TypeDesc down so nested members resolve
    // against their own tuple_members/elem, not the top-level destruct's.
    const top = mkType(stmt.destruct_type);
    if (stmt.destruct_type === TypeKind.Tuple) top.tuple_members = stmt.tuple_members;
    else if (stmt.destruct_type === TypeKind.Array) top.elem = stmt.destruct_elem;
    this.emitDestructLevel(patterns, tmp, top, declare);
  }

  private emitDestructLevel(
    slots: DestructPattern[],
    src: string,
    val: TypeDesc,
    declare: boolean
  ): void {
    if (val.type === TypeKind.Tuple) {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const member = val.tuple_members[i];
        const memberSrc = `(${src})[${i}]`;
        if (slot.nested) {
          this.emitDestructLevel(slot.items, memberSrc, member, declare);
        } else {
          this.emitBinding(slot, memberSrc, member, declare);
        }
      }
      return;
    }
    if (val.type === TypeKind.Array) {
      const elem = val.elem ?? mkType(TypeKind.Unknown);
      let n = 0;
      for (const p of slots) if (!p.is_rest) n++;
      this.ol(
        `if ((${src}).length < ${n}) SD.fail("Error: cannot destructure array of length " + (${src}).length + " into ${n} targets");`
      );
      let fixI = 0;
      for (const slot of slots) {
        if (slot.is_rest) {
          this.ol(
            `${declare ? "let " : ""}${this.mVar(slot.name)} = SD.slice(${src}, ${n}, (${src}).length);`
          );
          continue;
        }
        const memberSrc = `(${src})[${fixI}]`;
        if (slot.nested) {
          this.emitDestructLevel(slot.items, memberSrc, elem, declare);
        } else {
          this.emitBinding(slot, memberSrc, elem, declare);
        }
        fixI++;
      }
      return;
    }
    // Text
    let n = 0;
    for (const p of slots) if (!p.is_rest) n++;
    this.ol(
      `if ((${src}).length < ${n}) SD.fail("Error: cannot destructure text of length " + (${src}).length + " into ${n} targets");`
    );
    let fixI = 0;
    const charDesc = mkType(TypeKind.Char);
    for (const slot of slots) {
      if (slot.is_rest) {
        this.ol(
          `${declare ? "let " : ""}${this.mVar(slot.name)} = SD.substring(${src}, ${n}, (${src}).length);`
        );
        continue;
      }
      const memberSrc = `(${src})[${fixI}]`;
      if (slot.nested) {
        this.emitDestructLevel(slot.items, memberSrc, charDesc, declare);
      } else {
        this.emitBinding(slot, memberSrc, charDesc, declare);
      }
      fixI++;
    }
  }

  private emitBinding(slot: DestructPattern, rhs: string, desc: TypeDesc, declare: boolean): void {
    const value = desc.type === TypeKind.Tuple ? `SD.copy(${rhs})` : rhs;
    if (declare) {
      this.ol(`let ${this.mVar(slot.name)} = ${value};`);
    } else {
      this.ol(`${this.mVar(slot.name)} = ${value};`);
    }
  }

  private emitFunction(fn: FunctionDecl): void {
    const params = fn.params.map((p) => this.mVar(p.name));
    this.ol(
      `function ${this.fnJsName(fn)}(_sd_env${fn.has_nonlocal ? ", _sd_nl" : ""}${
        params.length ? ", " + params.join(", ") : ""
      }) {`
    );
    this.ind++;
    this.currentFn = fn;
    for (const s of fn.body) this.emitStmt(s);
    this.currentFn = null;
    this.ind--;
    this.ol("}");
    this.ol("");
  }
}