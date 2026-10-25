#pragma once
#include <cstdint>
#include <cstddef>
#include <vector>
#include <string>

class Program;

// P5a (ADR 0004): ELF backend v0 — the Tier B machine-code path.
//
// Same resolved AST/IR as the C emitter and the P3 asm backend, but this
// backend emits x86-64 ENCODED BYTES directly through backend::Encoder and
// finishes with backend::ElfWriter: a static ET_EXEC executable with an
// embedded freestanding runtime (runtime/elfrt/enc_rt.c, compiled at compiler
// build time and copied verbatim into every produced binary). No C compiler,
// assembler or linker touches user programs on this path.
//
// v0 subset (everything else is a clean CompileError pointing at the
// offending source line — never a silent miscompile):
//   values : int, bool, char
//   exprs  : literals, variables, + - * / % (ints), == != < <= > >=,
//            && || ! - (unary), conditional, int<->char casts, ord(),
//            user-defined function calls
//   stmts  : let/const, assignment (incl. compound/++/--), print (word args),
//            if/else, while, do-while, for, loop N, break, continue, return,
//            function declarations
// decimal, text, arrays, tuples, structs, foreach, switch, closures, lambdas,
// defer and try/catch still route through the other backends; the runtime
// blob gains an allocator + bignum-exact formatters before those land here.
//
// Print semantics: printf replaced by per-argument helper calls with the same
// byte stream (digits/char byte, " " separators, "\n" terminator). Arguments
// are emitted left-to-right; the C path's arg order is unspecified anyway
// (gcc varargs reversing), so this matches every output-only program.
namespace backend {
// Returns the bytes of a self-contained static ELF executable.
std::vector<uint8_t> emit_elf(Program& program, const std::string& source_file);
}  // namespace backend
