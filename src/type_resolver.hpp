#pragma once

#include "ast.hpp"
#include <string>
#include <unordered_map>
#include <vector>
#include <stdexcept>

struct CompileError : std::runtime_error {
    int line;
    CompileError(int line, const std::string& msg)
        : std::runtime_error("Error [line " + std::to_string(line) + "]: " + msg),
          line(line) {}
};

struct FunctionSig {
    std::vector<TypeKind> param_types;
    TypeKind return_type = TypeKind::Unknown;
    bool has_return = false;
};

class TypeResolver {
public:
    void resolve(Program& program);
    TypeKind get_type(const std::string& name) const;
    bool has_type(const std::string& name) const;
    const FunctionSig* get_function(const std::string& name) const;

private:
    std::vector<std::unordered_map<std::string, TypeKind>> scopes_;
    std::unordered_map<std::string, FunctionSig> functions_;
    TypeKind current_return_ = TypeKind::Unknown;
    bool in_function_ = false;
    bool allow_void_call_ = false;
    int current_line_ = 0;

    void push_scope();
    void pop_scope();
    void define(const std::string& name, TypeKind type);
    int line() const { return current_line_; }

    TypeKind resolve_expr(Expression* expr);
    bool resolve_stmt(Statement* stmt);
    bool resolve_block(const std::vector<StmtPtr>& statements);
    void collect_functions(Program& program);
    TypeKind infer_from_literal(Expression* expr);
};
