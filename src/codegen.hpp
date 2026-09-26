#pragma once

#include "ast.hpp"
#include "type_resolver.hpp"
#include <string>
#include <sstream>
#include <map>
#include <set>
#include <functional>

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
    // File for a top-level statement: module top-level state declarations carry
    // their own `file` (stamped by the module loader); everything else belongs
    // to wherever the current function / source is.
    std::string statement_file(const Statement* stmt) const {
        if (auto* v = dynamic_cast<const VarDecl*>(stmt); v && !v->file.empty()) {
            return v->file;
        }
        if (auto* d = dynamic_cast<const DestructDecl*>(stmt); d && !d->file.empty()) {
            return d->file;
        }
        return line_file_;
    }
    mutable std::map<std::vector<TypeDesc>, std::string> tuple_types_;
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
    std::string tuple_name(const std::vector<TypeDesc>& members) const;
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

    // ── M15 reference counting ──────────────────────────────────────────
    // Every heap-typed C value is an owning reference. The codegen emits
    // explicit retain/release at binding, assignment, scope exit, call
    // argument and return points, plus generated per-type release helpers.
    struct OwnedEntry {
        std::string cname;   // C variable holding the owning reference
        TypeDesc desc;       // its static type
    };
    std::vector<std::vector<OwnedEntry>> scopes_;   // mirrors emitted C blocks
    std::vector<int> loop_scopes_;                  // scope indices of loop bodies
    std::vector<int> break_targets_;                // scope indices breakable by `break` (loop or switch case)

    static bool type_has_heap(const TypeDesc& d);
    bool expr_is_fresh(Expression* expr);
    // Reconstruct the full TypeDesc of an expression (tuple members, function
    // info) from per-node annotations and the scope stack where needed.
    TypeDesc desc_of_expr(const Expression* expr) const;
    // Search open scopes (innermost first) for a variable's declared desc.
    const TypeDesc* find_var_desc(const std::string& user_name) const;
    // Emit a C expression that yields an owned value (caller owns exactly one
    // reference). Scalars pass through unchanged.
    void emit_owned_expr(Expression* expr);
    // Emit a statement releasing one owned reference held at C lvalue/expr src.
    void emit_release_value(const std::string& src, const TypeDesc& t);
    // Emit the signature-compatible call wrapper `({ ... })` for user /
    // function-value calls: heap args become owned temps evaluated before the
    // call and released afterwards. `emit_call` writes the callee expression
    // (env, nonlocal, then one comma-separated arg per position: the temp name
    // for heap args, inline emission for scalars). `emit_temps`/`emit_releases`
    // handle extra owned temporaries (variadic arrays).
    void emit_wrapped_call(const std::vector<Expression*>& args,
                           const std::vector<TypeDesc>& param_descs,
                           const TypeDesc& ret_desc,
                           const std::function<void(const std::vector<std::string>&)>& emit_call,
                           const std::function<void()>& emit_temps = {},
                           const std::function<void()>& emit_releases = {});
    // Return the per-slot retain/release helper name for a heap type
    // (element slots, tuple members, captures).
    std::string slot_ret_name(const TypeDesc& d) const;
    std::string slot_rel_name(const TypeDesc& d) const;
    // Scope bookkeeping for owned locals.
    void push_scope();
    void pop_scope();
    void declare_owned(const std::string& cname, const TypeDesc& t);
    // Full descriptor of a parameter (Unknown if not one) and the side effect
    // of registering a reassigned heap parameter as owned at function scope.
    TypeDesc param_desc_of(const std::string& user_name) const;
    void declare_param_owned(const std::string& user_name);
    // Emit release statements for every owned entry in every open scope
    // (used by returns); optionally skip a moved local by C name.
    void emit_all_scope_releases(const std::string* skip);
    // Emit releases for scopes from the current depth down to (inclusive of)
    // the innermost loop-body scope: what a break/continue abandons.
    void emit_loop_escape_releases();
    void emit_releases_at_current_scope();
    bool is_owned_local(const std::string& cname) const;
    int innermost_loop_scope() const;
    void generate_tuple_helpers();
    void generate_env_rel_fn(const FunctionDecl* fn);
};
