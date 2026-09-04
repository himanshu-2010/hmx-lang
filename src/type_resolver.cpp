#include "type_resolver.hpp"
#include <algorithm>

void TypeResolver::push_scope() {
    scopes_.emplace_back();
}

void TypeResolver::pop_scope() {
    scopes_.pop_back();
}

void TypeResolver::define(const std::string& name, TypeKind type, bool is_mutable) {
    if (scopes_.back().count(name)) {
        throw CompileError(line(), "duplicate declaration of variable '" + name + "'");
    }
    scopes_.back()[name] = {type, is_mutable};
}

const Symbol* TypeResolver::find_symbol(const std::string& name) const {
    for (auto it = scopes_.rbegin(); it != scopes_.rend(); ++it) {
        auto found = it->find(name);
        if (found != it->end()) return &found->second;
    }
    return nullptr;
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
        if (!has_type(id->name)) {
            throw CompileError(line(), "undefined variable '" + id->name + "'");
        }
        result = get_type(id->name);
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "main") {
            throw CompileError(line(), "cannot call function 'main'");
        }
        const FunctionSig* sig = get_function(call->name);
        if (!sig) {
            throw CompileError(line(), "undefined function '" + call->name + "'");
        }
        if (call->args.size() != sig->param_types.size()) {
            throw CompileError(line(),
                "function '" + call->name + "' expects " +
                std::to_string(sig->param_types.size()) + " arguments, got " +
                std::to_string(call->args.size()));
        }
        for (size_t i = 0; i < call->args.size(); i++) {
            TypeKind at = resolve_expr(call->args[i].get());
            if (at != sig->param_types[i]) {
                throw CompileError(line(),
                    "type mismatch: argument " + std::to_string(i + 1) +
                    " of '" + call->name + "' expects " +
                    type_to_string(sig->param_types[i]) + ", got " +
                    type_to_string(at));
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
    } else if (auto* conditional = dynamic_cast<ConditionalExpr*>(expr)) {
        TypeKind condition_type = resolve_expr(conditional->condition.get());
        if (condition_type != TypeKind::Bool) {
            throw CompileError(line(), "ternary condition must be bool, got " +
                type_to_string(condition_type));
        }
        TypeKind then_type = resolve_expr(conditional->then_expr.get());
        TypeKind else_type = resolve_expr(conditional->else_expr.get());
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
        if (lt != rt) {
            throw CompileError(line(),
                "type mismatch in binary expression: " +
                type_to_string(lt) + " " + bin->op + " " + type_to_string(rt));
        }
        switch (bin->kind) {
            case ExprKind::Arithmetic:
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
            define(var->name, var->annotation, var->is_mutable);
        } else {
            if (init_type == TypeKind::Unknown) {
                throw CompileError(var->line,
                    "cannot infer type for '" + var->name + "'");
            }
            var->annotation = init_type;
            define(var->name, init_type, var->is_mutable);
        }
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        if (!has_type(assign->name)) {
            throw CompileError(stmt->line,
                "undefined variable '" + assign->name + "'");
        }
        TypeKind var_type = get_type(assign->name);
        const Symbol* symbol = find_symbol(assign->name);
        if (symbol && !symbol->is_mutable) {
            throw CompileError(stmt->line,
                "cannot modify immutable variable '" + assign->name + "'");
        }
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
        } else {
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
        resolve_expr(print->expr.get());
    } else if (auto* expr_stmt = dynamic_cast<ExprStmt*>(stmt)) {
        bool saved = allow_void_call_;
        allow_void_call_ = true;
        resolve_expr(expr_stmt->expr.get());
        allow_void_call_ = saved;
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        TypeKind ct = resolve_expr(loop->count.get());
        if (ct != TypeKind::Int) {
            throw CompileError(stmt->line,
                "loop count must be int, got " + type_to_string(ct));
        }
        push_scope();
        for (auto& s : loop->body) resolve_stmt(s.get());
        pop_scope();
    } else if (auto* while_stmt = dynamic_cast<WhileStmt*>(stmt)) {
        TypeKind ct = resolve_expr(while_stmt->condition.get());
        if (ct != TypeKind::Bool) {
            throw CompileError(stmt->line,
                "while condition must be bool, got " + type_to_string(ct));
        }
        push_scope();
        for (auto& s : while_stmt->body) resolve_stmt(s.get());
        pop_scope();
    } else if (auto* for_stmt = dynamic_cast<ForStmt*>(stmt)) {
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
        for (auto& s : for_stmt->body) resolve_stmt(s.get());
        pop_scope();
    } else if (auto* do_while = dynamic_cast<DoWhileStmt*>(stmt)) {
        push_scope();
        for (auto& s : do_while->body) resolve_stmt(s.get());
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
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        if (!in_function_) {
            throw CompileError(stmt->line, "return outside of function");
        }
        if (ret->value) {
            TypeKind vt = resolve_expr(ret->value.get());
            if (!in_function_ || current_return_ == TypeKind::Unknown) {
                throw CompileError(stmt->line, "return value in void function");
            }
            if (vt != current_return_) {
                throw CompileError(stmt->line,
                    "type mismatch: return " + type_to_string(vt) +
                    " but function returns " + type_to_string(current_return_));
            }
        } else {
            if (in_function_ && current_return_ != TypeKind::Unknown) {
                throw CompileError(stmt->line,
                    "function expected to return " + type_to_string(current_return_) +
                    " but bare return used");
            }
        }
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        push_scope();
        for (auto& p : fn->params) {
            define(p.name, p.type);
        }
        TypeKind saved_ret = current_return_;
        bool saved_in_fn = in_function_;
        current_return_ = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
        in_function_ = true;
        bool function_returns = resolve_block(fn->body);
        if (fn->has_return_type && !function_returns) {
            throw CompileError(fn->line,
                "function '" + fn->name + "' may exit without returning " +
                type_to_string(fn->return_type));
        }
        in_function_ = saved_in_fn;
        current_return_ = saved_ret;
        pop_scope();
        always_returns = function_returns;
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
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
            if (functions_.count(fn->name)) {
                throw CompileError(fn->line,
                    "duplicate declaration of function '" + fn->name + "'");
            }
            FunctionSig sig;
            for (auto& p : fn->params) sig.param_types.push_back(p.type);
            sig.return_type = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
            sig.has_return = fn->has_return_type;
            functions_[fn->name] = sig;
        }
    }
}

void TypeResolver::resolve(Program& program) {
    collect_functions(program);
    push_scope();
    for (auto& stmt : program.statements) {
        resolve_stmt(stmt.get());
    }
    pop_scope();
}
