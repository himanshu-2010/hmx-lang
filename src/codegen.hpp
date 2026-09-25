#pragma once

#include "ast.hpp"
#include "type_resolver.hpp"
#include <string>
#include <sstream>
#include <map>

class CodeGen {
public:
    std::string generate(Program& program, const std::string& source_file);

private:
    std::ostringstream out_;
    std::string source_file_;
    std::string line_file_;    // file for #line directives in the current function
    std::string fn_file(const FunctionDecl* fn) const {
        return (fn && !fn->file.empty()) ? fn->file : source_file_;
    }
    std::map<std::vector<TypeDesc>, std::string> tuple_types_;
    std::vector<FunctionDecl*> all_functions_;
    std::map<std::string, FunctionDecl*> functions_by_name_;
    int temp_counter_ = 0;

    void emit_line_directive(int line, const std::string& file);
    void emit_stmt(Statement* stmt);
    void emit_for_component(Statement* stmt);
    void emit_expr(Expression* expr, bool parenthesize = false);
    std::string emit_function_signature(FunctionDecl* fn);
    TypeKind get_expr_type(Expression* expr);
    std::string tuple_name(const std::vector<TypeDesc>& members);
    void collect_tuple_types(Statement* stmt);
    void collect_function_decls(Statement* stmt);
    std::string c_type_for_desc(const TypeDesc& d);
    void register_desc_types(const TypeDesc& d);
    void register_tuple_types_deep(const TypeDesc& d);
    bool is_capture(const FunctionDecl* fn, const std::string& name) const;
    void emit_identifier_value(const std::string& name);
    void emit_env_arg(const FunctionDecl* callee);
    void emit_env_heap_arg(const FunctionDecl* callee);
    void emit_destruct_level(const std::vector<DestructPattern>& slots,
                             const std::string& src, const TypeDesc& val,
                             bool declare);
    void emit_binding(const DestructPattern& slot, const std::string& rhs,
                      const TypeDesc& vd, bool declare);
    void emit_pending_tuple_types();
    FunctionDecl* current_fn_ = nullptr;
};
