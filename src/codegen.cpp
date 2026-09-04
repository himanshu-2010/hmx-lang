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
        s += type_to_c(fn->return_type);
    } else {
        s += "void";
    }
    s += " " + fn->name + "(";
    for (size_t i = 0; i < fn->params.size(); i++) {
        if (i > 0) s += ", ";
        s += type_to_c(fn->params[i].type) + " " + fn->params[i].name;
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

void CodeGen::emit_expr(Expression* expr, bool parenthesize) {
    if (auto* num = dynamic_cast<NumberLiteral*>(expr)) {
        out_ << num->value;
    } else if (auto* dec = dynamic_cast<DecimalLiteral*>(expr)) {
        out_ << dec->value;
    } else if (auto* str = dynamic_cast<StringLiteral*>(expr)) {
        out_ << "\"" << str->value << "\"";
    } else if (auto* bl = dynamic_cast<BoolLiteral*>(expr)) {
        out_ << (bl->value ? "1" : "0");
    } else if (auto* id = dynamic_cast<Identifier*>(expr)) {
        out_ << id->name;
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        out_ << call->name << "(";
        for (size_t i = 0; i < call->args.size(); i++) {
            if (i > 0) out_ << ", ";
            emit_expr(call->args[i].get());
        }
        out_ << ")";
    } else if (auto* not_expr = dynamic_cast<NotExpr*>(expr)) {
        out_ << "!(";
        emit_expr(not_expr->operand.get());
        out_ << ")";
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
        out_ << "    " << (var->is_mutable ? "" : "const ")
             << type_to_c(var->annotation) << " " << var->name << " = ";
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
        if (ret->value) {
            out_ << "    return ";
            emit_expr(ret->value.get());
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
        out_ << type_to_c(var->annotation) << " " << var->name << " = ";
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
