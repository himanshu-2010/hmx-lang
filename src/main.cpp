#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <filesystem>
#include <vector>
#include <set>
#include <algorithm>
#include <sys/wait.h>

#include "ast.hpp"
#include "type_resolver.hpp"
#include "codegen.hpp"

extern FILE* yyin;
extern int yyparse();
extern Program* g_program;

void print_usage() {
    fprintf(stderr, "Usage: hmx <command> <file.hmx> [options]\n");
    fprintf(stderr, "Commands:\n");
    fprintf(stderr, "  run   <file.hmx>        Transpile, compile, execute\n");
    fprintf(stderr, "  build <file.hmx>        Transpile and compile only\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -keep-c                Keep intermediate .c file\n");
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

// Recursively stamp `file` onto a function and every nested statement of it.
static void assign_file(Statement* stmt, const std::string& file) {
    auto recurse = [&](const std::vector<StmtPtr>& list) {
        for (auto& s : list) assign_file(s.get(), file);
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        if (fn->file.empty()) fn->file = file;
        recurse(fn->body);
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

// Recursively load `use`d modules into `program`. `base_dir` is the directory
// of the file that declared the modules (relative paths resolve to it).
// `visiting` holds canonical paths on the current load chain (cycle detection);
// `loaded` holds canonical paths already merged.
static bool load_module_uses(Program* program, const std::string& base_dir,
                             std::set<std::string>& loaded,
                             std::vector<std::string>& visiting) {
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
        bool sub_ok = load_module_uses(mod, dir_of(canon), loaded, visiting);
        visiting.pop_back();
        if (!sub_ok) {
            delete mod;
            return false;
        }

        for (auto& stmt : mod->statements) {
            if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
                assign_file(fn, canon);
                program->statements.push_back(std::move(stmt));
            }
        }
        delete mod;
        loaded.insert(canon);
    }
    return true;
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        print_usage();
        return 1;
    }

    std::string command = argv[1];
    std::string source_file = argv[2];
    bool keep_c = false;

    for (int i = 3; i < argc; i++) {
        if (std::string(argv[i]) == "-keep-c") {
            keep_c = true;
        }
    }

    if (command != "run" && command != "build") {
        fprintf(stderr, "Error: unknown command '%s'\n", command.c_str());
        print_usage();
        return 1;
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

    // Expand modules (used files are merged into the entry program).
    std::set<std::string> loaded;
    std::vector<std::string> visiting;
    visiting.push_back(std::filesystem::weakly_canonical(source_file).string());
    if (!load_module_uses(program, dir_of(source_file), loaded, visiting)) {
        return 1;
    }
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
    std::string exe_path = base;

    std::ofstream c_file(c_path);
    c_file << c_source;
    c_file.close();

    std::string gcc_cmd = "gcc -O2 -o " + exe_path + " " + c_path + " 2>&1";
    int gcc_result = system(gcc_cmd.c_str());

    if (gcc_result != 0) {
        fprintf(stderr, "Error: gcc compilation failed\n");
        if (!keep_c) remove(c_path.c_str());
        return 1;
    }

    if (command == "run") {
        std::string run_cmd = "./" + exe_path;
        int run_result = system(run_cmd.c_str());
        int exit_code = WEXITSTATUS(run_result);
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
