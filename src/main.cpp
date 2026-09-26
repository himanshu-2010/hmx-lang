#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <filesystem>
#include <vector>
#include <set>
#include <algorithm>
#include <iterator>
#include <csignal>

#ifndef _WIN32
#include <unistd.h>
#endif

#ifndef HMX_VERSION
#define HMX_VERSION "0.9.0"
#endif

#if !defined(_WIN32) || defined(__MINGW32__)
#include <sys/wait.h>
#else
/* MSVC has no sys/wait.h; system() returns a wait-status-like int. */
#ifndef WEXITSTATUS
#define WEXITSTATUS(s) (((s) >> 8) & 0xFF)
#endif
#endif

// Human-readable name for a termination signal (avoids strsignal's dependency
// on POSIX feature-test macros that vary with the compiler's -std flag).
static const char* signal_name(int sig) {
    switch (sig) {
#ifdef SIGHUP
        case SIGHUP: return "SIGHUP";
#endif
#ifdef SIGINT
        case SIGINT: return "SIGINT";
#endif
#ifdef SIGQUIT
        case SIGQUIT: return "SIGQUIT";
#endif
#ifdef SIGILL
        case SIGILL: return "SIGILL";
#endif
#ifdef SIGABRT
        case SIGABRT: return "SIGABRT";
#endif
#ifdef SIGFPE
        case SIGFPE: return "SIGFPE";
#endif
#ifdef SIGKILL
        case SIGKILL: return "SIGKILL";
#endif
#ifdef SIGSEGV
        case SIGSEGV: return "SIGSEGV";
#endif
#ifdef SIGPIPE
        case SIGPIPE: return "SIGPIPE";
#endif
#ifdef SIGALRM
        case SIGALRM: return "SIGALRM";
#endif
#ifdef SIGTERM
        case SIGTERM: return "SIGTERM";
#endif
#ifdef SIGBUS
        case SIGBUS: return "SIGBUS";
#endif
#ifdef SIGXCPU
        case SIGXCPU: return "SIGXCPU";
#endif
#ifdef SIGXFSZ
        case SIGXFSZ: return "SIGXFSZ";
#endif
#ifdef SIGSYS
        case SIGSYS: return "SIGSYS";
#endif
    }
    return "unknown signal";
}

#include "ast.hpp"
#include "type_resolver.hpp"
#include "codegen.hpp"

extern FILE* yyin;
extern int yyparse();
extern Program* g_program;

static void print_usage(FILE* out) {
    fprintf(out, "HMX — a small statically typed systems language (v%s)\n", HMX_VERSION);
    fprintf(out, "\n");
    fprintf(out, "Usage:\n");
    fprintf(out, "  hmx <file.hmx> [options]     Transpile, compile and execute\n");
    fprintf(out, "  hmx run   <file.hmx> [opts]  Same as above (explicit)\n");
    fprintf(out, "  hmx build <file.hmx> [opts]  Transpile and compile to a binary only\n");
    fprintf(out, "  hmx new   <name>             Scaffold a new .hmx file\n");
    fprintf(out, "  hmx -h | --help              Show this help\n");
    fprintf(out, "  hmx -v | --version           Show the version\n");
    fprintf(out, "\n");
    fprintf(out, "Options:\n");
    fprintf(out, "  -keep-c                Keep the intermediate .c file\n");
    fprintf(out, "  -o <output>            Output binary path (with build)\n");
    fprintf(out, "\n");
    fprintf(out, "HMX transpiles to C and needs a C compiler (gcc, cc or clang).\n");
}

std::string get_basename(const std::string& path) {
    auto pos = path.find_last_of("/\\");
    std::string name = (pos == std::string::npos) ? path : path.substr(pos + 1);
    auto dot = name.find_last_of('.');
    if (dot != std::string::npos) name = name.substr(0, dot);
    return name;
}

// --- Module loader ---

extern int yylineno;
extern void yyrestart(FILE*);

static std::string dir_of(const std::string& path) {
    auto pos = path.find_last_of("/\\");
    if (pos == std::string::npos) return ".";
    return path.substr(0, pos);
}

// Recursively stamp `file` onto a function and every nested statement of it,
// plus top-level state declarations (VarDecl/DestructDecl) which carry their
// own `file` field so module diagnostics cite the right source.
static void assign_file(Statement* stmt, const std::string& file) {
    auto recurse = [&](const std::vector<StmtPtr>& list) {
        for (auto& s : list) assign_file(s.get(), file);
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        if (fn->file.empty()) fn->file = file;
        recurse(fn->body);
    } else if (auto* v = dynamic_cast<VarDecl*>(stmt)) {
        if (v->file.empty()) v->file = file;
    } else if (auto* d = dynamic_cast<DestructDecl*>(stmt)) {
        if (d->file.empty()) d->file = file;
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        recurse(ifs->then_body);
        recurse(ifs->else_body);
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        for (auto& c : sw->cases) recurse(c.body);
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        recurse(loop->body);
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        recurse(fe->body);
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        recurse(w->body);
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        recurse(f->body);
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        recurse(dw->body);
    }
}

// Parse a single .hmx file into its own Program (caller owns the pointer).
// Returns nullptr on open failure or parse error.
static Program* parse_file(const std::string& path) {
    FILE* f = fopen(path.c_str(), "r");
    if (!f) return nullptr;
    g_program = nullptr;
    yylineno = 1;
    yyrestart(f);
    int rc = yyparse();
    fclose(f);
    if (rc != 0) return nullptr;
    return g_program;
}

// Recursively load `use`d modules into `merged`. `base_dir` is the directory
// of the file that declared the modules (relative paths resolve to it).
// `visiting` holds canonical paths on the current load chain (cycle detection);
// `loaded` holds canonical paths already merged. Statements are collected in
// post-order — a module's own statements come after its transitive
// dependencies' — so top-level module state initializes (and resolves) before
// any dependent module reads it (M14, audit #5). All top-level statements are
// merged, not just functions: module `let`/`const` state is real program
// state, and the module's top-level statements act as its init section.
static bool load_module_uses(Program* program, const std::string& base_dir,
                             std::set<std::string>& loaded,
                             std::vector<std::string>& visiting,
                             std::vector<StmtPtr>& merged) {
    for (auto& u : program->use_files) {
        std::filesystem::path p(u);
        if (p.is_relative()) p = std::filesystem::path(base_dir) / p;
        std::string canon = std::filesystem::weakly_canonical(p).string();

        if (canon.size() < 4 || canon.compare(canon.size() - 4, 4, ".hmx") != 0) {
            fprintf(stderr, "Error: module '%s' must be a .hmx file\n", u.c_str());
            return false;
        }
        if (std::find(visiting.begin(), visiting.end(), canon) != visiting.end()) {
            fprintf(stderr, "Error: circular module dependency involving '%s'\n", canon.c_str());
            return false;
        }
        if (loaded.count(canon)) continue;

        if (!std::filesystem::exists(canon)) {
            fprintf(stderr, "Error: cannot open module '%s'\n", canon.c_str());
            return false;
        }

        Program* mod = parse_file(canon);
        if (!mod) {
            fprintf(stderr, "Error: parsing failed in module '%s'\n", canon.c_str());
            return false;
        }

        visiting.push_back(canon);
        bool sub_ok = load_module_uses(mod, dir_of(canon), loaded, visiting, merged);
        visiting.pop_back();
        if (!sub_ok) {
            delete mod;
            return false;
        }

        // Post-order: merge this module's own statements after its deps'.
        for (auto& stmt : mod->statements) {
            assign_file(stmt.get(), canon);
            merged.push_back(std::move(stmt));
        }
        delete mod;
        loaded.insert(canon);
    }
    return true;
}

// --- CLI helpers ---

// Is `name` on PATH? (fixed, trusted names — no shell quoting risk.)
static bool command_exists(const std::string& name) {
#ifdef _WIN32
    std::string cmd = "where " + name + " >nul 2>nul";
#else
    std::string cmd = "command -v " + name + " >/dev/null 2>&1";
#endif
    return std::system(cmd.c_str()) == 0;
}

// Prefer gcc, fall back to cc then clang (keeps macOS/no-gcc systems working).
static std::string find_c_compiler() {
    for (const char* candidate : {"gcc", "cc", "clang"}) {
        if (command_exists(candidate)) return candidate;
    }
    return "";
}

static int cmd_new(std::string name) {
    if (name.empty()) {
        fprintf(stderr, "Usage: hmx new <name>   (creates <name>.hmx)\n");
        return 1;
    }
    if (name.size() < 4 || name.compare(name.size() - 4, 4, ".hmx") != 0) {
        name += ".hmx";
    }
    if (std::filesystem::exists(name)) {
        fprintf(stderr, "Error: '%s' already exists\n", name.c_str());
        return 1;
    }
    std::ofstream out(name);
    if (!out) {
        fprintf(stderr, "Error: cannot create '%s'\n", name.c_str());
        return 1;
    }
    out << "// " << name << " — your HMX program\n"
        << "// Run it with: hmx " << name << "\n"
        << "\n"
        << "fn main() {\n"
        << "    print(\"hello, hmx\")\n"
        << "}\n";
    out.close();
    printf("Created %s — run with: hmx %s\n", name.c_str(), name.c_str());
    return 0;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        print_usage(stderr);
        return 1;
    }

    std::string a1 = argv[1];
    if (a1 == "-h" || a1 == "--help" || a1 == "help") {
        print_usage(stdout);
        return 0;
    }
    if (a1 == "-v" || a1 == "--version" || a1 == "version") {
        printf("hmx %s\n", HMX_VERSION);
        return 0;
    }
    if (a1 == "new") {
        return cmd_new(argc >= 3 ? argv[2] : "");
    }

    // Bare `hmx <file.hmx>` runs by default; `run`/`build` stay explicit.
    std::string command = "run";
    std::string source_file;
    bool keep_c = false;
    std::string out_override;

    int i = 1;
    if (a1 == "run" || a1 == "build") {
        command = a1;
        i = 2;
    }
    if (i >= argc) {
        print_usage(stderr);
        return 1;
    }
    source_file = argv[i++];

    for (; i < argc; i++) {
        std::string a = argv[i];
        if (a == "-keep-c") {
            keep_c = true;
        } else if (a == "-o" || a == "--output") {
            if (i + 1 >= argc) {
                fprintf(stderr, "Error: %s requires a path\n", a.c_str());
                return 1;
            }
            out_override = argv[++i];
        } else if (a == "-h" || a == "--help") {
            print_usage(stdout);
            return 0;
        } else {
            fprintf(stderr, "Error: unknown option '%s'\n", a.c_str());
            print_usage(stderr);
            return 1;
        }
    }

    if (source_file.size() < 4 || source_file.compare(source_file.size() - 4, 4, ".hmx") != 0) {
        fprintf(stderr, "Error: expected .hmx file\n");
        return 1;
    }

    if (!std::filesystem::exists(source_file)) {
        fprintf(stderr, "Error: cannot open file '%s'\n", source_file.c_str());
        return 1;
    }

    Program* program = parse_file(source_file);
    if (!program) {
        fprintf(stderr, "Error: parsing failed\n");
        return 1;
    }
    program->source_file = source_file;

    for (auto& stmt : program->statements) {
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
            assign_file(fn, source_file);
        }
    }

    // Expand modules (used files are merged into the entry program). Module
    // statements are collected dependencies-first, then inserted BEFORE the
    // entry file's own statements, so module init sections run first (before
    // `main`) and their top-level state resolves before entry code reads it.
    std::set<std::string> loaded;
    std::vector<std::string> visiting;
    visiting.push_back(std::filesystem::weakly_canonical(source_file).string());
    std::vector<StmtPtr> module_stmts;
    if (!load_module_uses(program, dir_of(source_file), loaded, visiting,
                          module_stmts)) {
        return 1;
    }
    program->statements.insert(program->statements.begin(),
                               std::make_move_iterator(module_stmts.begin()),
                               std::make_move_iterator(module_stmts.end()));
    g_program = program;

    CodeGen codegen;
    std::string c_source;
    try {
        c_source = codegen.generate(*program, source_file);
    } catch (const CompileError& e) {
        fprintf(stderr, "%s\n", e.what());
        return 1;
    }

    std::string base = get_basename(source_file);
    std::string c_path = "build_temp.c";
    std::string exe_path = out_override.empty() ? base : out_override;

#ifdef _WIN32
    if (exe_path.size() < 4 || exe_path.compare(exe_path.size() - 4, 4, ".exe") != 0) {
        exe_path += ".exe";
    }
#endif

    std::string cc = find_c_compiler();
    if (cc.empty()) {
        fprintf(stderr,
                "Error: no C compiler found (looked for gcc, cc, clang).\n"
                "       Install gcc (or clang) to compile HMX programs.\n");
        if (!keep_c) remove(c_path.c_str());
        return 1;
    }

    std::ofstream c_file(c_path);
    c_file << c_source;
    c_file.close();

    // HMX_ASAN=1 builds the generated C with AddressSanitizer (which also
    // enables LeakSanitizer on Linux/macOS). The CI workflow uses this to
    // gate refcount errors and leaks in the reference-counted runtime.
    std::string cc_cmd = cc + " -O2 -o " + exe_path + " " + c_path + " 2>&1";
    const char* asan_env = getenv("HMX_ASAN");
    if (asan_env && asan_env[0] != '\0' && std::strcmp(asan_env, "0") != 0) {
        cc_cmd = cc + " -O1 -g -fsanitize=address -fno-omit-frame-pointer -o " +
                 exe_path + " " + c_path + " 2>&1";
    }
    int cc_result = system(cc_cmd.c_str());

    if (cc_result != 0) {
        fprintf(stderr, "Error: %s compilation failed\n", cc.c_str());
        if (!keep_c) remove(c_path.c_str());
        return 1;
    }

    if (command == "run") {
        int exit_code;
#ifndef _WIN32
        // Run the compiled binary directly (fork/exec) so that genuine signal
        // deaths surface as WIFSIGNALED — a POSIX shell would otherwise bury
        // them in its own 128+sig exit code and mask the crash.
        std::string run_cmd = "./" + exe_path;
        pid_t pid = fork();
        if (pid == 0) {
            execlp(run_cmd.c_str(), run_cmd.c_str(), (char*)nullptr);
            fprintf(stderr, "Error: failed to execute %s\n", run_cmd.c_str());
            _exit(127);
        }
        int status = 0;
        while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
        if (WIFEXITED(status)) {
            exit_code = WEXITSTATUS(status);
        } else if (WIFSIGNALED(status)) {
            int sig = WTERMSIG(status);
            fprintf(stderr, "Error: program crashed with signal %d (%s)\n",
                    sig, signal_name(sig));
            exit_code = 128 + sig;
        } else {
            fprintf(stderr, "Error: program terminated abnormally\n");
            exit_code = 1;
        }
#else
        std::string run_cmd = exe_path;
        int run_result = system(run_cmd.c_str());
        exit_code = WEXITSTATUS(run_result);
#endif
        if (!keep_c) {
            remove(c_path.c_str());
        }
        remove(exe_path.c_str());
        return exit_code;
    } else {
        if (!keep_c) remove(c_path.c_str());
        fprintf(stderr, "Built: %s\n", exe_path.c_str());
        return 0;
    }
}