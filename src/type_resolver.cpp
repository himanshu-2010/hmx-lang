#include "type_resolver.hpp"
#include <algorithm>
#include <set>

static TypeDesc param_type_desc(const FunctionDecl::Param& p) {
    if (p.type == TypeKind::Function) return p.desc;
    TypeDesc d;
    d.type = p.type;
    d.element_type = p.array_element_type;
    d.tuple_members = p.tuple_members;
    return d;
}

void TypeResolver::push_scope() {
    scopes_.emplace_back();
}

void TypeResolver::pop_scope() {
    scopes_.pop_back();
}

void TypeResolver::define(const std::string& name, TypeKind type, bool is_mutable,
                          TypeKind array_element_type,
                          const std::vector<TypeDesc>& tuple_members,
                          const TypeDesc& desc) {
    if (scopes_.back().count(name)) {
        throw CompileError(line(), "duplicate declaration of variable '" + name + "'");
    }
    scopes_.back()[name] = {type, is_mutable, array_element_type, tuple_members, desc};
}

const Symbol* TypeResolver::find_symbol(const std::string& name) const {
    for (auto it = scopes_.rbegin(); it != scopes_.rend(); ++it) {
        auto found = it->find(name);
        if (found != it->end()) return &found->second;
    }
    return nullptr;
}

const Symbol* TypeResolver::find_outer_symbol(const std::string& name) {
    for (auto it = outer_scope_stack_.rbegin(); it != outer_scope_stack_.rend(); ++it) {
        for (auto m = it->rbegin(); m != it->rend(); ++m) {
            auto found = m->find(name);
            if (found != m->end()) {
                register_capture(name, found->second);
                return &found->second;
            }
        }
    }
    return nullptr;
}

bool TypeResolver::is_in_outer_scopes(const std::string& name) const {
    for (auto it = outer_scope_stack_.rbegin(); it != outer_scope_stack_.rend(); ++it) {
        for (auto m = it->rbegin(); m != it->rend(); ++m) {
            if (m->count(name)) return true;
        }
    }
    return false;
}

void TypeResolver::register_capture(const std::string& name, const Symbol& sym) {
    if (!current_fn_ || current_fn_->name == "main") return;
    for (auto& c : current_fn_->captures) {
        if (c.name == name) return;
    }
    TypeDesc d = sym.desc;
    if (d.type == TypeKind::Unknown && sym.type != TypeKind::Unknown) {
        d.type = sym.type;
        d.element_type = sym.array_element_type;
        d.tuple_members = sym.tuple_members;
    }
    current_fn_->captures.push_back({name, d});
}

void TypeResolver::require_capture_visibility(const std::string& fname) {
    if (fname == "main") return;
    if (current_fn_ && fname == current_fn_->name) return;
    auto it = fn_decls_.find(fname);
    if (it == fn_decls_.end()) return;
    if (!resolved_functions_.count(fname)) return;
    for (auto& c : it->second->captures) {
        const Symbol* s = find_symbol(c.name);
        if (!s) s = find_outer_symbol(c.name);
        if (!s) {
            throw CompileError(line(),
                "cannot call '" + fname + "' from here: captured variable '" +
                c.name + "' is not in scope");
        }
    }
}

void TypeResolver::require_function_value(const std::string& fname) {
    if (fname == "main") return;
    if (current_fn_ && current_fn_->name == fname) return;
    if (!resolved_functions_.count(fname)) {
        throw CompileError(line(),
            "function '" + fname + "' must be declared before it is used as a value");
    }
    auto dit = fn_decls_.find(fname);
    if (dit != fn_decls_.end() && dit->second->has_nonlocal) {
        throw CompileError(line(),
            "cannot use function '" + fname + "' as a value because it has a non-local break/continue target");
    }
    require_capture_visibility(fname);
}

void TypeResolver::require_nonlocal_call(const std::string& fname, const FunctionDecl* cdecl, int error_line) {
    const Statement* target_loop = nullptr;
    for (auto it = lex_loop_stack_.rbegin(); it != lex_loop_stack_.rend(); ++it) {
        if ((*it)->nl_id == cdecl->nl_target_loop_id) {
            target_loop = *it;
            break;
        }
    }
    if (!target_loop || current_fn_ != target_loop->nl_owner) {
        throw CompileError(error_line,
            "cannot call '" + fname + "' from here: its non-local break/continue target loop is not active here");
    }
}

bool TypeResolver::is_loop_stmt(const Statement* stmt) const {
    return dynamic_cast<const LoopStmt*>(stmt) ||
           dynamic_cast<const ForeachStmt*>(stmt) ||
           dynamic_cast<const WhileStmt*>(stmt) ||
           dynamic_cast<const ForStmt*>(stmt) ||
           dynamic_cast<const DoWhileStmt*>(stmt);
}

void TypeResolver::analyze_nonlocal_exits(Program& program) {
    next_loop_id_ = 0;
    std::vector<Statement*> lex_stack;
    std::vector<int> switch_depths;
    analyze_nonlocal_stmts(program.statements, nullptr, lex_stack, 0, switch_depths);
}

void TypeResolver::analyze_nonlocal_stmts(const std::vector<StmtPtr>& stmts, FunctionDecl* enclosing,
                                          std::vector<Statement*>& lex_stack, int local_depth,
                                          std::vector<int>& switch_depths) {
    for (auto& sp : stmts) {
        Statement* stmt = sp.get();
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
            fn->has_nonlocal = false;
            fn->nl_target_loop_id = -1;
            fn->nl_use_break = false;
            fn->nl_use_continue = false;
            std::vector<int> saved_switch = std::move(switch_depths);
            switch_depths.clear();
            analyze_nonlocal_stmts(fn->body, fn, lex_stack, 0, switch_depths);
            switch_depths = std::move(saved_switch);
        } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
            analyze_nonlocal_stmts(ifs->then_body, enclosing, lex_stack, local_depth, switch_depths);
            analyze_nonlocal_stmts(ifs->else_body, enclosing, lex_stack, local_depth, switch_depths);
        } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
            switch_depths.push_back(local_depth);
            for (auto& c : sw->cases) {
                analyze_nonlocal_stmts(c.body, enclosing, lex_stack, local_depth, switch_depths);
            }
            switch_depths.pop_back();
        } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
            f->nl_id = next_loop_id_++;
            f->nl_owner = enclosing;
            lex_stack.push_back(f);
            analyze_nonlocal_stmts(f->body, enclosing, lex_stack, local_depth + 1, switch_depths);
            lex_stack.pop_back();
        } else if (is_loop_stmt(stmt)) {
            stmt->nl_id = next_loop_id_++;
            stmt->nl_owner = enclosing;
            lex_stack.push_back(stmt);
            if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
                analyze_nonlocal_stmts(loop->body, enclosing, lex_stack, local_depth + 1, switch_depths);
            } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
                analyze_nonlocal_stmts(fe->body, enclosing, lex_stack, local_depth + 1, switch_depths);
            } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
                analyze_nonlocal_stmts(w->body, enclosing, lex_stack, local_depth + 1, switch_depths);
            } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
                analyze_nonlocal_stmts(dw->body, enclosing, lex_stack, local_depth + 1, switch_depths);
            }
            lex_stack.pop_back();
        } else if (auto* brk = dynamic_cast<BreakStmt*>(stmt)) {
            if (lex_stack.empty()) {
                throw CompileError(stmt->line, "break outside of a loop");
            }
            Statement* nearest = lex_stack.back();
            if (nearest->nl_owner == enclosing) {
                if (!switch_depths.empty() && local_depth <= switch_depths.back()) {
                    throw CompileError(stmt->line,
                        "break inside a switch case requires an enclosing loop within the case");
                }
            } else {
                brk->nonlocal = true;
                enclosing->has_nonlocal = true;
                enclosing->nl_target_loop_id = nearest->nl_id;
                enclosing->nl_use_break = true;
                nearest->nl_target = true;
            }
        } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
            if (lex_stack.empty()) {
                throw CompileError(stmt->line, "continue outside of a loop");
            }
            Statement* nearest = lex_stack.back();
            if (nearest->nl_owner == enclosing) {
                if (!switch_depths.empty() && local_depth <= switch_depths.back()) {
                    throw CompileError(stmt->line,
                        "continue inside a switch case requires an enclosing loop within the case");
                }
            } else {
                cont->nonlocal = true;
                enclosing->has_nonlocal = true;
                enclosing->nl_target_loop_id = nearest->nl_id;
                enclosing->nl_use_continue = true;
                nearest->nl_target = true;
            }
        }
    }
}

bool TypeResolver::has_type(const std::string& name) const {
    return find_symbol(name) != nullptr;
}

TypeKind TypeResolver::get_type(const std::string& name) const {
    const Symbol* symbol = find_symbol(name);
    return symbol ? symbol->type : TypeKind::Unknown;
}

const FunctionSig* TypeResolver::get_function(const std::string& name) const {
    auto it = functions_.find(name);
    if (it != functions_.end()) return &it->second;
    return nullptr;
}

TypeKind TypeResolver::expr_array_element_type(Expression* expr) {
    if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        return arr->element_type;
    }
    if (auto* id = dynamic_cast<Identifier*>(expr)) {
        const Symbol* s = find_symbol(id->name);
        if (!s) s = find_outer_symbol(id->name);
        if (s && s->type == TypeKind::Array) return s->array_element_type;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        const FunctionSig* sig = get_function(call->name);
        if (sig && sig->return_type == TypeKind::Array) return sig->return_element_type;
        if (call->is_function_value_call && call->fn_type.fn_info &&
            call->fn_type.fn_info->ret.type == TypeKind::Array)
            return call->fn_type.fn_info->ret.element_type;
    }
    if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->is_tuple && idx->element_type == TypeKind::Array) {
            return idx->array_of_element_type;
        }
    }
    return TypeKind::Unknown;
}

std::vector<TypeDesc> TypeResolver::expr_tuple_members(Expression* expr) {
    if (auto* id = dynamic_cast<Identifier*>(expr)) {
        const Symbol* s = find_symbol(id->name);
        if (!s) s = find_outer_symbol(id->name);
        if (s && s->type == TypeKind::Tuple) return s->tuple_members;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        const FunctionSig* sig = get_function(call->name);
        if (sig && sig->return_type == TypeKind::Tuple) return sig->return_tuple_members;
        if (call->is_function_value_call && call->fn_type.fn_info &&
            call->fn_type.fn_info->ret.type == TypeKind::Tuple)
            return call->fn_type.fn_info->ret.tuple_members;
    }
    return {};
}

TypeDesc TypeResolver::expr_function_type(Expression* expr) {
    if (auto* id = dynamic_cast<Identifier*>(expr)) {
        if (id->is_function_reference) return id->fn_type;
        const Symbol* s = find_symbol(id->name);
        if (!s) s = find_outer_symbol(id->name);
        if (s && s->type == TypeKind::Function) return s->desc;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->is_function_value_call && call->fn_type.fn_info) return call->fn_type;
        const FunctionSig* sig = get_function(call->name);
        if (sig && sig->return_type == TypeKind::Function) return sig->return_desc;
    }
    return TypeDesc{};
}

bool TypeResolver::types_match(TypeKind a, TypeKind ae, const std::vector<TypeDesc>& am,
                               TypeKind b, TypeKind be, const std::vector<TypeDesc>& bm) const {
    if (a != b) return false;
    if (a == TypeKind::Array) return ae == be;
    if (a == TypeKind::Tuple) return am == bm;
    return true;
}

TypeKind TypeResolver::infer_from_literal(Expression* expr) {
    if (dynamic_cast<NumberLiteral*>(expr))   return TypeKind::Int;
    if (dynamic_cast<DecimalLiteral*>(expr))  return TypeKind::Decimal;
    if (dynamic_cast<StringLiteral*>(expr))   return TypeKind::Text;
    if (dynamic_cast<BoolLiteral*>(expr))     return TypeKind::Bool;
    if (dynamic_cast<CharLiteral*>(expr))     return TypeKind::Char;
    return TypeKind::Unknown;
}

TypeKind TypeResolver::resolve_expr(Expression* expr) {
    TypeKind result = TypeKind::Unknown;
    if (dynamic_cast<NumberLiteral*>(expr))
        result = TypeKind::Int;
    else if (dynamic_cast<DecimalLiteral*>(expr))
        result = TypeKind::Decimal;
    else if (dynamic_cast<StringLiteral*>(expr))
        result = TypeKind::Text;
    else if (dynamic_cast<BoolLiteral*>(expr))
        result = TypeKind::Bool;
    else if (dynamic_cast<CharLiteral*>(expr))
        result = TypeKind::Char;
    else if (auto* id = dynamic_cast<Identifier*>(expr)) {
        const Symbol* sym = find_symbol(id->name);
        if (!sym) {
            sym = find_outer_symbol(id->name);
            if (!sym) {
                auto fit = functions_.find(id->name);
                if (fit != functions_.end() && fit->first != "main") {
                    require_function_value(id->name);
                    id->is_function_reference = true;
                    id->fn_type = fit->second.fn_type;
                    result = TypeKind::Function;
                } else if (fit != functions_.end()) {
                    throw CompileError(line(),
                        "cannot use function 'main' as a value");
                } else {
                    throw CompileError(line(), "undefined variable '" + id->name + "'");
                }
            } else {
                result = sym->type;
            }
        } else {
            result = get_type(id->name);
        }
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "main") {
            throw CompileError(line(), "cannot call function 'main'");
        }
        if (call->name == "length" || call->name == "substring" ||
            call->name == "input" || call->name == "tostr" ||
            call->name == "parse_int" || call->name == "parse_decimal") {
            size_t expected = 1;
            if (call->name == "substring") expected = 3;
            if (call->name == "input") expected = 0;
            if (call->args.size() != expected) {
                throw CompileError(line(), "builtin '" + call->name + "' expects " +
                    std::to_string(expected) + " arguments, got " +
                    std::to_string(call->args.size()));
            }
            if (call->name == "input") {
                result = TypeKind::Text;
            } else if (call->name == "tostr") {
                TypeKind arg0 = resolve_expr(call->args[0].get());
                if (arg0 != TypeKind::Int && arg0 != TypeKind::Decimal &&
                    arg0 != TypeKind::Bool && arg0 != TypeKind::Char &&
                    arg0 != TypeKind::Byte && arg0 != TypeKind::Text) {
                    throw CompileError(line(),
                        "builtin 'tostr' expects int, decimal, bool, byte, char, or text");
                }
                result = TypeKind::Text;
            } else if (call->name == "parse_int" || call->name == "parse_decimal") {
                TypeKind arg0 = resolve_expr(call->args[0].get());
                if (arg0 != TypeKind::Text) {
                    throw CompileError(line(),
                        "builtin '" + call->name + "' expects text, got " +
                        type_to_string(arg0));
                }
                result = call->name == "parse_int" ? TypeKind::Int : TypeKind::Decimal;
            } else {
                TypeKind arg0 = resolve_expr(call->args[0].get());
                if (call->name == "length") {
                    if (arg0 == TypeKind::Text || arg0 == TypeKind::Array) {
                        result = TypeKind::Int;
                    } else {
                        throw CompileError(line(),
                            "builtin 'length' expects text or array, got " +
                            type_to_string(arg0));
                    }
                } else {
                    if (arg0 != TypeKind::Text) {
                        throw CompileError(line(), "builtin 'substring' expects text as argument 1");
                    }
                    for (size_t i = 1; i < 3; i++) {
                        if (resolve_expr(call->args[i].get()) != TypeKind::Int) {
                            throw CompileError(line(), "builtin 'substring' expects int indexes");
                        }
                    }
                    result = TypeKind::Text;
                }
            }
            expr->resolved_type = result;
            return result;
        }
        const FunctionSig* sig = get_function(call->name);
        if (!sig) {
            const Symbol* lsym = find_symbol(call->name);
            if (!lsym) lsym = find_outer_symbol(call->name);
            if (lsym && lsym->type == TypeKind::Function && lsym->desc.fn_info) {
                const FunctionTypeInfo& info = *lsym->desc.fn_info;
                call->is_function_value_call = true;
                call->fn_type = lsym->desc;
                if (call->args.size() != info.params.size()) {
                    throw CompileError(line(),
                        "function '" + call->name + "' expects " +
                        std::to_string(info.params.size()) + " arguments, got " +
                        std::to_string(call->args.size()));
                }
                for (size_t i = 0; i < call->args.size(); i++) {
                    TypeKind at = resolve_expr(call->args[i].get());
                    const TypeDesc& expected = info.params[i];
                    if (at != expected.type) {
                        throw CompileError(line(),
                            "type mismatch: argument " + std::to_string(i + 1) +
                            " of '" + call->name + "' expects " +
                            type_desc_to_string(expected) + ", got " + type_to_string(at));
                    }
                    if (expected.type == TypeKind::Array) {
                        TypeKind arg_elem = expr_array_element_type(call->args[i].get());
                        if (arg_elem != expected.element_type) {
                            throw CompileError(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects array of " +
                                type_to_string(expected.element_type) + ", got array of " +
                                type_to_string(arg_elem));
                        }
                    }
                    if (expected.type == TypeKind::Tuple) {
                        std::vector<TypeDesc> arg_members = expr_tuple_members(call->args[i].get());
                        if (arg_members != expected.tuple_members) {
                            throw CompileError(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects tuple " +
                                tuple_type_to_string(expected.tuple_members) + ", got tuple " +
                                tuple_type_to_string(arg_members));
                        }
                    }
                    if (expected.type == TypeKind::Function) {
                        TypeDesc atd = expr_function_type(call->args[i].get());
                        if (atd != expected) {
                            throw CompileError(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects " +
                                type_desc_to_string(expected) + ", got " +
                                (atd.type == TypeKind::Function ? type_desc_to_string(atd) : type_to_string(at)));
                        }
                    }
                }
                if (info.ret.type == TypeKind::Unknown) {
                    if (!allow_void_call_) {
                        throw CompileError(line(),
                            "function '" + call->name + "' returns nothing and cannot be used as a value");
                    }
                    result = TypeKind::Unknown;
                } else {
                    result = info.ret.type;
                }
                expr->resolved_type = result;
                return result;
            }
            throw CompileError(line(), "undefined function '" + call->name + "'");
        }
        require_capture_visibility(call->name);
        auto ndit = fn_decls_.find(call->name);
        if (ndit != fn_decls_.end() && ndit->second->has_nonlocal) {
            require_nonlocal_call(call->name, ndit->second, line());
        }
        size_t fixed = sig->variadic ? sig->param_types.size() - 1 : sig->param_types.size();
        bool has_default = false;
        for (bool d : sig->param_has_default) if (d) { has_default = true; break; }
        if (!has_default && !sig->variadic) {
            if (call->args.size() != sig->param_types.size()) {
                throw CompileError(line(),
                    "function '" + call->name + "' expects " +
                    std::to_string(sig->param_types.size()) + " arguments, got " +
                    std::to_string(call->args.size()));
            }
        } else {
            size_t min_args = 0;
            while (min_args < fixed && !sig->param_has_default[min_args]) min_args++;
            if (call->args.size() < min_args) {
                throw CompileError(line(),
                    "function '" + call->name + "' expects at least " +
                    std::to_string(min_args) + " argument" + (min_args == 1 ? "" : "s") +
                    ", got " + std::to_string(call->args.size()));
            }
            if (!sig->variadic && call->args.size() > sig->param_types.size()) {
                throw CompileError(line(),
                    "function '" + call->name + "' expects " +
                    std::to_string(sig->param_types.size()) + " argument" +
                    (sig->param_types.size() == 1 ? "" : "s") +
                    ", got " + std::to_string(call->args.size()));
            }
        }
        for (size_t i = 0; i < fixed && i < call->args.size(); i++) {
            TypeKind at = resolve_expr(call->args[i].get());
            if (at != sig->param_types[i]) {
                throw CompileError(line(),
                    "type mismatch: argument " + std::to_string(i + 1) +
                    " of '" + call->name + "' expects " +
                    type_to_string(sig->param_types[i]) + ", got " +
                    type_to_string(at));
            }
            if (sig->param_types[i] == TypeKind::Array) {
                TypeKind arg_elem = expr_array_element_type(call->args[i].get());
                if (arg_elem != sig->param_element_types[i]) {
                    throw CompileError(line(),
                        "type mismatch: argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects array of " +
                        type_to_string(sig->param_element_types[i]) + ", got array of " +
                        type_to_string(arg_elem));
                }
            }
            if (sig->param_types[i] == TypeKind::Tuple) {
                std::vector<TypeDesc> arg_members = expr_tuple_members(call->args[i].get());
                if (arg_members != sig->param_tuple_members[i]) {
                    throw CompileError(line(),
                        "type mismatch: argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects tuple " +
                        tuple_type_to_string(sig->param_tuple_members[i]) + ", got tuple " +
                        tuple_type_to_string(arg_members));
                }
            }
            if (sig->param_types[i] == TypeKind::Function) {
                TypeDesc atd = expr_function_type(call->args[i].get());
                const TypeDesc& expected = sig->param_descs[i];
                if (!atd.fn_info || atd != expected) {
                    throw CompileError(line(),
                        "type mismatch: argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects " +
                        type_desc_to_string(expected) + ", got " +
                        (atd.type == TypeKind::Function ? type_desc_to_string(atd) : type_to_string(at)));
                }
            }
        }
        if (sig->variadic) {
            for (size_t i = fixed; i < call->args.size(); i++) {
                TypeKind at = resolve_expr(call->args[i].get());
                if (at != sig->variadic_element_type) {
                    throw CompileError(line(),
                        "type mismatch: variadic argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects " +
                        type_to_string(sig->variadic_element_type) + ", got " +
                        type_to_string(at));
                }
            }
        }
        if (sig->has_return) {
            result = sig->return_type;
        } else {
            if (!allow_void_call_) {
                throw CompileError(line(),
                    "function '" + call->name + "' returns nothing and cannot be used as a value");
            }
            result = TypeKind::Unknown;
        }
    } else if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        if (arr->elements.empty()) {
            result = TypeKind::Array;
        } else {
            TypeKind first = resolve_expr(arr->elements[0].get());
            if (first == TypeKind::Unknown) {
                throw CompileError(line(), "cannot infer array element type");
            }
            if (first == TypeKind::Array) {
                throw CompileError(line(), "nested arrays are not supported");
            }
            if (first == TypeKind::Tuple) {
                throw CompileError(line(), "arrays of tuples are not supported");
            }
            for (size_t i = 1; i < arr->elements.size(); i++) {
                TypeKind t = resolve_expr(arr->elements[i].get());
                if (t != first) {
                    throw CompileError(line(),
                        "array elements must all be the same type, got " +
                        type_to_string(first) + " and " + type_to_string(t));
                }
            }
            arr->element_type = first;
            result = TypeKind::Array;
        }
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        const Symbol* sym = find_symbol(idx->name);
        if (!sym) sym = find_outer_symbol(idx->name);
        if (!sym) {
            throw CompileError(line(), "undefined variable '" + idx->name + "'");
        }
        if (sym->type == TypeKind::Array) {
            TypeKind it = resolve_expr(idx->index.get());
            if (it != TypeKind::Int) {
                throw CompileError(line(),
                    "array index must be int, got " + type_to_string(it));
            }
            if (sym->array_element_type == TypeKind::Unknown) {
                throw CompileError(line(),
                    "cannot index array '" + idx->name + "' with unknown element type");
            }
            idx->element_type = sym->array_element_type;
            result = sym->array_element_type;
        } else if (sym->type == TypeKind::Tuple) {
            auto* num = dynamic_cast<NumberLiteral*>(idx->index.get());
            if (!num) {
                throw CompileError(line(), "tuple index must be an integer constant");
            }
            TypeKind it = resolve_expr(idx->index.get());
            if (it != TypeKind::Int) {
                throw CompileError(line(),
                    "tuple index must be int, got " + type_to_string(it));
            }
            int member_index = num->value;
            if (member_index < 0 || (size_t)member_index >= sym->tuple_members.size()) {
                throw CompileError(line(),
                    "tuple index " + std::to_string(member_index) +
                    " out of range for " + tuple_type_to_string(sym->tuple_members));
            }
            const TypeDesc& member = sym->tuple_members[member_index];
            idx->is_tuple = true;
            idx->member_index = member_index;
            idx->element_type = member.type;
            if (member.type == TypeKind::Array) idx->array_of_element_type = member.element_type;
            result = member.type;
        } else {
            throw CompileError(line(),
                "variable '" + idx->name + "' is not an array");
        }
    } else if (auto* conditional = dynamic_cast<ConditionalExpr*>(expr)) {
        TypeKind condition_type = resolve_expr(conditional->condition.get());
        if (condition_type != TypeKind::Bool) {
            throw CompileError(line(), "ternary condition must be bool, got " +
                type_to_string(condition_type));
        }
        TypeKind then_type = resolve_expr(conditional->then_expr.get());
        TypeKind else_type = resolve_expr(conditional->else_expr.get());
        if (then_type == TypeKind::Array || else_type == TypeKind::Array) {
            throw CompileError(line(), "ternary branches cannot be arrays");
        }
        if (then_type == TypeKind::Tuple || else_type == TypeKind::Tuple) {
            throw CompileError(line(), "ternary branches cannot be tuples");
        }
        if (then_type == TypeKind::Function || else_type == TypeKind::Function) {
            throw CompileError(line(), "ternary branches cannot be functions");
        }
        if (then_type != else_type) {
            throw CompileError(line(), "ternary branches must have the same type, got " +
                type_to_string(then_type) + " and " + type_to_string(else_type));
        }
        result = then_type;
    } else if (auto* cast = dynamic_cast<CastExpr*>(expr)) {
        TypeKind operand_type = resolve_expr(cast->operand.get());
        bool operand_numeric = operand_type == TypeKind::Int || operand_type == TypeKind::Decimal ||
                       operand_type == TypeKind::Char || operand_type == TypeKind::Byte;
        bool target_numeric = cast->target_type == TypeKind::Int ||
                      cast->target_type == TypeKind::Decimal ||
                      cast->target_type == TypeKind::Char ||
                      cast->target_type == TypeKind::Byte;
        bool numeric = operand_numeric && target_numeric;
        if (!numeric) {
            throw CompileError(line(), "casts are only supported between int and decimal");
        }
        result = cast->target_type;
    } else if (auto* bin = dynamic_cast<BinaryExpr*>(expr)) {
        TypeKind lt = resolve_expr(bin->left.get());
        TypeKind rt = resolve_expr(bin->right.get());
        if (lt == TypeKind::Unknown || rt == TypeKind::Unknown) {
            throw CompileError(line(), "cannot resolve type in expression");
        }
        if (lt == TypeKind::Array || rt == TypeKind::Array) {
            throw CompileError(line(),
                "operator '" + bin->op + "' not defined for type array");
        }
        if (lt == TypeKind::Tuple || rt == TypeKind::Tuple) {
            throw CompileError(line(),
                "operator '" + bin->op + "' not defined for type tuple");
        }
        if (lt != rt) {
            throw CompileError(line(),
                "type mismatch in binary expression: " +
                type_to_string(lt) + " " + bin->op + " " + type_to_string(rt));
        }
        switch (bin->kind) {
            case ExprKind::Arithmetic:
                if (bin->op == "%") {
                    if (lt != TypeKind::Int) {
                        throw CompileError(line(),
                            "operator '%' not defined for type " + type_to_string(lt));
                    }
                    result = TypeKind::Int;
                    break;
                }
                if (lt == TypeKind::Text && bin->op == "+") {
                    result = TypeKind::Text;
                    break;
                }
                if (lt == TypeKind::Text || lt == TypeKind::Bool ||
                    lt == TypeKind::Char || lt == TypeKind::Byte) {
                    throw CompileError(line(),
                        "operator '" + bin->op + "' not defined for type " +
                        type_to_string(lt));
                }
                result = lt;
                break;
            case ExprKind::Comparison:
                if (lt == TypeKind::Text) {
                    if (bin->op != "==" && bin->op != "!=") {
                        throw CompileError(line(),
                            "operator '" + bin->op + "' not defined for type text");
                    }
                }
                result = TypeKind::Bool;
                break;
            case ExprKind::Logical:
                if (lt != TypeKind::Bool) {
                    throw CompileError(line(),
                        "operator '" + bin->op + "' requires bool operands, got " +
                        type_to_string(lt));
                }
                result = TypeKind::Bool;
                break;
        }
    } else if (auto* not_expr = dynamic_cast<NotExpr*>(expr)) {
        TypeKind ot = resolve_expr(not_expr->operand.get());
        if (ot != TypeKind::Bool) {
            throw CompileError(line(),
                "operator 'not' requires bool operand, got " + type_to_string(ot));
        }
        result = TypeKind::Bool;
    } else if (auto* neg = dynamic_cast<NegExpr*>(expr)) {
        TypeKind ot = resolve_expr(neg->operand.get());
        if (ot != TypeKind::Int && ot != TypeKind::Decimal) {
            throw CompileError(line(),
                "operator '-' not defined for type " + type_to_string(ot));
        }
        result = ot;
    }
    expr->resolved_type = result;
    return result;
}

bool TypeResolver::resolve_stmt(Statement* stmt) {
    current_line_ = stmt->line;
    bool always_returns = false;
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        TypeKind init_type = resolve_expr(var->initializer.get());
        if (var->has_annotation) {
            if (var->annotation == TypeKind::Byte) {
                auto* number = dynamic_cast<NumberLiteral*>(var->initializer.get());
                if (number && (number->value < 0 || number->value > 255)) {
                    throw CompileError(var->line, "byte value must be between 0 and 255");
                }
            }
            if (init_type != TypeKind::Unknown && init_type != var->annotation) {
                bool byte_literal = var->annotation == TypeKind::Byte &&
                    dynamic_cast<NumberLiteral*>(var->initializer.get()) != nullptr;
                if (!byte_literal) {
                throw CompileError(var->line,
                    "type mismatch: variable '" + var->name + "' declared as " +
                    type_to_string(var->annotation) + " but initialized with " +
                    type_to_string(init_type));
                }
            }
            if (var->annotation == TypeKind::Function) {
                TypeDesc init_desc = expr_function_type(var->initializer.get());
                if (init_desc != var->annotation_desc) {
                    throw CompileError(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        type_desc_to_string(var->annotation_desc) + " but initialized with " +
                        (init_desc.type == TypeKind::Function ? type_desc_to_string(init_desc) : type_to_string(init_type)));
                }
                define(var->name, TypeKind::Function, var->is_mutable, TypeKind::Unknown, {},
                       var->annotation_desc);
            } else if (var->annotation == TypeKind::Array) {
                if (auto* arrlit = dynamic_cast<ArrayLiteral*>(var->initializer.get())) {
                    if (arrlit->element_type == TypeKind::Unknown) {
                        arrlit->element_type = var->array_element_type;
                    } else if (var->array_element_type != TypeKind::Unknown &&
                               arrlit->element_type != var->array_element_type) {
                        throw CompileError(var->line,
                            "type mismatch: variable '" + var->name + "' declared as array of " +
                            type_to_string(var->array_element_type) + " but initialized with array of " +
                            type_to_string(arrlit->element_type));
                    }
                }
                define(var->name, TypeKind::Array, var->is_mutable, var->array_element_type);
            } else if (var->annotation == TypeKind::Tuple) {
                if (init_type != TypeKind::Tuple) {
                    throw CompileError(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        tuple_type_to_string(var->tuple_members) + " but initialized with " +
                        type_to_string(init_type));
                }
                if (expr_tuple_members(var->initializer.get()) != var->tuple_members) {
                    throw CompileError(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        tuple_type_to_string(var->tuple_members) + " but initialized with " +
                        tuple_type_to_string(expr_tuple_members(var->initializer.get())));
                }
                define(var->name, TypeKind::Tuple, var->is_mutable, TypeKind::Unknown,
                       var->tuple_members);
            } else {
                define(var->name, var->annotation, var->is_mutable);
            }
        } else {
            if (init_type == TypeKind::Unknown) {
                throw CompileError(var->line,
                    "cannot infer type for '" + var->name + "'");
            }
            TypeKind elem = TypeKind::Unknown;
            if (init_type == TypeKind::Array) {
                elem = expr_array_element_type(var->initializer.get());
                if (elem == TypeKind::Unknown) {
                    throw CompileError(var->line,
                        "cannot infer array element type for '" + var->name + "'; use an annotation like [int]");
                }
            }
            if (init_type == TypeKind::Tuple) {
                var->tuple_members = expr_tuple_members(var->initializer.get());
                if (var->tuple_members.empty()) {
                    throw CompileError(var->line,
                        "cannot infer tuple type for '" + var->name + "'; use an annotation like (int, int)");
                }
            }
            var->annotation = init_type;
            if (init_type == TypeKind::Function) {
                TypeDesc init_desc = expr_function_type(var->initializer.get());
                if (!init_desc.fn_info) {
                    throw CompileError(var->line,
                        "cannot infer function type for '" + var->name + "'; use an annotation like fn(int) -> int");
                }
                var->annotation_desc = init_desc;
                define(var->name, init_type, var->is_mutable, TypeKind::Unknown, {}, init_desc);
            } else {
                define(var->name, init_type, var->is_mutable, elem, var->tuple_members);
            }
        }
    } else if (auto* aassign = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        const Symbol* sym = find_symbol(aassign->name);
        if (!sym) {
            if (is_in_outer_scopes(aassign->name)) {
                throw CompileError(stmt->line,
                    "cannot assign to captured variable '" + aassign->name + "'");
            }
            throw CompileError(stmt->line,
                "undefined variable '" + aassign->name + "'");
        }
        if (sym->type != TypeKind::Array) {
            throw CompileError(stmt->line,
                "variable '" + aassign->name + "' is not an array");
        }
        if (!sym->is_mutable) {
            throw CompileError(stmt->line,
                "cannot modify immutable variable '" + aassign->name + "'");
        }
        TypeKind it = resolve_expr(aassign->index.get());
        if (it != TypeKind::Int) {
            throw CompileError(stmt->line,
                "array index must be int, got " + type_to_string(it));
        }
        if (sym->array_element_type == TypeKind::Unknown) {
            throw CompileError(stmt->line,
                "cannot index array '" + aassign->name + "' with unknown element type");
        }
        TypeKind vt = resolve_expr(aassign->rhs.get());
        if (vt != sym->array_element_type) {
            throw CompileError(stmt->line,
                "type mismatch: cannot assign " + type_to_string(vt) +
                " to array element of " + type_to_string(sym->array_element_type));
        }
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        if (!has_type(assign->name)) {
            if (is_in_outer_scopes(assign->name)) {
                throw CompileError(stmt->line,
                    "cannot assign to captured variable '" + assign->name + "'");
            }
            throw CompileError(stmt->line,
                "undefined variable '" + assign->name + "'");
        }
        const Symbol* symbol = find_symbol(assign->name);
        if (symbol && !symbol->is_mutable) {
            throw CompileError(stmt->line,
                "cannot modify immutable variable '" + assign->name + "'");
        }
        TypeKind var_type = get_type(assign->name);
        if (assign->op == "++" || assign->op == "--") {
            if (var_type != TypeKind::Int && var_type != TypeKind::Decimal) {
                throw CompileError(stmt->line,
                    "operator '" + assign->op + "' requires int or decimal, got " +
                    type_to_string(var_type));
            }
        } else if (assign->op == "=") {
            TypeKind rhs_type = resolve_expr(assign->rhs.get());
            if (rhs_type != var_type) {
                throw CompileError(stmt->line,
                    "type mismatch: cannot assign " + type_to_string(rhs_type) +
                    " to " + type_to_string(var_type));
            }
            if (var_type == TypeKind::Array) {
                if (expr_array_element_type(assign->rhs.get()) != symbol->array_element_type) {
                    throw CompileError(stmt->line,
                        "type mismatch: cannot assign array of " +
                        type_to_string(expr_array_element_type(assign->rhs.get())) +
                        " to " + type_to_string(symbol->array_element_type));
                }
            }
            if (var_type == TypeKind::Tuple) {
                if (expr_tuple_members(assign->rhs.get()) != symbol->tuple_members) {
                    throw CompileError(stmt->line,
                        "type mismatch: cannot assign tuple " +
                        tuple_type_to_string(expr_tuple_members(assign->rhs.get())) +
                        " to " + tuple_type_to_string(symbol->tuple_members));
                }
            }
            if (var_type == TypeKind::Function) {
                TypeDesc rhs_desc = expr_function_type(assign->rhs.get());
                if (rhs_desc != symbol->desc) {
                    throw CompileError(stmt->line,
                        "type mismatch: cannot assign " +
                        (rhs_desc.type == TypeKind::Function ? type_desc_to_string(rhs_desc) : type_to_string(rhs_type)) +
                        " to " + type_desc_to_string(symbol->desc));
                }
            }
        } else {
            if (assign->op == "%=" && var_type != TypeKind::Int) {
                throw CompileError(stmt->line,
                    "operator '%=' requires int, got " + type_to_string(var_type));
            }
            if (var_type != TypeKind::Int && var_type != TypeKind::Decimal) {
                throw CompileError(stmt->line,
                    "operator '" + assign->op + "' requires int or decimal, got " +
                    type_to_string(var_type));
            }
            TypeKind rhs_type = resolve_expr(assign->rhs.get());
            if (rhs_type != var_type) {
                throw CompileError(stmt->line,
                    "type mismatch in compound assignment: " +
                    type_to_string(var_type) + " " + assign->op + " " +
                    type_to_string(rhs_type));
            }
        }
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        for (auto& arg : print->args) {
            TypeKind pt = resolve_expr(arg.get());
            if (pt == TypeKind::Array) {
                throw CompileError(stmt->line,
                    "cannot print an array; index its elements or use length(arr)");
            }
            if (pt == TypeKind::Function) {
                throw CompileError(stmt->line,
                    "cannot print a function");
            }
            if (pt == TypeKind::Tuple) {
                throw CompileError(stmt->line,
                    "cannot print a tuple; destructure it or index its elements");
            }
        }
    } else if (auto* expr_stmt = dynamic_cast<ExprStmt*>(stmt)) {
        bool saved = allow_void_call_;
        allow_void_call_ = true;
        resolve_expr(expr_stmt->expr.get());
        allow_void_call_ = saved;
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        TypeKind src_type = resolve_expr(td->rhs.get());
        if (src_type != TypeKind::Tuple) {
            throw CompileError(stmt->line,
                "right side of tuple destructuring must be a tuple, got " +
                type_to_string(src_type));
        }
        td->tuple_members = expr_tuple_members(td->rhs.get());
        if (td->tuple_members.size() != td->names.size()) {
            throw CompileError(stmt->line,
                "cannot destructure tuple of " +
                std::to_string(td->tuple_members.size()) + " members into " +
                std::to_string(td->names.size()) + " variables");
        }
        for (size_t i = 0; i < td->names.size(); i++) {
            const TypeDesc& m = td->tuple_members[i];
            define(td->names[i], m.type, td->is_mutable,
                   m.type == TypeKind::Array ? m.element_type : TypeKind::Unknown);
        }
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        TypeKind src_type = resolve_expr(ma->rhs.get());
        if (src_type != TypeKind::Tuple) {
            throw CompileError(stmt->line,
                "right side of tuple destructuring must be a tuple, got " +
                type_to_string(src_type));
        }
        ma->tuple_members = expr_tuple_members(ma->rhs.get());
        if (ma->tuple_members.size() != ma->names.size()) {
            throw CompileError(stmt->line,
                "cannot destructure tuple of " +
                std::to_string(ma->tuple_members.size()) + " members into " +
                std::to_string(ma->names.size()) + " variables");
        }
        for (size_t i = 0; i < ma->names.size(); i++) {
            const Symbol* sym = find_symbol(ma->names[i]);
            if (!sym) {
                throw CompileError(stmt->line,
                    "undefined variable '" + ma->names[i] + "'");
            }
            if (!sym->is_mutable) {
                throw CompileError(stmt->line,
                    "cannot modify immutable variable '" + ma->names[i] + "'");
            }
            const TypeDesc& m = ma->tuple_members[i];
            bool ok = types_match(sym->type, sym->array_element_type, sym->tuple_members,
                                  m.type, m.element_type, {});
            if (!ok) {
                throw CompileError(stmt->line,
                    "type mismatch: cannot assign " + type_desc_to_string(m) +
                    " to " + type_desc_to_string(TypeDesc{sym->type, sym->array_element_type, {}}));
            }
        }
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        TypeKind ct = resolve_expr(loop->count.get());
        if (ct != TypeKind::Int) {
            throw CompileError(stmt->line,
                "loop count must be int, got " + type_to_string(ct));
        }
        push_scope();
        loop_depth_++;
        lex_loop_stack_.push_back(loop);
        for (auto& s : loop->body) resolve_stmt(s.get());
        lex_loop_stack_.pop_back();
        loop_depth_--;
        pop_scope();
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        TypeKind it = resolve_expr(fe->iterable.get());
        if (it != TypeKind::Array && it != TypeKind::Text) {
            throw CompileError(stmt->line,
                "foreach iterable must be an array or text, got " + type_to_string(it));
        }
        push_scope();
        if (!fe->index_name.empty()) {
            define(fe->index_name, TypeKind::Int);
        }
        if (it == TypeKind::Array) {
            TypeKind elem = expr_array_element_type(fe->iterable.get());
            if (elem == TypeKind::Unknown) {
                throw CompileError(stmt->line,
                    "foreach cannot infer element type for this array");
            }
            fe->element_type = elem;
            define(fe->value_name, elem);
        } else {
            fe->element_type = TypeKind::Char;
            define(fe->value_name, TypeKind::Char);
        }
        loop_depth_++;
        lex_loop_stack_.push_back(fe);
        for (auto& s : fe->body) resolve_stmt(s.get());
        lex_loop_stack_.pop_back();
        loop_depth_--;
        pop_scope();
    } else if (auto* while_stmt = dynamic_cast<WhileStmt*>(stmt)) {
        TypeKind ct = resolve_expr(while_stmt->condition.get());
        if (ct != TypeKind::Bool) {
            throw CompileError(stmt->line,
                "while condition must be bool, got " + type_to_string(ct));
        }
        push_scope();
        loop_depth_++;
        lex_loop_stack_.push_back(while_stmt);
        for (auto& s : while_stmt->body) resolve_stmt(s.get());
        lex_loop_stack_.pop_back();
        loop_depth_--;
        pop_scope();
    } else if (auto* for_stmt = dynamic_cast<ForStmt*>(stmt)) {
        if (dynamic_cast<DestructDecl*>(for_stmt->init.get())) {
            throw CompileError(stmt->line,
                "tuple destructuring is not supported in for loop headers");
        }
        if (dynamic_cast<MultiAssignStmt*>(for_stmt->update.get())) {
            throw CompileError(stmt->line,
                "tuple destructuring is not supported in for loop update");
        }
        push_scope();
        resolve_stmt(for_stmt->init.get());
        current_line_ = stmt->line;
        TypeKind ct = resolve_expr(for_stmt->condition.get());
        if (ct != TypeKind::Bool) {
            throw CompileError(stmt->line,
                "for condition must be bool, got " + type_to_string(ct));
        }
        current_line_ = for_stmt->update->line;
        resolve_stmt(for_stmt->update.get());
        loop_depth_++;
        lex_loop_stack_.push_back(for_stmt);
        for (auto& s : for_stmt->body) resolve_stmt(s.get());
        lex_loop_stack_.pop_back();
        loop_depth_--;
        pop_scope();
    } else if (auto* do_while = dynamic_cast<DoWhileStmt*>(stmt)) {
        push_scope();
        loop_depth_++;
        lex_loop_stack_.push_back(do_while);
        for (auto& s : do_while->body) resolve_stmt(s.get());
        lex_loop_stack_.pop_back();
        loop_depth_--;
        pop_scope();
        current_line_ = stmt->line;
        TypeKind ct = resolve_expr(do_while->condition.get());
        if (ct != TypeKind::Bool) {
            throw CompileError(stmt->line,
                "do-while condition must be bool, got " + type_to_string(ct));
        }
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        TypeKind cond_type = resolve_expr(ifs->condition.get());
        if (cond_type != TypeKind::Bool) {
            throw CompileError(stmt->line,
                "if condition must be bool, got " + type_to_string(cond_type));
        }
        push_scope();
        bool then_returns = resolve_block(ifs->then_body);
        pop_scope();
        bool else_returns = false;
        if (ifs->has_else) {
            push_scope();
            else_returns = resolve_block(ifs->else_body);
            pop_scope();
        }
        always_returns = ifs->has_else && then_returns && else_returns;
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        TypeKind switch_type = resolve_expr(sw->value.get());
        if (switch_type != TypeKind::Int && switch_type != TypeKind::Byte &&
            switch_type != TypeKind::Char) {
            throw CompileError(stmt->line,
                "switch value must be int, byte, or char, got " +
                type_to_string(switch_type));
        }
        bool has_default = false;
        std::vector<int> seen_values;
        switch_entry_loop_depths_.push_back(loop_depth_);
        for (auto& c : sw->cases) {
            if (c.is_default) {
                if (has_default) {
                    throw CompileError(stmt->line, "switch cannot have multiple default cases");
                }
                has_default = true;
            } else {
                TypeKind case_type = resolve_expr(c.value.get());
                if (case_type != switch_type) {
                    throw CompileError(stmt->line,
                        "switch case type must match switch value type");
                }
                int case_value = 0;
                if (auto* number = dynamic_cast<NumberLiteral*>(c.value.get())) {
                    case_value = number->value;
                } else if (auto* character = dynamic_cast<CharLiteral*>(c.value.get())) {
                    case_value = static_cast<unsigned char>(character->value);
                } else {
                    throw CompileError(stmt->line, "switch cases must be literal values");
                }
                if (std::find(seen_values.begin(), seen_values.end(), case_value) != seen_values.end()) {
                    throw CompileError(stmt->line, "duplicate switch case value");
                }
                seen_values.push_back(case_value);
            }
            push_scope();
            resolve_block(c.body);
            pop_scope();
        }
        switch_entry_loop_depths_.pop_back();
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        if (!in_function_) {
            throw CompileError(stmt->line, "return outside of function");
        }
        ret->return_tuple_members = current_return_tuple_;
        if (ret->values.empty()) {
            if (in_function_ && current_return_ != TypeKind::Unknown) {
                throw CompileError(stmt->line,
                    "function expected to return " + type_to_string(current_return_) +
                    " but bare return used");
            }
        } else if (current_return_ == TypeKind::Unknown) {
            throw CompileError(stmt->line, "return value in void function");
        } else if (current_return_ == TypeKind::Tuple) {
            if (ret->values.size() == 1) {
                TypeKind vt = resolve_expr(ret->values[0].get());
                if (vt != TypeKind::Tuple) {
                    throw CompileError(stmt->line,
                        "type mismatch: return " + type_to_string(vt) +
                        " but function returns " + tuple_type_to_string(current_return_tuple_));
                }
                if (expr_tuple_members(ret->values[0].get()) != current_return_tuple_) {
                    throw CompileError(stmt->line,
                        "type mismatch: return tuple " +
                        tuple_type_to_string(expr_tuple_members(ret->values[0].get())) +
                        " but function returns " + tuple_type_to_string(current_return_tuple_));
                }
            } else {
                if (ret->values.size() != current_return_tuple_.size()) {
                    throw CompileError(stmt->line,
                        "type mismatch: function returns " +
                        std::to_string(current_return_tuple_.size()) +
                        " values but return statement provides " +
                        std::to_string(ret->values.size()));
                }
                for (size_t i = 0; i < ret->values.size(); i++) {
                    TypeKind vt = resolve_expr(ret->values[i].get());
                    const TypeDesc& expected = current_return_tuple_[i];
                    bool ok = types_match(vt, expr_array_element_type(ret->values[i].get()), {},
                                          expected.type, expected.element_type, {});
                    if (!ok) {
                        throw CompileError(stmt->line,
                            "type mismatch: return value " + std::to_string(i + 1) +
                            " has type " + type_desc_to_string(TypeDesc{vt, expr_array_element_type(ret->values[i].get()), {}}) +
                            " but function member " + std::to_string(i + 1) +
                            " expects " + type_desc_to_string(expected));
                    }
                }
            }
        } else {
            if (ret->values.size() != 1) {
                throw CompileError(stmt->line,
                    "type mismatch: function returns a single " +
                    type_to_string(current_return_) + " value but return statement provides " +
                    std::to_string(ret->values.size()));
            }
            TypeKind vt = resolve_expr(ret->values[0].get());
            if (vt != current_return_) {
                throw CompileError(stmt->line,
                    "type mismatch: return " + type_to_string(vt) +
                    " but function returns " + type_to_string(current_return_));
            }
            if (current_return_ == TypeKind::Function) {
                TypeDesc rt = expr_function_type(ret->values[0].get());
                if (rt != current_return_desc_) {
                    throw CompileError(stmt->line,
                        "type mismatch: return " +
                        (rt.type == TypeKind::Function ? type_desc_to_string(rt) : type_to_string(vt)) +
                        " but function returns " + type_desc_to_string(current_return_desc_));
                }
            }
            if (current_return_ == TypeKind::Array) {
                TypeKind elem = expr_array_element_type(ret->values[0].get());
                if (elem != current_return_element_) {
                    throw CompileError(stmt->line,
                        "type mismatch: return array of " + type_to_string(elem) +
                        " but function returns array of " +
                        type_to_string(current_return_element_));
                }
            }
        }
    } else if (auto* brk = dynamic_cast<BreakStmt*>(stmt)) {
        if (!brk->nonlocal) {
            if (loop_depth_ == 0) {
                throw CompileError(stmt->line, "break outside of a loop");
            }
            if (!switch_entry_loop_depths_.empty() &&
                loop_depth_ <= switch_entry_loop_depths_.back()) {
                throw CompileError(stmt->line,
                    "break inside a switch case requires an enclosing loop within the case");
            }
        }
    } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
        if (!cont->nonlocal) {
            if (loop_depth_ == 0) {
                throw CompileError(stmt->line, "continue outside of a loop");
            }
            if (!switch_entry_loop_depths_.empty() &&
                loop_depth_ <= switch_entry_loop_depths_.back()) {
                throw CompileError(stmt->line,
                    "continue inside a switch case requires an enclosing loop within the case");
            }
        }
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        std::vector<std::unordered_map<std::string, Symbol>> saved_scopes = std::move(scopes_);
        scopes_.clear();
        push_scope();
        std::vector<std::vector<std::unordered_map<std::string, Symbol>>> saved_outer =
            std::move(outer_scope_stack_);
        outer_scope_stack_ = saved_outer;
        outer_scope_stack_.push_back(saved_scopes);
        FunctionDecl* saved_fn = current_fn_;
        current_fn_ = fn;
        fn->captures.clear();
        for (auto& p : fn->params) {
            define(p.name, p.type, true, p.array_element_type, p.tuple_members,
                   param_type_desc(p));
            if (p.default_value) {
                TypeKind dt = infer_from_literal(p.default_value.get());
                TypeKind expect = (p.type == TypeKind::Byte) ? TypeKind::Int : p.type;
                if (p.type == TypeKind::Function || dt == TypeKind::Unknown || dt != expect) {
                    throw CompileError(fn->line,
                        "default value for parameter '" + p.name + "' of function '" +
                        fn->name + "' must be a literal of type " +
                        ((p.type == TypeKind::Byte) ? "byte" : type_to_string(p.type)));
                }
                if (p.type == TypeKind::Byte) {
                    auto* n = dynamic_cast<NumberLiteral*>(p.default_value.get());
                    if (n && (n->value < 0 || n->value > 255)) {
                        throw CompileError(fn->line,
                            "default value for byte parameter '" + p.name +
                            "' must be between 0 and 255");
                    }
                }
            }
        }
        TypeKind saved_ret = current_return_;
        TypeKind saved_ret_elem = current_return_element_;
        TypeDesc saved_ret_desc = current_return_desc_;
        std::vector<TypeDesc> saved_ret_tuple = current_return_tuple_;
        bool saved_in_fn = in_function_;
        int saved_loop_depth = loop_depth_;
        std::vector<int> saved_switch_depths = std::move(switch_entry_loop_depths_);
        loop_depth_ = 0;
        switch_entry_loop_depths_.clear();
        current_return_ = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
        current_return_element_ = fn->has_return_type ? fn->return_array_element_type : TypeKind::Unknown;
        current_return_desc_ = fn->has_return_type ? fn->return_desc : TypeDesc{};
        current_return_tuple_ = fn->has_return_type ? fn->return_tuple_members : std::vector<TypeDesc>{};
        in_function_ = true;
        bool function_returns = resolve_block(fn->body);
        if (fn->has_return_type && !function_returns) {
            throw CompileError(fn->line,
                "function '" + fn->name + "' may exit without returning " +
                type_desc_to_string(fn->return_desc));
        }
        in_function_ = saved_in_fn;
        current_return_ = saved_ret;
        current_return_element_ = saved_ret_elem;
        current_return_desc_ = saved_ret_desc;
        current_return_tuple_ = saved_ret_tuple;
        loop_depth_ = saved_loop_depth;
        switch_entry_loop_depths_ = std::move(saved_switch_depths);
        current_fn_ = saved_fn;
        outer_scope_stack_ = std::move(saved_outer);
        resolved_functions_.insert(fn->name);
        pop_scope();
        scopes_ = std::move(saved_scopes);
        always_returns = false;
    }
    if (dynamic_cast<ReturnStmt*>(stmt)) always_returns = true;
    return always_returns;
}

bool TypeResolver::resolve_block(const std::vector<StmtPtr>& statements) {
    bool always_returns = false;
    for (auto& stmt : statements) {
        bool statement_returns = resolve_stmt(stmt.get());
        if (statement_returns) always_returns = true;
    }
    return always_returns;
}

void TypeResolver::collect_functions(Program& program) {
    for (auto& stmt : program.statements) {
        collect_functions_stmt(stmt.get());
    }
}

void TypeResolver::collect_functions_stmt(Statement* stmt) {
    auto recurse = [this](const std::vector<StmtPtr>& list) {
        for (auto& s : list) collect_functions_stmt(s.get());
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        if (functions_.count(fn->name)) {
            throw CompileError(fn->line,
                "duplicate declaration of function '" + fn->name + "'");
        }
        FunctionSig sig;
        std::vector<TypeDesc> param_descs;
        for (auto& p : fn->params) {
            sig.param_types.push_back(p.type);
            sig.param_element_types.push_back(p.array_element_type);
            sig.param_tuple_members.push_back(p.tuple_members);
            sig.param_has_default.push_back(p.default_value != nullptr);
            TypeDesc pd = param_type_desc(p);
            sig.param_descs.push_back(pd);
            param_descs.push_back(pd);
        }
        if (fn->params.empty()) {
            sig.variadic = false;
        } else {
            sig.variadic = fn->params.back().variadic;
            if (sig.variadic) {
                sig.variadic_element_type = fn->params.back().array_element_type;
                if (sig.variadic_element_type == TypeKind::Array ||
                    sig.variadic_element_type == TypeKind::Tuple ||
                    fn->params.back().type == TypeKind::Function) {
                    throw CompileError(fn->line,
                        "variadic parameter of function '" + fn->name +
                        "' must collect a scalar type");
                }
                for (size_t i = 0; i + 1 < fn->params.size(); i++) {
                    if (fn->params[i].variadic) {
                        throw CompileError(fn->line,
                            "function '" + fn->name + "' has more than one variadic parameter");
                    }
                }
            }
            bool seen_default = false;
            bool seen_variadic = false;
            for (size_t i = 0; i < fn->params.size(); i++) {
                auto& p = fn->params[i];
                if (p.variadic) seen_variadic = true;
                if (seen_variadic && !p.variadic) {
                    throw CompileError(fn->line,
                        "variadic parameter '" + p.name + "' of function '" + fn->name +
                        "' must be the last parameter");
                }
                if (p.variadic && p.default_value) {
                    throw CompileError(fn->line,
                        "variadic parameter '" + p.name + "' cannot have a default value");
                }
                if (p.default_value) seen_default = true;
                if (seen_default && !p.default_value && !p.variadic) {
                    throw CompileError(fn->line,
                        "parameter '" + p.name + "' cannot follow a parameter with a default value");
                }
            }
        }
        sig.return_type = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
        sig.return_element_type = fn->has_return_type ? fn->return_array_element_type : TypeKind::Unknown;
        sig.return_tuple_members = fn->has_return_type ? fn->return_tuple_members : std::vector<TypeDesc>{};
        sig.return_desc = fn->has_return_type ? fn->return_desc : TypeDesc{};
        sig.has_return = fn->has_return_type;
        TypeDesc ftd;
        ftd.type = TypeKind::Function;
        ftd.fn_info = std::make_shared<FunctionTypeInfo>();
        ftd.fn_info->params = param_descs;
        ftd.fn_info->ret = fn->has_return_type ? fn->return_desc : TypeDesc{};
        sig.fn_type = ftd;
        functions_[fn->name] = sig;
        fn_decls_[fn->name] = fn;
        recurse(fn->body);
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        recurse(ifs->then_body);
        recurse(ifs->else_body);
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        for (auto& c : sw->cases) recurse(c.body);
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        recurse(loop->body);
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        recurse(fe->body);
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        recurse(w->body);
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        recurse(f->body);
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        recurse(dw->body);
    }
}

void TypeResolver::resolve(Program& program) {
    collect_functions(program);
    analyze_nonlocal_exits(program);
    push_scope();
    for (auto& stmt : program.statements) {
        resolve_stmt(stmt.get());
    }
    pop_scope();
}
