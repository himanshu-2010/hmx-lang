#pragma once

#include "ast.hpp"
#include "type_resolver.hpp"
#include <string>
#include <sstream>

class CodeGen {
public:
    std::string generate(Program& program, const std::string& source_file);

private:
    std::ostringstream out_;
    std::string source_file_;

    void emit_line_directive(int line, const std::string& file);
    void emit_stmt(Statement* stmt);
    void emit_for_component(Statement* stmt);
    void emit_expr(Expression* expr, bool parenthesize = false);
    std::string emit_function_signature(FunctionDecl* fn);
    TypeKind get_expr_type(Expression* expr);
};
