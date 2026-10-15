// Front-end fuzz target: lexer -> parser -> type resolver.
//
// Built only with Clang's libFuzzer (see HMX_BUILD_FUZZER in CMakeLists.txt and
// tests/fuzz/run_fuzz.sh). It feeds raw bytes to the *real* flex/bison front end
// through the same `yyrestart`/`yyparse` path main.cpp uses, then runs the type
// resolver, but it stops before code generation and never shells out to a C
// compiler. That keeps it fast (thousands of inputs per second, in-process) and
// free of any gcc dependency.
//
// Leak detection is switched off by the runner, deliberately: the parser does
// not reclaim the partial AST when it reports a syntax error, and the real
// compiler simply exits at that point, so a parse-error leak is expected and
// immaterial. The target's job is memory *errors* and crashes -- use-after-free,
// out-of-bounds, null deref, assert -- which the AddressSanitizer half still
// catches. Leaks in the runtime are the valgrind suite's job.

// fmemopen (the in-memory FILE* used below) is POSIX.2008; make sure it is
// declared even if the toolchain does not predefine _GNU_SOURCE.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "ast.hpp"
#include "type_resolver.hpp"

// Supplied by the generated parser (parser.cpp) and lexer (lexer.cpp). The
// default `yy` prefix is used throughout the project.
extern Program* g_program;
extern int yylineno;
extern int yyparse();
extern void yyrestart(FILE*);

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    // Self-test hook: proves libFuzzer + the sanitizer surface a crash through
    // this harness. It is inert unless HMX_FUZZ_SELFTEST is set, so ordinary
    // fuzzing can never trip it (see the --selftest control in run_fuzz.sh).
    static const bool selftest = [] {
        const char* e = getenv("HMX_FUZZ_SELFTEST");
        return e && e[0] != '\0';
    }();
    if (selftest && size >= 4 && memcmp(data, "FUZZ", 4) == 0) {
        abort();
    }

    // A megabyte of source is already far past anything a human writes; skip the
    // rest so the fuzzer spends its budget on plausible inputs.
    if (size > (size_t)1 << 20) return 0;

    // Copy into a NUL-terminated buffer (the front end treats input as C text)
    // and present it as a FILE* so the parse path is byte-for-byte the real one.
    char* buf = static_cast<char*>(malloc(size + 1));
    if (!buf) return 0;
    memcpy(buf, data, size);
    buf[size] = '\0';

    FILE* f = fmemopen(buf, size, "r");
    if (!f) {
        free(buf);
        return 0;
    }

    g_program = nullptr;
    yylineno = 1;
    yyrestart(f);
    int rc = yyparse();
    fclose(f);

    Program* program = g_program;
    g_program = nullptr;
    if (rc == 0 && program) {
        try {
            TypeResolver resolver;
            resolver.resolve(*program);
        } catch (...) {
            // A program the resolver rejects is a normal outcome, not a finding.
        }
    }
    delete program;
    free(buf);
    return 0;
}
