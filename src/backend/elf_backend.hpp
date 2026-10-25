#pragma once
#include <cstdint>
#include <cstddef>
#include <vector>
#include <string>

class Program;

// P5a/P5b (ADR 0004): ELF backend v1 — the Tier B machine-code path.
//
// Same resolved AST/IR as the C emitter and the P3 asm backend, but this
// backend emits x86-64 ENCODED BYTES directly through backend::Encoder and
// finishes with backend::ElfWriter: a static ET_EXEC executable with an
// embedded freestanding runtime (runtime/elfrt/enc_rt.c, compiled at compiler
// build time and copied verbatim into every produced binary). No C compiler,
// assembler or linker touches user programs on this path.
//
// v1 subset (everything else is a clean CompileError pointing at the
// offending source line — never a silent miscompile):
//   values : int, bool, char, decimal, text
//   exprs  : literals (incl. string literals via the literal pool),
//            variables, + - * / % (ints), == != < <= > >= (ints), decimal
//            + - * / and decimal comparisons (NaN-correct via UCOMISD),
//            text + / == != < <= > >=, && || ! - (unary), conditional,
//            int<->char casts, ord(), chr(), length(), substring(), s[i]
//   stmts  : let/const, assignment (incl. compound/++/-- on words), print
//            (word/decimal/text args), if/else, while, do-while, for,
//            loop N, break, continue, return, function declarations
//            (word/decimal/text params and returns)
// Print semantics: printf replaced by per-argument helper calls with the
// same byte stream (digits/char byte/decimal digits/text bytes, " "
// separators, "\n" terminator). Arguments are evaluated left-to-right and
// spilled on the machine stack; the write phase walks them in argument
// order via rsp-relative loads, so interleaved nested prints inside the
// arguments observe the same evaluation order as the language spec.
//
// Text follows the hxrt refcount ABI (refs/owner/len/data): literals come
// from the pool, views (substring, s[i]) pin their base through the owner
// field, and every frame releases its owned text slots at exit.
// decimal + text route through small helpers in the freestanding runtime
// (one mmap per allocation, bignum-exact "%f" formatter) — see enc_rt.c.
namespace backend {
// Returns the bytes of a self-contained static ELF executable.
std::vector<uint8_t> emit_elf(Program& program, const std::string& source_file);
}  // namespace backend
