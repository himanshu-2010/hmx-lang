#pragma once

#include "ast.hpp"
#include "type_resolver.hpp"
#include <string>
#include <sstream>
#include <map>
#include <set>

class CodeGen {
public:
    std::string generate(Program& program, const std::string& source_file);

private:
    struct PartialSig {
        std::vector<TypeDesc> full;   // original parameter list
        int applied = 0;              // prefix args applied at the call
        TypeDesc ret;                 // return type of the original function
    };

    std::ostringstream out_;
    std::string source_file_;
    std::string line_file_;    // file for #line directives in the current function
    std::string fn_file(const FunctionDecl* fn) const {
        return (fn && !fn->file.empty()) ? fn->file : source_file_;
    }
    std::map<std::vector<TypeDesc>, std::string> tuple_types_;
    std::vector<FunctionDecl*> all_functions_;
    std::map<std::string, FunctionDecl*> functions_by_name_;
    std::map<std::string, PartialSig> papp_sigs_;   // mangle -> partial-application signature
    std::set<FunctionDecl*> walked_lambdas_;
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
    // M12 identifier safety: every user identifier is prefixed with `hmx_` so
    // it can never collide with a C keyword, `_`-prefixed reserved name, or the
    // `sd_*` runtime helpers. `main` stays `main` (C entry point); resolver-
    // synthesized `__lam_*` names pass through (decl + ref emit verbatim).
    std::string safe_name(const std::string& name) const;
    void emit_identifier_value(const std::string& name);
    void emit_env_arg(const FunctionDecl* callee);
    void emit_env_heap_arg(const FunctionDecl* callee);
    void emit_destruct_level(const std::vector<DestructPattern>& slots,
                             const std::string& src, const TypeDesc& val,
                             bool declare);
    void emit_binding(const DestructPattern& slot, const std::string& rhs,
                      const TypeDesc& vd, bool declare);
    void emit_pending_tuple_types();
    void collect_lambdas_stmt(Statement* stmt);
    void collect_lambdas_expr(Expression* expr);
    void emit_papp_helpers();
    static std::string papp_mangle_type(const TypeDesc& d);
    std::string papp_mangle(int applied, const std::vector<TypeDesc>& full,
                            const TypeDesc& ret) const;
    FunctionDecl* current_fn_ = nullptr;
};
