#include "type_resolver.hpp"
#include <algorithm>
#include <set>

static TypeDesc param_type_desc(const FunctionDecl::Param& p) {
    if (p.desc.type != TypeKind::Unknown) return p.desc;
    TypeDesc d;
    d.type = p.type;
    d.elem = p.elem_desc.elem;
    d.tuple_members = p.tuple_members;
    return d;
}

static bool desc_fully_known(const TypeDesc& d) {
    if (d.type == TypeKind::Unknown) return false;
    if (d.type == TypeKind::Array) return desc_fully_known(d.element());
    return true;
}

static bool fix_empty_array_literal(ArrayLiteral* arr, const TypeDesc& target_elem) {
    // Fills type-denoting empty literals ([]) from the annotation's element
    // descriptor and returns true when the resulting descriptor matches.
    if (arr->elements.empty() &&
        (arr->elem.elem == nullptr || arr->elem.element().type == TypeKind::Unknown)) {
        arr->elem = target_elem;
        return true;
    }
    if (arr->elem.type == TypeKind::Array && target_elem.type == TypeKind::Array) {
        if (arr->elements.empty()) {
            arr->elem = target_elem;
            return true;
        }
        for (auto& e : arr->elements) {
            if (auto* nested = dynamic_cast<ArrayLiteral*>(e.get())) {
                if (!fix_empty_array_literal(nested, target_elem.element())) return false;
            }
        }
        if (arr->elem.element().type == TypeKind::Unknown) {
            arr->elem = target_elem;
            return true;
        }
        return arr->elem == target_elem;
    }
    return arr->elem == target_elem;
}

void TypeResolver::push_scope() {
    scopes_.emplace_back();
}

void TypeResolver::pop_scope() {
    scopes_.pop_back();
}

void TypeResolver::define(const std::string& name, TypeKind type, bool is_mutable,
                          const TypeDesc& elem,
                          const std::vector<TypeDesc>& tuple_members,
                          const TypeDesc& desc) {
    if (scopes_.back().count(name)) {
        throw err(line(), "duplicate declaration of variable '" + name + "'");
    }
    scopes_.back()[name] = {type, is_mutable, elem, tuple_members, desc};
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
        d.elem = sym.elem.elem;
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
            throw err(line(),
                "cannot call '" + fname + "' from here: captured variable '" +
                c.name + "' is not in scope");
        }
    }
}

void TypeResolver::require_function_value(const std::string& fname) {
    if (fname == "main") return;
    if (current_fn_ && current_fn_->name == fname) return;
    if (!resolved_functions_.count(fname)) {
        throw err(line(),
            "function '" + fname + "' must be declared before it is used as a value");
    }
    auto dit = fn_decls_.find(fname);
    if (dit != fn_decls_.end() && dit->second->has_nonlocal) {
        throw err(line(),
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
        throw err(error_line,
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
                throw err(stmt->line, "break outside of a loop", enclosing ? enclosing->file : "");
            }
            Statement* nearest = lex_stack.back();
            if (nearest->nl_owner == enclosing) {
                if (!switch_depths.empty() && local_depth <= switch_depths.back()) {
                    throw err(stmt->line,
                        "break inside a switch case requires an enclosing loop within the case",
                        enclosing ? enclosing->file : "");
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
                throw err(stmt->line, "continue outside of a loop", enclosing ? enclosing->file : "");
            }
            Statement* nearest = lex_stack.back();
            if (nearest->nl_owner == enclosing) {
                if (!switch_depths.empty() && local_depth <= switch_depths.back()) {
                    throw err(stmt->line,
                        "continue inside a switch case requires an enclosing loop within the case",
                        enclosing ? enclosing->file : "");
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

TypeDesc TypeResolver::expr_element_desc(Expression* expr) {
    if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        return arr->elem;
    }
    if (auto* id = dynamic_cast<Identifier*>(expr)) {
        const Symbol* s = find_symbol(id->name);
        if (!s) s = find_outer_symbol(id->name);
        if (s && s->type == TypeKind::Array) return s->elem;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        const FunctionSig* sig = get_function(call->name);
        if (sig && sig->return_type == TypeKind::Array) return sig->return_elem;
        if (call->is_function_value_call && call->fn_type.fn_info &&
            call->fn_type.fn_info->ret.type == TypeKind::Array)
            return call->fn_type.fn_info->ret.element();
        if (call->name == "slice" || call->name == "concat") {
            return expr_element_desc(call->args[0].get());
        }
        if (call->name == "split") {
            TypeDesc t;
            t.type = TypeKind::Text;
            return t;
        }
        if (call->name == "pop") {
            TypeDesc inner = expr_element_desc(call->args[0].get());
            if (inner.type == TypeKind::Array) return inner.element();
            return inner;
        }
    }
    if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->elem.type == TypeKind::Array) return idx->elem.element();
    }
    return TypeDesc{};
}

TypeDesc TypeResolver::expr_desc(Expression* expr) {
    TypeKind k = expr->resolved_type;
    if (k == TypeKind::Array) return TypeDesc::array_of(expr_element_desc(expr));
    if (k == TypeKind::Tuple) {
        TypeDesc d;
        d.type = TypeKind::Tuple;
        d.tuple_members = expr_tuple_members(expr);
        return d;
    }
    if (k == TypeKind::Function) return expr_function_type(expr);
    TypeDesc d;
    d.type = k;
    return d;
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
    if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->resolved_type == TypeKind::Tuple) return idx->elem.tuple_members;
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
    if (auto* lam = dynamic_cast<LambdaExpr*>(expr)) {
        return lam->lambda_type;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->is_partial) return call->partial_ftype;
        if (call->is_function_value_call && call->fn_type.fn_info)
            return call->fn_type.fn_info->ret;
        const FunctionSig* sig = get_function(call->name);
        if (sig && sig->return_type == TypeKind::Function) return sig->return_desc;
    }
    return TypeDesc{};
}

TypeKind TypeResolver::resolve_tuple_index(ArrayIndexExpr* idx,
                                           const std::vector<TypeDesc>& members,
                                           int line) {
    TypeKind it = resolve_expr(idx->index.get());
    if (it != TypeKind::Int) {
        throw err(line,
            "tuple index must be int, got " + type_to_string(it));
    }
    if (auto* num = dynamic_cast<NumberLiteral*>(idx->index.get())) {
        int member_index = num->value;
        if (member_index < 0 || (size_t)member_index >= members.size()) {
            throw err(line,
                "tuple index " + std::to_string(member_index) +
                " out of range for " + tuple_type_to_string(members));
        }
        const TypeDesc& member = members[member_index];
        idx->is_tuple = true;
        idx->member_index = member_index;
        idx->elem = member;
        return member.type;
    }
    const TypeDesc& first = members[0];
    for (size_t m = 1; m < members.size(); m++) {
        if (!(members[m] == first)) {
            throw err(line,
                "cannot index tuple " + tuple_type_to_string(members) +
                " with a non-constant index: tuple members must all be of the same type");
        }
    }
    idx->is_tuple = true;
    idx->tuple_dynamic = true;
    idx->tuple_arity = (int)members.size();
    idx->elem = first;
    return first.type;
}

bool TypeResolver::types_match(const TypeDesc& a, const TypeDesc& b) const {
    if (a.type != b.type) return false;
    if (a.type == TypeKind::Array) return a.element() == b.element();
    if (a.type == TypeKind::Tuple) return a.tuple_members == b.tuple_members;
    return true;
}

void TypeResolver::bind_destruct_slot(const DestructPattern& slot,
                                      const TypeDesc& vd, int line,
                                      bool declare, bool is_mutable) {
    if (declare) {
        if (vd.type == TypeKind::Tuple) {
            define(slot.name, TypeKind::Tuple, is_mutable, {},
                   vd.tuple_members);
        } else {
            define(slot.name, vd.type, is_mutable, vd.element(), {},
                   vd.type == TypeKind::Function ? vd : TypeDesc{});
        }
        return;
    }
    const Symbol* sym = find_symbol(slot.name);
    if (!sym) {
        throw err(line, "undefined variable '" + slot.name + "'");
    }
    if (!sym->is_mutable) {
        throw err(line,
            "cannot modify immutable variable '" + slot.name + "'");
    }
    TypeDesc have{sym->type,
        std::make_shared<TypeDesc>(sym->elem), sym->tuple_members, {}};
    if (!types_match(have, vd)) {
        throw err(line,
            "type mismatch: cannot assign " + type_desc_to_string(vd) +
            " to " + type_desc_to_string(have));
    }
}

void TypeResolver::apply_destruct_pattern(std::vector<DestructPattern>& slots,
                                          const TypeDesc& val, int line,
                                          bool declare, bool is_mutable) {
    if (val.type == TypeKind::Tuple) {
        for (const auto& p : slots) {
            if (p.is_rest) {
                throw err(line,
                    "cannot use '...rest' when destructuring a tuple");
            }
        }
        if (val.tuple_members.size() != slots.size()) {
            throw err(line,
                "cannot destructure tuple of " +
                std::to_string(val.tuple_members.size()) + " members into " +
                std::to_string(slots.size()) + " variables");
        }
        for (size_t i = 0; i < slots.size(); i++) {
            DestructPattern& slot = slots[i];
            const TypeDesc& member = val.tuple_members[i];
            slot.vdesc = member;
            if (slot.nested) {
                apply_destruct_pattern(slot.items, member, line, declare,
                                       is_mutable);
            } else {
                bind_destruct_slot(slot, member, line, declare, is_mutable);
            }
        }
        return;
    }
    if (val.type == TypeKind::Array) {
        const TypeDesc& elem = val.element();
        bool seen_rest = false;
        for (const auto& p : slots) {
            if (p.is_rest) {
                seen_rest = true;
            } else if (seen_rest) {
                throw err(line,
                    "cannot use '...rest' before another destructuring target");
            }
        }
        for (auto& p : slots) {
            if (p.is_rest) {
                TypeDesc rest = TypeDesc::array_of(elem);
                p.vdesc = rest;
                bind_destruct_slot(p, rest, line, declare, is_mutable);
            } else if (p.nested) {
                p.vdesc = elem;
                apply_destruct_pattern(p.items, elem, line, declare,
                                       is_mutable);
            } else {
                p.vdesc = elem;
                bind_destruct_slot(p, elem, line, declare, is_mutable);
            }
        }
        return;
    }
    if (val.type == TypeKind::Text) {
        TypeDesc char_desc{TypeKind::Char, {}, {}, {}};
        bool seen_rest = false;
        for (const auto& p : slots) {
            if (p.is_rest) {
                seen_rest = true;
            } else if (seen_rest) {
                throw err(line,
                    "cannot use '...rest' before another destructuring target");
            }
        }
        for (auto& p : slots) {
            if (p.is_rest) {
                TypeDesc t{TypeKind::Text, {}, {}, {}};
                p.vdesc = t;
                bind_destruct_slot(p, t, line, declare, is_mutable);
            } else if (p.nested) {
                throw err(line,
                    "cannot destructure a character into a nested pattern");
            } else {
                p.vdesc = char_desc;
                bind_destruct_slot(p, char_desc, line, declare, is_mutable);
            }
        }
        return;
    }
    throw err(line,
        "cannot destructure a value of type " + type_to_string(val.type) +
        " into a nested pattern");
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
    else if (auto* lam = dynamic_cast<LambdaExpr*>(expr)) {
        auto synth = std::make_unique<FunctionDecl>();
        synth->name = "__lam_" + std::to_string(lambda_counter_++);
        while (functions_.count(synth->name) || fn_decls_.count(synth->name)) {
            synth->name = "__lam_" + std::to_string(lambda_counter_++);
        }
        synth->params = std::move(lam->params);
        synth->body = std::move(lam->body);
        synth->has_return_type = lam->has_return_type;
        synth->return_type = lam->return_type;
        synth->return_elem = lam->return_elem;
        synth->return_tuple_members = std::move(lam->return_tuple_members);
        synth->return_desc = lam->return_desc;
        synth->line = lam->line;
        synth->file = current_file_;
        synth->is_lambda = true;
        lam->resolved = synth.get();
        resolve_function_decl(synth.get());
        TypeDesc ftd;
        ftd.type = TypeKind::Function;
        auto res = std::make_shared<FunctionTypeInfo>();
        for (auto& p : synth->params) res->params.push_back(param_type_desc(p));
        res->ret = synth->has_return_type ? synth->return_desc : TypeDesc{};
        ftd.fn_info = res;
        lam->lambda_type = ftd;
        lambda_fns_.push_back(std::move(synth));
        result = TypeKind::Function;
    }
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
                    throw err(line(),
                        "cannot use function 'main' as a value");
                } else {
                    throw err(line(), "undefined variable '" + id->name + "'");
                }
            } else {
                result = sym->type;
            }
        } else {
            result = get_type(id->name);
        }
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "main") {
            throw err(line(), "cannot call function 'main'");
        }
        if (call->name == "length" || call->name == "substring" ||
            call->name == "input" || call->name == "tostr" ||
            call->name == "parse_int" || call->name == "parse_decimal") {
            size_t expected = 1;
            if (call->name == "substring") expected = 3;
            if (call->name == "input") expected = 0;
            if (call->args.size() != expected) {
                throw err(line(), "builtin '" + call->name + "' expects " +
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
                    throw err(line(),
                        "builtin 'tostr' expects int, decimal, bool, byte, char, or text");
                }
                result = TypeKind::Text;
            } else if (call->name == "parse_int" || call->name == "parse_decimal") {
                TypeKind arg0 = resolve_expr(call->args[0].get());
                if (arg0 != TypeKind::Text) {
                    throw err(line(),
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
                        throw err(line(),
                            "builtin 'length' expects text or array, got " +
                            type_to_string(arg0));
                    }
                } else {
                    if (arg0 != TypeKind::Text) {
                        throw err(line(), "builtin 'substring' expects text as argument 1");
                    }
                    for (size_t i = 1; i < 3; i++) {
                        if (resolve_expr(call->args[i].get()) != TypeKind::Int) {
                            throw err(line(), "builtin 'substring' expects int indexes");
                        }
                    }
                    result = TypeKind::Text;
                }
            }
            expr->resolved_type = result;
            return result;
        }
        if (call->name == "push" || call->name == "pop" || call->name == "sort" ||
            call->name == "slice" || call->name == "concat" ||
            call->name == "index_of" || call->name == "contains") {
            size_t expected = (call->name == "sort" || call->name == "pop") ? 1
                : (call->name == "slice" ? 3 : 2);
            if (call->args.size() != expected) {
                throw err(line(), "builtin '" + call->name + "' expects " +
                    std::to_string(expected) + " arguments, got " +
                    std::to_string(call->args.size()));
            }
            if (resolve_expr(call->args[0].get()) != TypeKind::Array) {
                throw err(line(),
                    "builtin '" + call->name + "' expects an array as argument 1");
            }
            TypeDesc arr_elem = expr_element_desc(call->args[0].get());
            call->array_aux = arr_elem;
            if (!desc_fully_known(arr_elem)) {
                throw err(line(),
                    "builtin '" + call->name +
                    "' requires a fully-known array element type");
            }
            if (call->name == "push" || call->name == "sort" || call->name == "pop") {
                if (auto* id = dynamic_cast<Identifier*>(call->args[0].get())) {
                    const Symbol* sym = find_symbol(id->name);
                    if (!sym && is_in_outer_scopes(id->name)) {
                        throw err(line(),
                            "cannot modify captured variable '" + id->name + "'");
                    }
                    if (sym && !sym->is_mutable) {
                        throw err(line(),
                            "cannot modify immutable array '" + id->name + "'");
                    }
                }
            }
            if (call->name == "push") {
                resolve_expr(call->args[1].get());
                TypeDesc vt = expr_desc(call->args[1].get());
                if (vt != arr_elem) {
                    throw err(line(),
                        "type mismatch: cannot push " + type_desc_to_string(vt) +
                        " to array of " + type_desc_to_string(arr_elem));
                }
                if (!allow_void_call_) {
                    throw err(line(),
                        "builtin 'push' returns nothing and cannot be used as a value");
                }
                result = TypeKind::Unknown;
            } else if (call->name == "pop") {
                result = arr_elem.type == TypeKind::Array ? TypeKind::Array : arr_elem.type;
            } else if (call->name == "sort") {
                if (arr_elem.type != TypeKind::Int && arr_elem.type != TypeKind::Decimal &&
                    arr_elem.type != TypeKind::Byte && arr_elem.type != TypeKind::Char &&
                    arr_elem.type != TypeKind::Text) {
                    throw err(line(),
                        "builtin 'sort' requires an array of int, decimal, byte, char, or text");
                }
                if (!allow_void_call_) {
                    throw err(line(),
                        "builtin 'sort' returns nothing and cannot be used as a value");
                }
                result = TypeKind::Unknown;
            } else if (call->name == "slice") {
                for (size_t i = 1; i < 3; i++) {
                    TypeKind it = resolve_expr(call->args[i].get());
                    if (it != TypeKind::Int) {
                        throw err(line(),
                            "builtin 'slice' expects int indexes, got " + type_to_string(it));
                    }
                }
                result = TypeKind::Array;
            } else if (call->name == "concat") {
                TypeKind at = resolve_expr(call->args[1].get());
                if (at != TypeKind::Array) {
                    throw err(line(), "builtin 'concat' expects two arrays");
                }
                TypeDesc a2 = expr_element_desc(call->args[1].get());
                if (a2 != arr_elem) {
                    throw err(line(),
                        "type mismatch: cannot concatenate array of " +
                        type_desc_to_string(a2) + " with array of " +
                        type_desc_to_string(arr_elem));
                }
                result = TypeKind::Array;
            } else {
                resolve_expr(call->args[1].get());
                TypeDesc vt = expr_desc(call->args[1].get());
                if (vt != arr_elem) {
                    throw err(line(),
                        "type mismatch: " + call->name + " value of " +
                        type_desc_to_string(vt) + " does not match array of " +
                        type_desc_to_string(arr_elem));
                }
                if (arr_elem.type == TypeKind::Array ||
                    arr_elem.type == TypeKind::Function) {
                    throw err(line(),
                        "builtin '" + call->name +
                        "' requires an array of scalar or text elements");
                }
                result = call->name == "index_of" ? TypeKind::Int : TypeKind::Bool;
            }
            expr->resolved_type = result;
            return result;
        }
        if (call->name == "ord" || call->name == "chr" || call->name == "split") {
            size_t expected = call->name == "split" ? 2 : 1;
            if (call->args.size() != expected) {
                throw err(line(), "builtin '" + call->name + "' expects " +
                    std::to_string(expected) + " arguments, got " +
                    std::to_string(call->args.size()));
            }
            if (call->name == "ord") {
                TypeKind a0 = resolve_expr(call->args[0].get());
                if (a0 != TypeKind::Char) {
                    throw err(line(),
                        "builtin 'ord' expects char, got " + type_to_string(a0));
                }
                result = TypeKind::Int;
            } else if (call->name == "chr") {
                TypeKind a0 = resolve_expr(call->args[0].get());
                if (a0 != TypeKind::Int) {
                    throw err(line(),
                        "builtin 'chr' expects int, got " + type_to_string(a0));
                }
                result = TypeKind::Char;
            } else {
                TypeKind a0 = resolve_expr(call->args[0].get());
                if (a0 != TypeKind::Text) {
                    throw err(line(),
                        "builtin 'split' expects text as argument 1, got " + type_to_string(a0));
                }
                TypeKind a1 = resolve_expr(call->args[1].get());
                if (a1 != TypeKind::Text) {
                    throw err(line(),
                        "builtin 'split' expects text as argument 2, got " + type_to_string(a1));
                }
                result = TypeKind::Array;
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
                bool partial = !call->args.empty() &&
                               call->args.size() < info.params.size();
                if (partial) {
                    call->is_partial = true;
                    call->partial_applied = (int)call->args.size();
                    call->partial_full_params = info.params;
                    call->partial_params = std::vector<TypeDesc>(
                        info.params.begin() + call->args.size(), info.params.end());
                    call->partial_ret = info.ret;
                    TypeDesc ftd;
                    ftd.type = TypeKind::Function;
                    auto res = std::make_shared<FunctionTypeInfo>();
                    res->params = call->partial_params;
                    res->ret = call->partial_ret;
                    ftd.fn_info = res;
                    call->partial_ftype = ftd;
                } else if (call->args.size() != info.params.size()) {
                    throw err(line(),
                        "function '" + call->name + "' expects " +
                        std::to_string(info.params.size()) + " arguments, got " +
                        std::to_string(call->args.size()));
                }
                for (size_t i = 0; i < call->args.size(); i++) {
                    TypeKind at = resolve_expr(call->args[i].get());
                    const TypeDesc& expected = info.params[i];
                    if (at != expected.type) {
                        throw err(line(),
                            "type mismatch: argument " + std::to_string(i + 1) +
                            " of '" + call->name + "' expects " +
                            type_desc_to_string(expected) + ", got " + type_to_string(at));
                    }
                    if (expected.type == TypeKind::Array) {
                        TypeDesc arg_elem = expr_element_desc(call->args[i].get());
                        if (arg_elem != expected.element()) {
                            throw err(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects array of " +
                                type_desc_to_string(expected.element()) + ", got array of " +
                                type_desc_to_string(arg_elem));
                        }
                    }
                    if (expected.type == TypeKind::Tuple) {
                        std::vector<TypeDesc> arg_members = expr_tuple_members(call->args[i].get());
                        if (arg_members != expected.tuple_members) {
                            throw err(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects tuple " +
                                tuple_type_to_string(expected.tuple_members) + ", got tuple " +
                                tuple_type_to_string(arg_members));
                        }
                    }
                    if (expected.type == TypeKind::Function) {
                        TypeDesc atd = expr_function_type(call->args[i].get());
                        if (atd != expected) {
                            throw err(line(),
                                "type mismatch: argument " + std::to_string(i + 1) +
                                " of '" + call->name + "' expects " +
                                type_desc_to_string(expected) + ", got " +
                                (atd.type == TypeKind::Function ? type_desc_to_string(atd) : type_to_string(at)));
                        }
                    }
                }
                if (call->is_partial) {
                    result = TypeKind::Function;
                } else if (info.ret.type == TypeKind::Unknown) {
                    if (!allow_void_call_) {
                        throw err(line(),
                            "function '" + call->name + "' returns nothing and cannot be used as a value");
                    }
                    result = TypeKind::Unknown;
                } else {
                    result = info.ret.type;
                }
                expr->resolved_type = result;
                return result;
            }
            throw err(line(), "undefined function '" + call->name + "'");
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
            bool partial = !call->args.empty() &&
                           call->args.size() < sig->param_types.size();
            if (partial) {
                call->is_partial = true;
                call->partial_applied = (int)call->args.size();
                call->partial_full_params = sig->param_descs;
                call->partial_params = std::vector<TypeDesc>(
                    sig->param_descs.begin() + call->args.size(), sig->param_descs.end());
                call->partial_ret = sig->return_desc;
                TypeDesc ftd;
                ftd.type = TypeKind::Function;
                auto res = std::make_shared<FunctionTypeInfo>();
                res->params = call->partial_params;
                res->ret = call->partial_ret;
                ftd.fn_info = res;
                call->partial_ftype = ftd;
            } else if (call->args.size() != sig->param_types.size()) {
                throw err(line(),
                    "function '" + call->name + "' expects " +
                    std::to_string(sig->param_types.size()) + " arguments, got " +
                    std::to_string(call->args.size()));
            }
        } else {
            size_t min_args = 0;
            while (min_args < fixed && !sig->param_has_default[min_args]) min_args++;
            if (call->args.size() < min_args) {
                throw err(line(),
                    "function '" + call->name + "' expects at least " +
                    std::to_string(min_args) + " argument" + (min_args == 1 ? "" : "s") +
                    ", got " + std::to_string(call->args.size()));
            }
            if (!sig->variadic && call->args.size() > sig->param_types.size()) {
                throw err(line(),
                    "function '" + call->name + "' expects " +
                    std::to_string(sig->param_types.size()) + " argument" +
                    (sig->param_types.size() == 1 ? "" : "s") +
                    ", got " + std::to_string(call->args.size()));
            }
        }
        for (size_t i = 0; i < fixed && i < call->args.size(); i++) {
            TypeKind at = resolve_expr(call->args[i].get());
            if (at != sig->param_types[i]) {
                throw err(line(),
                    "type mismatch: argument " + std::to_string(i + 1) +
                    " of '" + call->name + "' expects " +
                    type_to_string(sig->param_types[i]) + ", got " +
                    type_to_string(at));
            }
            if (sig->param_types[i] == TypeKind::Array) {
                TypeDesc arg_elem = expr_element_desc(call->args[i].get());
                if (arg_elem != sig->param_elems[i]) {
                    throw err(line(),
                        "type mismatch: argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects array of " +
                        type_desc_to_string(sig->param_elems[i]) + ", got array of " +
                        type_desc_to_string(arg_elem));
                }
            }
            if (sig->param_types[i] == TypeKind::Tuple) {
                std::vector<TypeDesc> arg_members = expr_tuple_members(call->args[i].get());
                if (arg_members != sig->param_tuple_members[i]) {
                    throw err(line(),
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
                    throw err(line(),
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
                if (at != sig->variadic_elem.type) {
                    throw err(line(),
                        "type mismatch: variadic argument " + std::to_string(i + 1) +
                        " of '" + call->name + "' expects " +
                        type_desc_to_string(sig->variadic_elem) + ", got " +
                        type_to_string(at));
                }
            }
        }
        if (call->is_partial) {
            result = TypeKind::Function;
            expr->resolved_type = result;
            return result;
        }
        if (sig->has_return) {
            result = sig->return_type;
        } else {
            if (!allow_void_call_) {
                throw err(line(),
                    "function '" + call->name + "' returns nothing and cannot be used as a value");
            }
            result = TypeKind::Unknown;
        }
    } else if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        if (arr->elements.empty()) {
            result = TypeKind::Array;
        } else {
            resolve_expr(arr->elements[0].get());
            TypeDesc first = expr_desc(arr->elements[0].get());
            if (first.type == TypeKind::Unknown) {
                throw err(line(), "cannot infer array element type");
            }
            if (first.type == TypeKind::Array && !desc_fully_known(first)) {
                throw err(line(), "cannot infer nested array element type");
            }
            for (size_t i = 1; i < arr->elements.size(); i++) {
                resolve_expr(arr->elements[i].get());
                TypeDesc t = expr_desc(arr->elements[i].get());
                if (t != first) {
                    throw err(line(),
                        "array elements must all be the same type, got " +
                        type_desc_to_string(first) + " and " + type_desc_to_string(t));
                }
            }
            arr->elem = first;
            result = TypeKind::Array;
        }
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->base) {
            TypeKind bt = resolve_expr(idx->base.get());
            if (bt == TypeKind::Unknown) {
                throw err(line(), "cannot index value with unknown type");
            }
            TypeDesc bd = expr_desc(idx->base.get());
            if (bd.type == TypeKind::Array) {
                TypeKind it = resolve_expr(idx->index.get());
                if (it != TypeKind::Int) {
                    throw err(line(),
                        "array index must be int, got " + type_to_string(it));
                }
                idx->elem = bd.element();
                result = idx->elem.type;
            } else if (bd.type == TypeKind::Text) {
                TypeKind it = resolve_expr(idx->index.get());
                if (it != TypeKind::Int) {
                    throw err(line(),
                        "text index must be int, got " + type_to_string(it));
                }
                idx->is_text = true;
                TypeDesc elem_desc;
                elem_desc.type = TypeKind::Char;
                idx->elem = elem_desc;
                result = TypeKind::Char;
            } else if (bd.type == TypeKind::Tuple) {
                result = resolve_tuple_index(idx, bd.tuple_members, line());
            } else {
                throw err(line(),
                    "cannot index value of type " + type_to_string(bd.type));
            }
            expr->resolved_type = result;
            return result;
        }
        const Symbol* sym = find_symbol(idx->name);
        if (!sym) sym = find_outer_symbol(idx->name);
        if (!sym) {
            throw err(line(), "undefined variable '" + idx->name + "'");
        }
        if (sym->type == TypeKind::Array) {
            TypeKind it = resolve_expr(idx->index.get());
            if (it != TypeKind::Int) {
                throw err(line(),
                    "array index must be int, got " + type_to_string(it));
            }
            if (sym->elem.type == TypeKind::Unknown) {
                throw err(line(),
                    "cannot index array '" + idx->name + "' with unknown element type");
            }
            idx->elem = sym->elem;
            result = sym->elem.type;
        } else if (sym->type == TypeKind::Text) {
            TypeKind it = resolve_expr(idx->index.get());
            if (it != TypeKind::Int) {
                throw err(line(),
                    "text index must be int, got " + type_to_string(it));
            }
            idx->is_text = true;
            TypeDesc elem_desc;
            elem_desc.type = TypeKind::Char;
            idx->elem = elem_desc;
            result = TypeKind::Char;
        } else if (sym->type == TypeKind::Tuple) {
            result = resolve_tuple_index(idx, sym->tuple_members, line());
        } else {
            throw err(line(),
                "variable '" + idx->name + "' is not an array");
        }
    } else if (auto* conditional = dynamic_cast<ConditionalExpr*>(expr)) {
        TypeKind condition_type = resolve_expr(conditional->condition.get());
        if (condition_type != TypeKind::Bool) {
            throw err(line(), "ternary condition must be bool, got " +
                type_to_string(condition_type));
        }
        TypeKind then_type = resolve_expr(conditional->then_expr.get());
        TypeKind else_type = resolve_expr(conditional->else_expr.get());
        if (then_type == TypeKind::Array || else_type == TypeKind::Array) {
            throw err(line(), "ternary branches cannot be arrays");
        }
        if (then_type == TypeKind::Tuple || else_type == TypeKind::Tuple) {
            throw err(line(), "ternary branches cannot be tuples");
        }
        if (then_type == TypeKind::Function || else_type == TypeKind::Function) {
            throw err(line(), "ternary branches cannot be functions");
        }
        if (then_type != else_type) {
            throw err(line(), "ternary branches must have the same type, got " +
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
            throw err(line(), "casts are only supported between int and decimal");
        }
        result = cast->target_type;
    } else if (auto* bin = dynamic_cast<BinaryExpr*>(expr)) {
        TypeKind lt = resolve_expr(bin->left.get());
        TypeKind rt = resolve_expr(bin->right.get());
        if (lt == TypeKind::Unknown || rt == TypeKind::Unknown) {
            throw err(line(), "cannot resolve type in expression");
        }
        if (lt == TypeKind::Array || rt == TypeKind::Array) {
            throw err(line(),
                "operator '" + bin->op + "' not defined for type array");
        }
        if (lt == TypeKind::Tuple || rt == TypeKind::Tuple) {
            throw err(line(),
                "operator '" + bin->op + "' not defined for type tuple");
        }
        if (lt != rt) {
            throw err(line(),
                "type mismatch in binary expression: " +
                type_to_string(lt) + " " + bin->op + " " + type_to_string(rt));
        }
        switch (bin->kind) {
            case ExprKind::Arithmetic:
                if (bin->op == "%") {
                    if (lt != TypeKind::Int) {
                        throw err(line(),
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
                    throw err(line(),
                        "operator '" + bin->op + "' not defined for type " +
                        type_to_string(lt));
                }
                result = lt;
                break;
            case ExprKind::Comparison:
                if (lt == TypeKind::Text) {
                    if (bin->op != "==" && bin->op != "!=") {
                        throw err(line(),
                            "operator '" + bin->op + "' not defined for type text");
                    }
                }
                result = TypeKind::Bool;
                break;
            case ExprKind::Logical:
                if (lt != TypeKind::Bool) {
                    throw err(line(),
                        "operator '" + bin->op + "' requires bool operands, got " +
                        type_to_string(lt));
                }
                result = TypeKind::Bool;
                break;
        }
    } else if (auto* not_expr = dynamic_cast<NotExpr*>(expr)) {
        TypeKind ot = resolve_expr(not_expr->operand.get());
        if (ot != TypeKind::Bool) {
            throw err(line(),
                "operator 'not' requires bool operand, got " + type_to_string(ot));
        }
        result = TypeKind::Bool;
    } else if (auto* neg = dynamic_cast<NegExpr*>(expr)) {
        TypeKind ot = resolve_expr(neg->operand.get());
        if (ot != TypeKind::Int && ot != TypeKind::Decimal) {
            throw err(line(),
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
                    throw err(var->line, "byte value must be between 0 and 255");
                }
            }
            if (init_type != TypeKind::Unknown && init_type != var->annotation) {
                bool byte_literal = var->annotation == TypeKind::Byte &&
                    dynamic_cast<NumberLiteral*>(var->initializer.get()) != nullptr;
                if (!byte_literal) {
                throw err(var->line,
                    "type mismatch: variable '" + var->name + "' declared as " +
                    type_to_string(var->annotation) + " but initialized with " +
                    type_to_string(init_type));
                }
            }
            if (var->annotation == TypeKind::Function) {
                TypeDesc init_desc = expr_function_type(var->initializer.get());
                if (init_desc != var->annotation_desc) {
                    throw err(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        type_desc_to_string(var->annotation_desc) + " but initialized with " +
                        (init_desc.type == TypeKind::Function ? type_desc_to_string(init_desc) : type_to_string(init_type)));
                }
                define(var->name, TypeKind::Function, var->is_mutable, {},
                       {}, var->annotation_desc);
            } else if (var->annotation == TypeKind::Array) {
                if (auto* arrlit = dynamic_cast<ArrayLiteral*>(var->initializer.get())) {
                    fix_empty_array_literal(arrlit, var->elem_desc);
                    if (arrlit->elem != var->elem_desc) {
                        throw err(var->line,
                            "type mismatch: variable '" + var->name + "' declared as array of " +
                            type_desc_to_string(var->elem_desc) + " but initialized with array of " +
                            type_desc_to_string(arrlit->elem));
                    }
                } else if (!desc_fully_known(var->elem_desc)) {
                    throw err(var->line,
                        "cannot infer array element type for '" + var->name +
                        "'; use a complete annotation like [[int]]");
                }
                define(var->name, TypeKind::Array, var->is_mutable, var->elem_desc);
            } else if (var->annotation == TypeKind::Tuple) {
                if (init_type != TypeKind::Tuple) {
                    throw err(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        tuple_type_to_string(var->tuple_members) + " but initialized with " +
                        type_to_string(init_type));
                }
                if (expr_tuple_members(var->initializer.get()) != var->tuple_members) {
                    throw err(var->line,
                        "type mismatch: variable '" + var->name + "' declared as " +
                        tuple_type_to_string(var->tuple_members) + " but initialized with " +
                        tuple_type_to_string(expr_tuple_members(var->initializer.get())));
                }
                define(var->name, TypeKind::Tuple, var->is_mutable, {},
                       var->tuple_members);
            } else {
                define(var->name, var->annotation, var->is_mutable);
            }
        } else {
            if (init_type == TypeKind::Unknown) {
                throw err(var->line,
                    "cannot infer type for '" + var->name + "'");
            }
            TypeDesc elem;
            if (init_type == TypeKind::Array) {
                elem = expr_element_desc(var->initializer.get());
                if (!desc_fully_known(elem)) {
                    throw err(var->line,
                        "cannot infer array element type for '" + var->name + "'; use an annotation like [int]");
                }
                var->elem_desc = elem;
            }
            if (init_type == TypeKind::Tuple) {
                var->tuple_members = expr_tuple_members(var->initializer.get());
                if (var->tuple_members.empty()) {
                    throw err(var->line,
                        "cannot infer tuple type for '" + var->name + "'; use an annotation like (int, int)");
                }
            }
            var->annotation = init_type;
            if (init_type == TypeKind::Function) {
                TypeDesc init_desc = expr_function_type(var->initializer.get());
                if (!init_desc.fn_info) {
                    throw err(var->line,
                        "cannot infer function type for '" + var->name + "'; use an annotation like fn(int) -> int");
                }
                var->annotation_desc = init_desc;
                define(var->name, init_type, var->is_mutable, {}, {}, init_desc);
            } else {
                define(var->name, init_type, var->is_mutable, elem, var->tuple_members);
            }
        }
    } else if (auto* aassign = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        const Symbol* sym = find_symbol(aassign->name);
        if (!sym) {
            if (is_in_outer_scopes(aassign->name)) {
                throw err(stmt->line,
                    "cannot assign to captured variable '" + aassign->name + "'");
            }
            throw err(stmt->line,
                "undefined variable '" + aassign->name + "'");
        }
        if (sym->type == TypeKind::Text) {
            throw err(stmt->line,
                "cannot assign to a character of a text value");
        }
        if (sym->type != TypeKind::Array) {
            throw err(stmt->line,
                "variable '" + aassign->name + "' is not an array");
        }
        if (!sym->is_mutable) {
            throw err(stmt->line,
                "cannot modify immutable variable '" + aassign->name + "'");
        }
        TypeKind it = resolve_expr(aassign->index.get());
        if (it != TypeKind::Int) {
            throw err(stmt->line,
                "array index must be int, got " + type_to_string(it));
        }
        if (sym->elem.type == TypeKind::Unknown) {
            throw err(stmt->line,
                "cannot index array '" + aassign->name + "' with unknown element type");
        }
        TypeKind vt = resolve_expr(aassign->rhs.get());
        if (vt != sym->elem.type) {
            throw err(stmt->line,
                "type mismatch: cannot assign " + type_to_string(vt) +
                " to array element of " + type_desc_to_string(sym->elem));
        }
    } else if (auto* eassign = dynamic_cast<ElementAssignStmt*>(stmt)) {
        TypeKind tt = resolve_expr(eassign->target.get());
        auto* tidx = dynamic_cast<ArrayIndexExpr*>(eassign->target.get());
        if (tidx->is_text) {
            throw err(stmt->line,
                "cannot assign to a character of a text value");
        }
        if (tidx->is_tuple) {
            auto* base = dynamic_cast<ArrayIndexExpr*>(tidx->base.get());
            const Symbol* tsym = base ? find_symbol(base->name) : nullptr;
            if (tsym && tsym->type == TypeKind::Tuple && !tsym->is_mutable) {
                throw err(stmt->line,
                    "cannot modify immutable tuple");
            }
        }
        TypeKind vt = resolve_expr(eassign->rhs.get());
        if (vt != tt) {
            throw err(stmt->line,
                "type mismatch: cannot assign " + type_to_string(vt) +
                " to element of " + type_desc_to_string(tidx->elem));
        }
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        if (!has_type(assign->name)) {
            if (is_in_outer_scopes(assign->name)) {
                throw err(stmt->line,
                    "cannot assign to captured variable '" + assign->name + "'");
            }
            throw err(stmt->line,
                "undefined variable '" + assign->name + "'");
        }
        const Symbol* symbol = find_symbol(assign->name);
        if (symbol && !symbol->is_mutable) {
            throw err(stmt->line,
                "cannot modify immutable variable '" + assign->name + "'");
        }
        TypeKind var_type = get_type(assign->name);
        if (assign->op == "++" || assign->op == "--") {
            if (var_type != TypeKind::Int && var_type != TypeKind::Decimal) {
                throw err(stmt->line,
                    "operator '" + assign->op + "' requires int or decimal, got " +
                    type_to_string(var_type));
            }
        } else if (assign->op == "=") {
            TypeKind rhs_type = resolve_expr(assign->rhs.get());
            if (rhs_type != var_type) {
                throw err(stmt->line,
                    "type mismatch: cannot assign " + type_to_string(rhs_type) +
                    " to " + type_to_string(var_type));
            }
            if (var_type == TypeKind::Array) {
                TypeDesc rd = expr_element_desc(assign->rhs.get());
                if (rd != symbol->elem) {
                    throw err(stmt->line,
                        "type mismatch: cannot assign array of " +
                        type_desc_to_string(rd) +
                        " to " + type_desc_to_string(symbol->elem));
                }
            }
            if (var_type == TypeKind::Tuple) {
                if (expr_tuple_members(assign->rhs.get()) != symbol->tuple_members) {
                    throw err(stmt->line,
                        "type mismatch: cannot assign tuple " +
                        tuple_type_to_string(expr_tuple_members(assign->rhs.get())) +
                        " to " + tuple_type_to_string(symbol->tuple_members));
                }
            }
            if (var_type == TypeKind::Function) {
                TypeDesc rhs_desc = expr_function_type(assign->rhs.get());
                if (rhs_desc != symbol->desc) {
                    throw err(stmt->line,
                        "type mismatch: cannot assign " +
                        (rhs_desc.type == TypeKind::Function ? type_desc_to_string(rhs_desc) : type_to_string(rhs_type)) +
                        " to " + type_desc_to_string(symbol->desc));
                }
            }
        } else {
            if (assign->op == "%=" && var_type != TypeKind::Int) {
                throw err(stmt->line,
                    "operator '%=' requires int, got " + type_to_string(var_type));
            }
            if (var_type != TypeKind::Int && var_type != TypeKind::Decimal) {
                throw err(stmt->line,
                    "operator '" + assign->op + "' requires int or decimal, got " +
                    type_to_string(var_type));
            }
            TypeKind rhs_type = resolve_expr(assign->rhs.get());
            if (rhs_type != var_type) {
                throw err(stmt->line,
                    "type mismatch in compound assignment: " +
                    type_to_string(var_type) + " " + assign->op + " " +
                    type_to_string(rhs_type));
            }
        }
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        for (auto& arg : print->args) {
            TypeKind pt = resolve_expr(arg.get());
            if (pt == TypeKind::Array) {
                throw err(stmt->line,
                    "cannot print an array; index its elements or use length(arr)");
            }
            if (pt == TypeKind::Function) {
                throw err(stmt->line,
                    "cannot print a function");
            }
            if (pt == TypeKind::Tuple) {
                throw err(stmt->line,
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
        TypeDesc val;
        if (src_type == TypeKind::Tuple) {
            td->destruct_type = TypeKind::Tuple;
            td->tuple_members = expr_tuple_members(td->rhs.get());
            val.type = TypeKind::Tuple;
            val.tuple_members = td->tuple_members;
        } else if (src_type == TypeKind::Array) {
            TypeDesc ed = expr_element_desc(td->rhs.get());
            if (!desc_fully_known(ed)) {
                throw err(stmt->line,
                    "cannot infer element type for this array destructuring");
            }
            td->destruct_type = TypeKind::Array;
            td->destruct_elem = ed;
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(ed);
        } else if (src_type == TypeKind::Text) {
            td->destruct_type = TypeKind::Text;
            val.type = TypeKind::Text;
        } else {
            throw err(stmt->line,
                "right side of destructuring must be a tuple, array, or text, got " +
                type_to_string(src_type));
        }
        apply_destruct_pattern(td->patterns, val, stmt->line, /*declare=*/true,
                               td->is_mutable);
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        TypeKind src_type = resolve_expr(ma->rhs.get());
        TypeDesc val;
        if (src_type == TypeKind::Tuple) {
            ma->destruct_type = TypeKind::Tuple;
            ma->tuple_members = expr_tuple_members(ma->rhs.get());
            val.type = TypeKind::Tuple;
            val.tuple_members = ma->tuple_members;
        } else if (src_type == TypeKind::Array) {
            TypeDesc ed = expr_element_desc(ma->rhs.get());
            if (!desc_fully_known(ed)) {
                throw err(stmt->line,
                    "cannot infer element type for this array destructuring");
            }
            ma->destruct_type = TypeKind::Array;
            ma->destruct_elem = ed;
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(ed);
        } else if (src_type == TypeKind::Text) {
            ma->destruct_type = TypeKind::Text;
            val.type = TypeKind::Text;
        } else {
            throw err(stmt->line,
                "right side of destructuring must be a tuple, array, or text, got " +
                type_to_string(src_type));
        }
        apply_destruct_pattern(ma->patterns, val, stmt->line, /*declare=*/false,
                               /*is_mutable=*/false);
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        TypeKind ct = resolve_expr(loop->count.get());
        if (ct != TypeKind::Int) {
            throw err(stmt->line,
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
            throw err(stmt->line,
                "foreach iterable must be an array or text, got " + type_to_string(it));
        }
        push_scope();
        if (!fe->index_name.empty()) {
            define(fe->index_name, TypeKind::Int);
        }
        if (it == TypeKind::Array) {
            TypeDesc ed = expr_element_desc(fe->iterable.get());
            if (!desc_fully_known(ed)) {
                throw err(stmt->line,
                    "foreach cannot infer element type for this array");
            }
            fe->elem = ed;
            define(fe->value_name, ed.type, true, ed.element());
        } else {
            fe->elem = TypeDesc{TypeKind::Char, {}, {}, {}};
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
            throw err(stmt->line,
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
            throw err(stmt->line,
                "tuple destructuring is not supported in for loop headers");
        }
        if (dynamic_cast<MultiAssignStmt*>(for_stmt->update.get())) {
            throw err(stmt->line,
                "tuple destructuring is not supported in for loop update");
        }
        push_scope();
        resolve_stmt(for_stmt->init.get());
        current_line_ = stmt->line;
        TypeKind ct = resolve_expr(for_stmt->condition.get());
        if (ct != TypeKind::Bool) {
            throw err(stmt->line,
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
            throw err(stmt->line,
                "do-while condition must be bool, got " + type_to_string(ct));
        }
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        TypeKind cond_type = resolve_expr(ifs->condition.get());
        if (cond_type != TypeKind::Bool) {
            throw err(stmt->line,
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
            throw err(stmt->line,
                "switch value must be int, byte, or char, got " +
                type_to_string(switch_type));
        }
        bool has_default = false;
        std::vector<int> seen_values;
        switch_entry_loop_depths_.push_back(loop_depth_);
        for (auto& c : sw->cases) {
            if (c.is_default) {
                if (has_default) {
                    throw err(stmt->line, "switch cannot have multiple default cases");
                }
                has_default = true;
            } else {
                TypeKind case_type = resolve_expr(c.value.get());
                if (case_type != switch_type) {
                    throw err(stmt->line,
                        "switch case type must match switch value type");
                }
                int case_value = 0;
                if (auto* number = dynamic_cast<NumberLiteral*>(c.value.get())) {
                    case_value = number->value;
                } else if (auto* character = dynamic_cast<CharLiteral*>(c.value.get())) {
                    case_value = static_cast<unsigned char>(character->value);
                } else {
                    throw err(stmt->line, "switch cases must be literal values");
                }
                if (std::find(seen_values.begin(), seen_values.end(), case_value) != seen_values.end()) {
                    throw err(stmt->line, "duplicate switch case value");
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
            throw err(stmt->line, "return outside of function");
        }
        ret->return_tuple_members = current_return_tuple_;
        if (ret->values.empty()) {
            if (in_function_ && current_return_ != TypeKind::Unknown) {
                throw err(stmt->line,
                    "function expected to return " + type_to_string(current_return_) +
                    " but bare return used");
            }
        } else if (current_return_ == TypeKind::Unknown) {
            throw err(stmt->line, "return value in void function");
        } else if (current_return_ == TypeKind::Tuple) {
            if (ret->values.size() == 1) {
                TypeKind vt = resolve_expr(ret->values[0].get());
                if (vt != TypeKind::Tuple) {
                    throw err(stmt->line,
                        "type mismatch: return " + type_to_string(vt) +
                        " but function returns " + tuple_type_to_string(current_return_tuple_));
                }
                if (expr_tuple_members(ret->values[0].get()) != current_return_tuple_) {
                    throw err(stmt->line,
                        "type mismatch: return tuple " +
                        tuple_type_to_string(expr_tuple_members(ret->values[0].get())) +
                        " but function returns " + tuple_type_to_string(current_return_tuple_));
                }
            } else {
                if (ret->values.size() != current_return_tuple_.size()) {
                    throw err(stmt->line,
                        "type mismatch: function returns " +
                        std::to_string(current_return_tuple_.size()) +
                        " values but return statement provides " +
                        std::to_string(ret->values.size()));
                }
                for (size_t i = 0; i < ret->values.size(); i++) {
                    resolve_expr(ret->values[i].get());
                    const TypeDesc& expected = current_return_tuple_[i];
                    bool ok = types_match(expr_desc(ret->values[i].get()), expected);
                    if (!ok) {
                        throw err(stmt->line,
                            "type mismatch: return value " + std::to_string(i + 1) +
                            " has type " + type_desc_to_string(expr_desc(ret->values[i].get())) +
                            " but function member " + std::to_string(i + 1) +
                            " expects " + type_desc_to_string(expected));
                    }
                }
            }
        } else {
            if (ret->values.size() != 1) {
                throw err(stmt->line,
                    "type mismatch: function returns a single " +
                    type_to_string(current_return_) + " value but return statement provides " +
                    std::to_string(ret->values.size()));
            }
            TypeKind vt = resolve_expr(ret->values[0].get());
            if (vt != current_return_) {
                throw err(stmt->line,
                    "type mismatch: return " + type_to_string(vt) +
                    " but function returns " + type_to_string(current_return_));
            }
            if (current_return_ == TypeKind::Function) {
                TypeDesc rt = expr_function_type(ret->values[0].get());
                if (rt != current_return_desc_) {
                    throw err(stmt->line,
                        "type mismatch: return " +
                        (rt.type == TypeKind::Function ? type_desc_to_string(rt) : type_to_string(vt)) +
                        " but function returns " + type_desc_to_string(current_return_desc_));
                }
            }
            if (current_return_ == TypeKind::Array) {
                TypeDesc ed = expr_element_desc(ret->values[0].get());
                if (ed != current_return_elem_) {
                    throw err(stmt->line,
                        "type mismatch: return array of " + type_desc_to_string(ed) +
                        " but function returns array of " +
                        type_desc_to_string(current_return_elem_));
                }
            }
        }
    } else if (auto* brk = dynamic_cast<BreakStmt*>(stmt)) {
        if (!brk->nonlocal) {
            if (loop_depth_ == 0) {
                throw err(stmt->line, "break outside of a loop");
            }
            if (!switch_entry_loop_depths_.empty() &&
                loop_depth_ <= switch_entry_loop_depths_.back()) {
                throw err(stmt->line,
                    "break inside a switch case requires an enclosing loop within the case");
            }
        }
    } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
        if (!cont->nonlocal) {
            if (loop_depth_ == 0) {
                throw err(stmt->line, "continue outside of a loop");
            }
            if (!switch_entry_loop_depths_.empty() &&
                loop_depth_ <= switch_entry_loop_depths_.back()) {
                throw err(stmt->line,
                    "continue inside a switch case requires an enclosing loop within the case");
            }
        }
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        resolve_function_decl(fn);
        always_returns = false;
    }
    if (dynamic_cast<ReturnStmt*>(stmt)) always_returns = true;
    return always_returns;
}

void TypeResolver::resolve_function_decl(FunctionDecl* fn) {
    std::string subject = fn->is_lambda ? "lambda" : "function '" + fn->name + "'";
    std::vector<std::unordered_map<std::string, Symbol>> saved_scopes = std::move(scopes_);
    scopes_.clear();
    push_scope();
    std::vector<std::vector<std::unordered_map<std::string, Symbol>>> saved_outer =
        std::move(outer_scope_stack_);
    outer_scope_stack_ = saved_outer;
    outer_scope_stack_.push_back(saved_scopes);
    FunctionDecl* saved_fn = current_fn_;
    std::string saved_file = current_file_;
    current_fn_ = fn;
    if (!fn->file.empty()) current_file_ = fn->file;
    fn->captures.clear();
    for (auto& p : fn->params) {
        define(p.name, p.type, true, p.elem_desc, p.tuple_members,
               param_type_desc(p));
        if (p.default_value) {
            TypeKind dt = infer_from_literal(p.default_value.get());
            TypeKind expect = (p.type == TypeKind::Byte) ? TypeKind::Int : p.type;
            if (p.type == TypeKind::Function || dt == TypeKind::Unknown || dt != expect) {
                throw err(fn->line,
                    "default value for parameter '" + p.name + "' of " + subject +
                    " must be a literal of type " +
                    ((p.type == TypeKind::Byte) ? "byte" : type_to_string(p.type)),
                    fn->file);
            }
            if (p.type == TypeKind::Byte) {
                auto* n = dynamic_cast<NumberLiteral*>(p.default_value.get());
                if (n && (n->value < 0 || n->value > 255)) {
                    throw err(fn->line,
                        "default value for byte parameter '" + p.name +
                        "' must be between 0 and 255",
                        fn->file);
                }
            }
        }
    }
    TypeKind saved_ret = current_return_;
    TypeDesc saved_ret_elem = current_return_elem_;
    TypeDesc saved_ret_desc = current_return_desc_;
    std::vector<TypeDesc> saved_ret_tuple = current_return_tuple_;
    bool saved_in_fn = in_function_;
    int saved_loop_depth = loop_depth_;
    std::vector<int> saved_switch_depths = std::move(switch_entry_loop_depths_);
    loop_depth_ = 0;
    switch_entry_loop_depths_.clear();
    current_return_ = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
    current_return_elem_ = fn->has_return_type ? fn->return_elem : TypeDesc{};
    current_return_desc_ = fn->has_return_type ? fn->return_desc : TypeDesc{};
    current_return_tuple_ = fn->has_return_type ? fn->return_tuple_members : std::vector<TypeDesc>{};
    in_function_ = true;
    bool function_returns = resolve_block(fn->body);
    if (fn->has_return_type && !function_returns) {
        throw err(fn->line,
            subject + " may exit without returning " +
            type_desc_to_string(fn->return_desc),
            fn->file);
    }
    in_function_ = saved_in_fn;
    current_return_ = saved_ret;
    current_return_elem_ = saved_ret_elem;
    current_return_desc_ = saved_ret_desc;
    current_return_tuple_ = saved_ret_tuple;
    loop_depth_ = saved_loop_depth;
    switch_entry_loop_depths_ = std::move(saved_switch_depths);
    current_fn_ = saved_fn;
    current_file_ = saved_file;
    outer_scope_stack_ = std::move(saved_outer);
    resolved_functions_.insert(fn->name);
    pop_scope();
    scopes_ = std::move(saved_scopes);
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
            throw err(fn->line,
                "duplicate declaration of function '" + fn->name + "'", fn->file);
        }
        FunctionSig sig;
        std::vector<TypeDesc> param_descs;
        for (auto& p : fn->params) {
            sig.param_types.push_back(p.type);
            sig.param_elems.push_back(p.elem_desc);
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
                sig.variadic_elem = fn->params.back().elem_desc;
                if (sig.variadic_elem.type == TypeKind::Array ||
                    sig.variadic_elem.type == TypeKind::Tuple ||
                    fn->params.back().desc.type == TypeKind::Function) {
                    throw err(fn->line,
                        "variadic parameter of function '" + fn->name +
                        "' must collect a scalar type",
                        fn->file);
                }
                for (size_t i = 0; i + 1 < fn->params.size(); i++) {
                    if (fn->params[i].variadic) {
                        throw err(fn->line,
                            "function '" + fn->name + "' has more than one variadic parameter", fn->file);
                    }
                }
            }
            bool seen_default = false;
            bool seen_variadic = false;
            for (size_t i = 0; i < fn->params.size(); i++) {
                auto& p = fn->params[i];
                if (p.variadic) seen_variadic = true;
                if (seen_variadic && !p.variadic) {
                    throw err(fn->line,
                        "variadic parameter '" + p.name + "' of function '" + fn->name +
                        "' must be the last parameter",
                        fn->file);
                }
                if (p.variadic && p.default_value) {
                    throw err(fn->line,
                        "variadic parameter '" + p.name + "' cannot have a default value", fn->file);
                }
                if (p.default_value) seen_default = true;
                if (seen_default && !p.default_value && !p.variadic) {
                    throw err(fn->line,
                        "parameter '" + p.name + "' cannot follow a parameter with a default value", fn->file);
                }
            }
        }
        sig.return_type = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
        sig.return_elem = fn->has_return_type ? fn->return_elem : TypeDesc{};
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
    entry_file_ = program.source_file;
    current_file_ = program.source_file;
    collect_functions(program);
    analyze_nonlocal_exits(program);
    push_scope();
    for (auto& stmt : program.statements) {
        resolve_stmt(stmt.get());
    }
    pop_scope();
    for (auto& f : lambda_fns_) {
        program.statements.push_back(std::move(f));
    }
    lambda_fns_.clear();
}

CompileError TypeResolver::err(int line, const std::string& msg) {
    return err(line, msg, current_file_);
}

CompileError TypeResolver::err(int line, const std::string& msg, const std::string& file) {
    if (file.empty() || file == entry_file_) return CompileError(line, msg);
    return CompileError(line, msg, file);
}
