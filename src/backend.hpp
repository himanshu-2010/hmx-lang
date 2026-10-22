#pragma once
#include <string>

class Program;

// P3 (ADR 0004): x86-64 System V backend v1 — assembly text + system linker.
//
// The backend consumes the resolved AST/IR exactly like the C emitter does,
// but emits AT&T-syntax x86-64 assembly instead of C. Tier A (this phase)
// shells out to the host toolchain for assembling and linking:
//   cc -O2 [-I runtime] prog.s runtime/hxrt.c -o prog
// The refcounted runtime (runtime/hxrt) is plain C ABI, so the assembly calls
// sd_make_str / sd_concat / sd_release_str / printf directly.
//
// v1 feature subset (everything else is a clean CompileError pointing at the
// statement that would need it — never a silent miscompile):
//   values   : int, bool, char, decimal, text
//   exprs    : literals, variables, + - * / % (ints), + (text concat),
//              == != < <= > >= (ints, text equality), && || ! -
//              conditional, char casts, user-defined function calls
//   stmts    : let/const, assignment (incl. compound/++/--), print, if/else,
//              while, do-while, for, loop N, break, continue, return,
//              function declarations
// decimal comparisons, arrays, tuples, structs, forear each, switch, closures,
// lambdas, defer and try/catch still route through the C backend.
std::string emit_asm(Program& program, const std::string& source_file);
