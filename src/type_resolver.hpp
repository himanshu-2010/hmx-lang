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
    std::vector<TypeKind> param_element_types;
    std::vector<std::vector<TypeDesc>> param_tuple_members;  // valid when param is Tuple
    TypeKind return_type = TypeKind::Unknown;
    TypeKind return_element_type = TypeKind::Unknown;
    std::vector<TypeDesc> return_tuple_members;              // valid when return_type is Tuple
    bool has_return = false;
};

struct Symbol {
    TypeKind type;
    bool is_mutable;
    TypeKind array_element_type = TypeKind::Unknown;
    std::vector<TypeDesc> tuple_members = {};   // valid when type is Tuple
};

class TypeResolver {
public:
    void resolve(Program& program);
    TypeKind get_type(const std::string& name) const;
    bool has_type(const std::string& name) const;
    const FunctionSig* get_function(const std::string& name) const;

private:
    std::vector<std::unordered_map<std::string, Symbol>> scopes_;
    std::unordered_map<std::string, FunctionSig> functions_;
    TypeKind current_return_ = TypeKind::Unknown;
    TypeKind current_return_element_ = TypeKind::Unknown;
    std::vector<TypeDesc> current_return_tuple_;
    bool in_function_ = false;
    bool allow_void_call_ = false;
    int current_line_ = 0;
    int loop_depth_ = 0;
    std::vector<int> switch_entry_loop_depths_;

    void push_scope();
    void pop_scope();
    void define(const std::string& name, TypeKind type, bool is_mutable = true,
                TypeKind array_element_type = TypeKind::Unknown,
                const std::vector<TypeDesc>& tuple_members = {});
    const Symbol* find_symbol(const std::string& name) const;
    int line() const { return current_line_; }
    TypeKind expr_array_element_type(Expression* expr) const;
    std::vector<TypeDesc> expr_tuple_members(Expression* expr) const;
    bool types_match(TypeKind a, TypeKind ae, const std::vector<TypeDesc>& am,
                     TypeKind b, TypeKind be, const std::vector<TypeDesc>& bm) const;

    TypeKind resolve_expr(Expression* expr);
    bool resolve_stmt(Statement* stmt);
    bool resolve_block(const std::vector<StmtPtr>& statements);
    void collect_functions(Program& program);
    TypeKind infer_from_literal(Expression* expr);
};
