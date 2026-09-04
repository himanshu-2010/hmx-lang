#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <filesystem>
#include <sys/wait.h>

#include "ast.hpp"
#include "type_resolver.hpp"
#include "codegen.hpp"

extern FILE* yyin;
extern int yyparse();
extern Program* g_program;

void print_usage() {
    fprintf(stderr, "Usage: stardance <command> <file.sd> [options]\n");
    fprintf(stderr, "Commands:\n");
    fprintf(stderr, "  run   <file.sd>        Transpile, compile, execute\n");
    fprintf(stderr, "  build <file.sd>        Transpile and compile only\n");
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

    yyin = fopen(source_file.c_str(), "r");
    if (!yyin) {
        fprintf(stderr, "Error: cannot open file '%s'\n", source_file.c_str());
        return 1;
    }

    if (yyparse() != 0 || !g_program) {
        fprintf(stderr, "Error: parsing failed\n");
        fclose(yyin);
        return 1;
    }
    fclose(yyin);

    CodeGen codegen;
    std::string c_source;
    try {
        c_source = codegen.generate(*g_program, source_file);
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
