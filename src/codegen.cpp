#include "codegen.hpp"

std::string CodeGen::generate(Program& program, const std::string& source_file) {
    source_file_ = source_file;
    TypeResolver resolver;
    resolver.resolve(program);

    out_ << "#include <stdio.h>\n";
    out_ << "#include <stdlib.h>\n";
    out_ << "#include <string.h>\n\n";

    out_ << "static char* sd_concat(const char* a, const char* b) {\n";
    out_ << "    size_t la = strlen(a), lb = strlen(b);\n";
    out_ << "    char* r = malloc(la + lb + 1);\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    memcpy(r, a, la);\n";
    out_ << "    memcpy(r + la, b, lb + 1);\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    out_ << "static char* sd_substring(const char* s, int start, int end) {\n";
    out_ << "    size_t length = strlen(s);\n";
    out_ << "    if (start < 0 || end < start || (size_t)end > length) exit(1);\n";
    out_ << "    char* result = malloc((size_t)(end - start) + 1);\n";
    out_ << "    if (!result) exit(1);\n";
    out_ << "    memcpy(result, s + start, (size_t)(end - start));\n";
    out_ << "    result[end - start] = '\\0';\n";
    out_ << "    return result;\n";
    out_ << "}\n\n";

    out_ << "typedef struct sd_array {\n";
    out_ << "    void* data;\n";
    out_ << "    int length;\n";
    out_ << "} sd_array;\n\n";

    out_ << "static sd_array sd_make_array(const void* data, size_t nbytes, int length) {\n";
    out_ << "    sd_array a;\n";
    out_ << "    a.data = malloc(nbytes ? nbytes : 1);\n";
    out_ << "    if (!a.data) exit(1);\n";
    out_ << "    if (nbytes) memcpy(a.data, data, nbytes);\n";
    out_ << "    a.length = length;\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static int sd_check_index(int length, int index) {\n";
    out_ << "    if (index < 0 || index >= length) {\n";
    out_ << "        fprintf(stderr, \"Error: array index out of bounds (index %d, length %d)\\n\", index, length);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return index;\n";
    out_ << "}\n\n";

    for (auto& stmt : program.statements) collect_tuple_types(stmt.get());

    for (auto& [members, name] : tuple_types_) {
        out_ << "typedef struct " << name << " {\n";
        for (size_t i = 0; i < members.size(); i++) {
            out_ << "    " << type_to_c(members[i].type) << " f" << i << ";\n";
        }
        out_ << "} " << name << ";\n\n";
    }

    std::vector<FunctionDecl*> functions;
    std::vector<Statement*> top_level;

    for (auto& stmt : program.statements) {
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
            functions.push_back(fn);
        } else {
            top_level.push_back(stmt.get());
        }
    }

    for (auto* fn : functions) {
        if (fn->name != "main") {
            out_ << emit_function_signature(fn) << ";\n";
        }
    }
    out_ << "\n";

    out_ << "int main(void) {\n";
    for (auto* stmt : top_level) {
        emit_stmt(stmt);
    }

    FunctionDecl* main_fn = nullptr;
    for (auto* fn : functions) {
        if (fn->name == "main") {
            main_fn = fn;
            for (auto& body_stmt : fn->body) {
                emit_stmt(body_stmt.get());
            }
        }
    }

    if (!main_fn || !main_fn->has_return_type) {
        out_ << "    return 0;\n";
    }
    out_ << "}\n\n";

    for (auto* fn : functions) {
        if (fn->name != "main") {
            out_ << emit_function_signature(fn) << " {\n";
            for (auto& body_stmt : fn->body) {
                emit_stmt(body_stmt.get());
            }
            out_ << "}\n\n";
        }
    }
    return out_.str();
}

std::string CodeGen::emit_function_signature(FunctionDecl* fn) {
    std::string s;
    if (fn->has_return_type) {
        if (fn->return_type == TypeKind::Tuple) {
            s += tuple_name(fn->return_tuple_members);
        } else {
            s += type_to_c(fn->return_type);
        }
    } else {
        s += "void";
    }
    s += " " + fn->name + "(";
    for (size_t i = 0; i < fn->params.size(); i++) {
        if (i > 0) s += ", ";
        if (fn->params[i].type == TypeKind::Tuple) {
            s += tuple_name(fn->params[i].tuple_members) + " " + fn->params[i].name;
        } else {
            s += type_to_c(fn->params[i].type) + " " + fn->params[i].name;
        }
    }
    s += ")";
    return s;
}

void CodeGen::emit_line_directive(int line, const std::string& file) {
    out_ << "#line " << line << " \"" << file << "\"\n";
}

TypeKind CodeGen::get_expr_type(Expression* expr) {
    return expr->resolved_type;
}

static std::string mangle_type_name(const TypeDesc& d) {
    if (d.type == TypeKind::Array)
        return "arr_of_" + type_to_string(d.element_type);
    return type_to_string(d.type);
}

std::string CodeGen::tuple_name(const std::vector<TypeDesc>& members) {
    auto it = tuple_types_.find(members);
    if (it != tuple_types_.end()) return it->second;
    std::string name = "sd_tuple";
    for (auto& m : members) {
        name += "_" + mangle_type_name(m);
    }
    tuple_types_[members] = name;
    return name;
}

void CodeGen::collect_tuple_types(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple && !var->tuple_members.empty()) {
            tuple_name(var->tuple_members);
        }
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        if (!td->tuple_members.empty()) tuple_name(td->tuple_members);
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        if (!ma->tuple_members.empty()) tuple_name(ma->tuple_members);
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        for (auto& p : fn->params) {
            if (p.type == TypeKind::Tuple && !p.tuple_members.empty()) tuple_name(p.tuple_members);
        }
        if (fn->return_type == TypeKind::Tuple && !fn->return_tuple_members.empty()) {
            tuple_name(fn->return_tuple_members);
        }
        for (auto& s : fn->body) collect_tuple_types(s.get());
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        for (auto& s : loop->body) collect_tuple_types(s.get());
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        for (auto& s : w->body) collect_tuple_types(s.get());
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        collect_tuple_types(f->init.get());
        collect_tuple_types(f->update.get());
        for (auto& s : f->body) collect_tuple_types(s.get());
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        for (auto& s : dw->body) collect_tuple_types(s.get());
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        for (auto& s : ifs->then_body) collect_tuple_types(s.get());
        for (auto& s : ifs->else_body) collect_tuple_types(s.get());
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        for (auto& c : sw->cases) for (auto& s : c.body) collect_tuple_types(s.get());
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        if (ret->values.size() > 1 && !ret->return_tuple_members.empty()) {
            tuple_name(ret->return_tuple_members);
        }
    }
}

void CodeGen::emit_expr(Expression* expr, bool parenthesize) {
    if (auto* num = dynamic_cast<NumberLiteral*>(expr)) {
        out_ << num->value;
    } else if (auto* dec = dynamic_cast<DecimalLiteral*>(expr)) {
        out_ << dec->value;
    } else if (auto* str = dynamic_cast<StringLiteral*>(expr)) {
        out_ << "\"" << str->value << "\"";
    } else if (auto* ch = dynamic_cast<CharLiteral*>(expr)) {
        out_ << "'";
        if (ch->value == '\\' || ch->value == '\'') out_ << '\\';
        out_ << ch->value << "'";
    } else if (auto* bl = dynamic_cast<BoolLiteral*>(expr)) {
        out_ << (bl->value ? "1" : "0");
    } else if (auto* id = dynamic_cast<Identifier*>(expr)) {
        out_ << id->name;
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "length") {
            if (get_expr_type(call->args[0].get()) == TypeKind::Array) {
                emit_expr(call->args[0].get());
                out_ << ".length";
            } else {
                out_ << "(int)strlen(";
                emit_expr(call->args[0].get());
                out_ << ")";
            }
        } else if (call->name == "substring") {
            out_ << "sd_substring(";
            for (size_t i = 0; i < call->args.size(); i++) {
                if (i > 0) out_ << ", ";
                emit_expr(call->args[i].get());
            }
            out_ << ")";
        } else {
            out_ << call->name << "(";
            for (size_t i = 0; i < call->args.size(); i++) {
                if (i > 0) out_ << ", ";
                emit_expr(call->args[i].get());
            }
            out_ << ")";
        }
    } else if (auto* not_expr = dynamic_cast<NotExpr*>(expr)) {
        out_ << "!(";
        emit_expr(not_expr->operand.get());
        out_ << ")";
    } else if (auto* neg = dynamic_cast<NegExpr*>(expr)) {
        out_ << "-(";
        emit_expr(neg->operand.get());
        out_ << ")";
    } else if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        if (arr->elements.empty()) {
            out_ << "sd_make_array(0, 0, 0)";
        } else {
            out_ << "sd_make_array((" << type_to_c(arr->element_type) << "[]){";
            for (size_t i = 0; i < arr->elements.size(); i++) {
                if (i > 0) out_ << ", ";
                emit_expr(arr->elements[i].get());
            }
            out_ << "}, sizeof(" << type_to_c(arr->element_type) << ") * "
                 << arr->elements.size() << ", " << arr->elements.size() << ")";
        }
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->is_tuple) {
            out_ << idx->name << ".f" << idx->member_index;
        } else {
            out_ << "((" << type_to_c(idx->element_type) << "*)" << idx->name << ".data)";
            out_ << "[sd_check_index(" << idx->name << ".length, ";
            emit_expr(idx->index.get());
            out_ << ")]";
        }
    } else if (auto* conditional = dynamic_cast<ConditionalExpr*>(expr)) {
        out_ << "(";
        emit_expr(conditional->condition.get());
        out_ << " ? ";
        emit_expr(conditional->then_expr.get());
        out_ << " : ";
        emit_expr(conditional->else_expr.get());
        out_ << ")";
    } else if (auto* cast = dynamic_cast<CastExpr*>(expr)) {
        out_ << "(" << type_to_c(cast->target_type) << ")(";
        emit_expr(cast->operand.get());
        out_ << ")";
    } else if (auto* bin = dynamic_cast<BinaryExpr*>(expr)) {
        if (bin->kind == ExprKind::Arithmetic && bin->op == "+" &&
            get_expr_type(bin->left.get()) == TypeKind::Text) {
            out_ << "sd_concat(";
            emit_expr(bin->left.get());
            out_ << ", ";
            emit_expr(bin->right.get());
            out_ << ")";
        } else if (bin->kind == ExprKind::Comparison &&
            get_expr_type(bin->left.get()) == TypeKind::Text) {
            out_ << "(";
            out_ << "strcmp(";
            emit_expr(bin->left.get());
            out_ << ", ";
            emit_expr(bin->right.get());
            out_ << ")";
            out_ << (bin->op == "!=" ? " != 0" : " == 0");
            out_ << ")";
        } else {
            if (parenthesize) out_ << "(";
            emit_expr(bin->left.get());
            out_ << " " << bin->op << " ";
            emit_expr(bin->right.get());
            if (parenthesize) out_ << ")";
        }
    }
}

void CodeGen::emit_stmt(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        emit_line_directive(var->line, source_file_);
        out_ << "    " << (var->is_mutable ? "" : "const ");
        if (var->annotation == TypeKind::Tuple) {
            out_ << tuple_name(var->tuple_members);
        } else {
            out_ << type_to_c(var->annotation);
        }
        out_ << " " << var->name << " = ";
        emit_expr(var->initializer.get());
        out_ << ";\n";
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        emit_line_directive(assign->line, source_file_);
        out_ << "    " << assign->name;
        if (assign->op == "++" || assign->op == "--") {
            out_ << assign->op << ";\n";
        } else {
            out_ << " " << assign->op << " ";
            emit_expr(assign->rhs.get());
            out_ << ";\n";
        }
    } else if (auto* aa = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        emit_line_directive(aa->line, source_file_);
        TypeKind elem_type = get_expr_type(aa->rhs.get());
        out_ << "    ((" << type_to_c(elem_type) << "*)" << aa->name << ".data)";
        out_ << "[sd_check_index(" << aa->name << ".length, ";
        emit_expr(aa->index.get());
        out_ << ")] = ";
        emit_expr(aa->rhs.get());
        out_ << ";\n";
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        emit_line_directive(td->line, source_file_);
        std::string tname = tuple_name(td->tuple_members);
        std::string tmp = "__sd_d" + std::to_string(temp_counter_++);
        out_ << "    " << tname << " " << tmp << " = ";
        emit_expr(td->rhs.get());
        out_ << ";\n";
        for (size_t i = 0; i < td->names.size(); i++) {
            out_ << "    " << type_to_c(td->tuple_members[i].type) << " " << td->names[i]
                 << " = " << tmp << ".f" << i << ";\n";
        }
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        emit_line_directive(ma->line, source_file_);
        std::string tname = tuple_name(ma->tuple_members);
        std::string tmp = "__sd_m" + std::to_string(temp_counter_++);
        out_ << "    " << tname << " " << tmp << " = ";
        emit_expr(ma->rhs.get());
        out_ << ";\n";
        for (size_t i = 0; i < ma->names.size(); i++) {
            out_ << "    " << ma->names[i] << " = " << tmp << ".f" << i << ";\n";
        }
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        emit_line_directive(print->line, source_file_);
        TypeKind etype = get_expr_type(print->expr.get());
        out_ << "    printf(\"" << type_to_format(etype) << "\\n\", ";
        emit_expr(print->expr.get(), etype == TypeKind::Text);
        out_ << ");\n";
    } else if (auto* expr_stmt = dynamic_cast<ExprStmt*>(stmt)) {
        emit_line_directive(expr_stmt->line, source_file_);
        out_ << "    ";
        emit_expr(expr_stmt->expr.get());
        out_ << ";\n";
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        emit_line_directive(loop->line, source_file_);
        out_ << "    for (int _i = 0; _i < ";
        emit_expr(loop->count.get());
        out_ << "; _i++) {\n";
        for (auto& body_stmt : loop->body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "    }\n";
    } else if (auto* while_stmt = dynamic_cast<WhileStmt*>(stmt)) {
        emit_line_directive(while_stmt->line, source_file_);
        out_ << "    while (";
        emit_expr(while_stmt->condition.get());
        out_ << ") {\n";
        for (auto& body_stmt : while_stmt->body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "    }\n";
    } else if (auto* for_stmt = dynamic_cast<ForStmt*>(stmt)) {
        emit_line_directive(for_stmt->line, source_file_);
        out_ << "    for (";
        emit_for_component(for_stmt->init.get());
        out_ << "; ";
        emit_expr(for_stmt->condition.get());
        out_ << "; ";
        emit_for_component(for_stmt->update.get());
        out_ << ") {\n";
        for (auto& body_stmt : for_stmt->body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "    }\n";
    } else if (auto* do_while = dynamic_cast<DoWhileStmt*>(stmt)) {
        emit_line_directive(do_while->line, source_file_);
        out_ << "    do {\n";
        for (auto& body_stmt : do_while->body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "    } while (";
        emit_expr(do_while->condition.get());
        out_ << ");\n";
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        emit_line_directive(ret->line, source_file_);
        if (ret->values.size() > 1) {
            out_ << "    return (" << tuple_name(ret->return_tuple_members) << "){ ";
            for (size_t i = 0; i < ret->values.size(); i++) {
                if (i > 0) out_ << ", ";
                emit_expr(ret->values[i].get());
            }
            out_ << " };\n";
        } else if (ret->values.size() == 1) {
            out_ << "    return ";
            emit_expr(ret->values[0].get());
            out_ << ";\n";
        } else {
            out_ << "    return;\n";
        }
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        emit_line_directive(ifs->line, source_file_);
        out_ << "    if (";
        emit_expr(ifs->condition.get());
        out_ << ") {\n";
        for (auto& body_stmt : ifs->then_body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "    }";
        if (ifs->has_else) {
            out_ << " else {\n";
            for (auto& body_stmt : ifs->else_body) {
                emit_stmt(body_stmt.get());
            }
            out_ << "    }";
        }
        out_ << "\n";
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        emit_line_directive(sw->line, source_file_);
        out_ << "    switch (";
        emit_expr(sw->value.get());
        out_ << ") {\n";
        for (auto& c : sw->cases) {
            out_ << "    ";
            if (c.is_default) {
                out_ << "default:\n";
            } else {
                out_ << "case ";
                emit_expr(c.value.get());
                out_ << ":\n";
            }
            for (auto& body_stmt : c.body) {
                emit_stmt(body_stmt.get());
            }
            out_ << "        break;\n";
        }
        out_ << "    }\n";
    } else if (auto* brk = dynamic_cast<BreakStmt*>(stmt)) {
        emit_line_directive(brk->line, source_file_);
        out_ << "    break;\n";
    } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
        emit_line_directive(cont->line, source_file_);
        out_ << "    continue;\n";
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        emit_line_directive(fn->line, source_file_);
        out_ << emit_function_signature(fn) << " {\n";
        for (auto& body_stmt : fn->body) {
            emit_stmt(body_stmt.get());
        }
        out_ << "}\n\n";
    }
}

void CodeGen::emit_for_component(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple) {
            out_ << tuple_name(var->tuple_members);
        } else {
            out_ << type_to_c(var->annotation);
        }
        out_ << " " << var->name << " = ";
        emit_expr(var->initializer.get());
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        out_ << assign->name;
        if (assign->op == "++" || assign->op == "--") {
            out_ << assign->op;
        } else {
            out_ << " " << assign->op << " ";
            emit_expr(assign->rhs.get());
        }
    }
}
