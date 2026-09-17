#pragma once

#include "ast.hpp"
#include <set>
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
    std::vector<TypeDesc> param_descs;                       // full descriptor per param
    std::vector<bool> param_has_default;                     // aligned with param_types
    bool variadic = false;                                   // trailing ...elem collector
    TypeKind variadic_element_type = TypeKind::Unknown;
    TypeKind return_type = TypeKind::Unknown;
    TypeKind return_element_type = TypeKind::Unknown;
    std::vector<TypeDesc> return_tuple_members;              // valid when return_type is Tuple
    TypeDesc return_desc;                                    // full return descriptor
    bool has_return = false;
    TypeDesc fn_type;                                        // type of this function as a value
};

struct Symbol {
    TypeKind type;
    bool is_mutable;
    TypeKind array_element_type = TypeKind::Unknown;
    std::vector<TypeDesc> tuple_members = {};   // valid when type is Tuple
    TypeDesc desc = {};                         // full descriptor (Function etc.)
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
    std::unordered_map<std::string, FunctionDecl*> fn_decls_;
    std::vector<std::vector<std::unordered_map<std::string, Symbol>>> outer_scope_stack_;
    std::set<std::string> resolved_functions_;
    FunctionDecl* current_fn_ = nullptr;
    TypeKind current_return_ = TypeKind::Unknown;
    TypeKind current_return_element_ = TypeKind::Unknown;
    TypeDesc current_return_desc_ = {};
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
                const std::vector<TypeDesc>& tuple_members = {},
                const TypeDesc& desc = TypeDesc{});
    const Symbol* find_symbol(const std::string& name) const;
    const Symbol* find_outer_symbol(const std::string& name);
    bool is_in_outer_scopes(const std::string& name) const;
    void register_capture(const std::string& name, const Symbol& sym);
    void require_capture_visibility(const std::string& fname);
    void require_function_value(const std::string& fname);
    int line() const { return current_line_; }
    TypeKind expr_array_element_type(Expression* expr);
    std::vector<TypeDesc> expr_tuple_members(Expression* expr);
    TypeDesc expr_function_type(Expression* expr);
    bool types_match(TypeKind a, TypeKind ae, const std::vector<TypeDesc>& am,
                     TypeKind b, TypeKind be, const std::vector<TypeDesc>& bm) const;

    TypeKind resolve_expr(Expression* expr);
    bool resolve_stmt(Statement* stmt);
    bool resolve_block(const std::vector<StmtPtr>& statements);
    void collect_functions(Program& program);
    void collect_functions_stmt(Statement* stmt);
    TypeKind infer_from_literal(Expression* expr);
};
