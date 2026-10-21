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

// M17: a generic function template (`fn f[T](x: T) -> T`). The declaration is
// never resolved or emitted directly; each call site infers concrete type
// arguments, clones the template with the parameters substituted, and resolves
// and emits the resulting monomorphic instantiation.
struct GenericTemplate {
    FunctionDecl* decl = nullptr;
    std::set<std::string> type_params;
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
    // M17 generics. Templates live in their own table (they never enter
    // functions_/fn_decls_); instantiated clones are owned here and spliced
    // into the program at the end of resolve().
    std::unordered_map<std::string, GenericTemplate> generic_fns_;
    std::unordered_map<std::string, FunctionDecl*> instantiated_;  // mangled name -> clone
    std::vector<std::unique_ptr<FunctionDecl>> generic_instances_; // ownership of clones
    // M17.3: generic struct templates (`struct Box[T] { … }`). Like generic
    // functions, a template never enters type_decls_/expanded_structs_ and
    // emits no code; a use site (type position `Box[int]` or the constructor
    // call `Box(5)`) instantiates a concrete clone under its specialization
    // key (type_inst_name: "Box" + "__" + mangled args -> "Box__int"), which
    // is registered in type_decls_ and resolved like an ordinary struct.
    // Instantiations are owned here and appended to the program at the end of
    // resolve(); generic_structs_ is cleared once every use has been expanded.
    std::unordered_map<std::string, TypeDecl*> generic_structs_;
    std::vector<std::unique_ptr<TypeDecl>> generic_struct_instances_;
    std::vector<std::vector<std::unordered_map<std::string, Symbol>>> outer_scope_stack_;
    // Parallel to outer_scope_stack_ (aligned 1:1): the function owning each
    // entry's scope group (nullptr for the top-level/main group). M13 uses it
    // to thread transitive captures through every intermediate function.
    std::vector<FunctionDecl*> outer_fns_;
    std::set<std::string> resolved_functions_;
    FunctionDecl* current_fn_ = nullptr;
    // User-declared types (alias/struct/enum), collected from the merged
    // program before anything else (M16). One namespace shared with functions
    // and top-level variables; collisions are errors.
    std::unordered_map<std::string, TypeDecl*> type_decls_;
    std::unordered_map<std::string, TypeDesc> expanded_structs_;  // nominal name -> full struct desc
    std::set<std::string> building_structs_;   // names whose fields are being expanded (direct chain)
    std::set<std::string> expanding_aliases_;  // names of aliases mid-expansion (cycle detection)
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
    int lambda_counter_ = 0;                       // unique naming for hoisted lambda functions
    std::vector<std::unique_ptr<FunctionDecl>> lambda_fns_;   // ownership of hoisted lambdas

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
    void register_capture_on(FunctionDecl* fn, const std::string& name,
                             const Symbol& sym);
    void thread_capture(const std::string& name, const Symbol& sym,
                        size_t reverse_index);
    void require_capture_visibility(const std::string& fname);
    void require_function_value(const std::string& fname);
    int line() const { return current_line_; }
    TypeDesc expr_element_desc(Expression* expr);
    TypeDesc expr_desc(Expression* expr);
    std::vector<TypeDesc> expr_tuple_members(Expression* expr);
    TypeDesc expr_function_type(Expression* expr);
    TypeKind resolve_tuple_index(ArrayIndexExpr* idx,
                                 const std::vector<TypeDesc>& members, int line);
    bool types_match(const TypeDesc& a, const TypeDesc& b) const;
    void apply_destruct_pattern(std::vector<DestructPattern>& slots,
                                const TypeDesc& val, int line, bool declare,
                                bool is_mutable);
    void bind_destruct_slot(const DestructPattern& slot, const TypeDesc& vd,
                            int line, bool declare, bool is_mutable);

    TypeKind resolve_expr(Expression* expr);
    bool resolve_stmt(Statement* stmt);
    void resolve_var_decl(VarDecl* var);
    void resolve_destruct_decl(DestructDecl* td);
    bool resolve_block(const std::vector<StmtPtr>& statements);
    void resolve_function_decl(FunctionDecl* fn);
    void collect_functions(Program& program);
    void collect_functions_stmt(Statement* stmt);
    // M16: type-declaration collection and named-type reference expansion.
    void collect_type_decls(Program& program);
    void expand_type_refs(Program& program);
    void expand_type_refs_stmt(Statement* stmt);
    void expand_type_refs_expr(Expression* expr);
    TypeDesc expand_desc(const TypeDesc& d, bool by_value);
    // Resolve a named type reference. `args` is the explicit type-argument
    // list of the reference (`Box[int]` -> {"Box"}, {int}); empty for an
    // ordinary name. A generic struct is instantiated on demand (M17.3).
    TypeDesc resolve_named(const std::string& name,
                           const std::vector<TypeDesc>& args, bool by_value);
    // M17.3: clone a generic struct template with `type_params` bound to
    // `args` positionally, register the clone in type_decls_ under its
    // specialization key, and return that key. A no-op when the
    // specialization already exists; validates argument arity.
    std::string instantiate_struct(TypeDecl* tmpl,
                                   const std::vector<TypeDesc>& args,
                                   int line_no);
    void sync_param_desc(FunctionDecl::Param& p);
    void sync_return_desc(bool has_return, TypeKind& return_type,
                          TypeDesc& return_desc, TypeDesc& return_elem,
                          std::vector<TypeDesc>& return_tuple);
    void analyze_nonlocal_exits(Program& program);
    void analyze_nonlocal_stmts(const std::vector<StmtPtr>& stmts, FunctionDecl* enclosing,
                                std::vector<Statement*>& lex_stack, int local_depth,
                                std::vector<int>& switch_depths);
    bool is_loop_stmt(const Statement* stmt) const;
    void require_nonlocal_call(const std::string& fname, const FunctionDecl* cdecl, int line);
    TypeKind infer_from_literal(Expression* expr);

    // --- M17 generics: monomorphization -------------------------------------
    void register_generic_template(FunctionDecl* fn);
    bool body_has_nested_fn(const std::vector<StmtPtr>& body) const;
    std::string monomorphize_call(CallExpr* call, GenericTemplate& tmpl);
    std::string instantiate_generic(GenericTemplate& tmpl,
                                    const std::unordered_map<std::string, TypeDesc>& bind,
                                    int line_no);
    void unify_type_params(const TypeDesc& param, const TypeDesc& arg,
                           const std::set<std::string>& type_params,
                           std::unordered_map<std::string, TypeDesc>& bind,
                           const std::string& ctx, int line_no);
    TypeDesc substitute_desc(const TypeDesc& d,
                             const std::unordered_map<std::string, TypeDesc>& bind);
    void substitute_stmt(Statement* stmt,
                         const std::unordered_map<std::string, TypeDesc>& bind);
    void substitute_expr(Expression* expr,
                         const std::unordered_map<std::string, TypeDesc>& bind);
    std::string mangle_generic(const std::string& fname,
                               const std::vector<std::string>& type_params,
                               const std::unordered_map<std::string, TypeDesc>& bind) const;
    static std::string mangle_desc(const TypeDesc& d);

    CompileError err(int line, const std::string& msg);                    // tags current_file_ (entry-aware)
    CompileError err(int line, const std::string& msg, const std::string& file); // explicit file (entry-aware)
};
