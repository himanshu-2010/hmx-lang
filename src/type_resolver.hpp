#pragma once

#include "ast.hpp"
#include <set>
#include <string>
#include <unordered_map>
#include <vector>
#include <stdexcept>

struct CompileError : std::runtime_error {
    int line;
    std::string file;
    CompileError(int line, const std::string& msg)
        : std::runtime_error("Error [line " + std::to_string(line) + "]: " + msg),
          line(line) {}
    CompileError(int line, const std::string& msg, const std::string& file)
        : std::runtime_error("Error [" + file + ":" + std::to_string(line) + "]: " + msg),
          line(line), file(file) {}
};

struct FunctionSig {
    std::vector<TypeKind> param_types;
    std::vector<TypeDesc> param_elems;
    std::vector<std::vector<TypeDesc>> param_tuple_members;  // valid when param is Tuple
    std::vector<TypeDesc> param_descs;                       // full descriptor per param
    std::vector<bool> param_has_default;                     // aligned with param_types
    bool variadic = false;                                   // trailing ...elem collector
    TypeDesc variadic_elem;
    TypeKind return_type = TypeKind::Unknown;
    TypeDesc return_elem;
    std::vector<TypeDesc> return_tuple_members;              // valid when return_type is Tuple
    TypeDesc return_desc;                                    // full return descriptor
    bool has_return = false;
    TypeDesc fn_type;                                        // type of this function as a value
};

struct Symbol {
    TypeKind type;
    bool is_mutable;
    TypeDesc elem;
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
    TypeDesc current_return_elem_;
    TypeDesc current_return_desc_ = {};
    std::vector<TypeDesc> current_return_tuple_;
    bool in_function_ = false;
    bool allow_void_call_ = false;
    int current_line_ = 0;
    std::string entry_file_;               // entry source path (file-tagged diagnostics compare against this)
    std::string current_file_;             // file of the function currently being resolved
    int loop_depth_ = 0;
    std::vector<int> switch_entry_loop_depths_;
    std::vector<Statement*> lex_loop_stack_;       // loops whose bodies lexically enclose the current stmt
    int next_loop_id_ = 0;                         // unique loop ids for non-local exit bookkeeping

    void push_scope();
    void pop_scope();
    void define(const std::string& name, TypeKind type, bool is_mutable = true,
                const TypeDesc& elem = TypeDesc{},
                const std::vector<TypeDesc>& tuple_members = {},
                const TypeDesc& desc = TypeDesc{});
    const Symbol* find_symbol(const std::string& name) const;
    const Symbol* find_outer_symbol(const std::string& name);
    bool is_in_outer_scopes(const std::string& name) const;
    void register_capture(const std::string& name, const Symbol& sym);
    void require_capture_visibility(const std::string& fname);
    void require_function_value(const std::string& fname);
    int line() const { return current_line_; }
    TypeDesc expr_element_desc(Expression* expr);
    TypeDesc expr_desc(Expression* expr);
    std::vector<TypeDesc> expr_tuple_members(Expression* expr);
    TypeDesc expr_function_type(Expression* expr);
    bool types_match(const TypeDesc& a, const TypeDesc& b) const;
    void apply_destruct_pattern(std::vector<DestructPattern>& slots,
                                const TypeDesc& val, int line, bool declare,
                                bool is_mutable);
    void bind_destruct_slot(const DestructPattern& slot, const TypeDesc& vd,
                            int line, bool declare, bool is_mutable);

    TypeKind resolve_expr(Expression* expr);
    bool resolve_stmt(Statement* stmt);
    bool resolve_block(const std::vector<StmtPtr>& statements);
    void collect_functions(Program& program);
    void collect_functions_stmt(Statement* stmt);
    void analyze_nonlocal_exits(Program& program);
    void analyze_nonlocal_stmts(const std::vector<StmtPtr>& stmts, FunctionDecl* enclosing,
                                std::vector<Statement*>& lex_stack, int local_depth,
                                std::vector<int>& switch_depths);
    bool is_loop_stmt(const Statement* stmt) const;
    void require_nonlocal_call(const std::string& fname, const FunctionDecl* cdecl, int line);
    TypeKind infer_from_literal(Expression* expr);

    CompileError err(int line, const std::string& msg);                    // tags current_file_ (entry-aware)
    CompileError err(int line, const std::string& msg, const std::string& file); // explicit file (entry-aware)
};
