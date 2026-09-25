#include "codegen.hpp"

#include <set>

static TypeDesc codegen_param_desc(const FunctionDecl::Param& p) {
    if (p.desc.type != TypeKind::Unknown) return p.desc;
    TypeDesc d;
    d.type = p.type;
    d.elem = p.elem_desc.elem;
    d.tuple_members = p.tuple_members;
    return d;
}

std::string CodeGen::generate(Program& program, const std::string& source_file) {
    source_file_ = source_file;
    line_file_ = source_file;
    TypeResolver resolver;
    resolver.resolve(program);

    out_ << "#include <stdio.h>\n";
    out_ << "#include <stdlib.h>\n";
    out_ << "#include <string.h>\n";
    out_ << "#include <errno.h>\n";
    out_ << "#include <limits.h>\n";
    out_ << "#include <setjmp.h>\n\n";

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

    out_ << "static char* sd_read_line(void) {\n";
    out_ << "    char* line = NULL;\n";
    out_ << "    size_t cap = 0;\n";
    out_ << "    ssize_t n = getline(&line, &cap, stdin);\n";
    out_ << "    if (n < 0) {\n";
    out_ << "        free(line);\n";
    out_ << "        char* empty = malloc(1);\n";
    out_ << "        if (!empty) exit(1);\n";
    out_ << "        empty[0] = '\\0';\n";
    out_ << "        return empty;\n";
    out_ << "    }\n";
    out_ << "    while (n > 0 && (line[n-1] == '\\n' || line[n-1] == '\\r')) {\n";
    out_ << "        line[--n] = '\\0';\n";
    out_ << "    }\n";
    out_ << "    return line;\n";
    out_ << "}\n\n";

    out_ << "static char* sd_to_str_int(int v) {\n";
    out_ << "    char* buf = malloc(32);\n";
    out_ << "    if (!buf) exit(1);\n";
    out_ << "    snprintf(buf, 32, \"%d\", v);\n";
    out_ << "    return buf;\n";
    out_ << "}\n\n";

    out_ << "static char* sd_to_str_decimal(double v) {\n";
    out_ << "    char* buf = malloc(64);\n";
    out_ << "    if (!buf) exit(1);\n";
    out_ << "    snprintf(buf, 64, \"%f\", v);\n";
    out_ << "    return buf;\n";
    out_ << "}\n\n";

    out_ << "static char* sd_to_str_char(char c) {\n";
    out_ << "    char* buf = malloc(2);\n";
    out_ << "    if (!buf) exit(1);\n";
    out_ << "    buf[0] = c;\n";
    out_ << "    buf[1] = '\\0';\n";
    out_ << "    return buf;\n";
    out_ << "}\n\n";

    out_ << "static int sd_parse_int(const char* s) {\n";
    out_ << "    char* end = NULL;\n";
    out_ << "    errno = 0;\n";
    out_ << "    long v = strtol(s, &end, 10);\n";
    out_ << "    if (end == s || *end != '\\0' || errno == ERANGE ||\n";
    out_ << "        v < INT_MIN || v > INT_MAX) {\n";
    out_ << "        fprintf(stderr, \"Error: parse_int: invalid int '%s'\\n\", s);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return (int)v;\n";
    out_ << "}\n\n";

    out_ << "static double sd_parse_decimal(const char* s) {\n";
    out_ << "    char* end = NULL;\n";
    out_ << "    errno = 0;\n";
    out_ << "    double v = strtod(s, &end);\n";
    out_ << "    if (end == s || *end != '\\0' || errno == ERANGE) {\n";
    out_ << "        fprintf(stderr, \"Error: parse_decimal: invalid decimal '%s'\\n\", s);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return v;\n";
    out_ << "}\n\n";

    out_ << "typedef struct sd_array {\n";
    out_ << "    void* data;\n";
    out_ << "    int length;\n";
    out_ << "    int capacity;\n";
    out_ << "    int esize;\n";
    out_ << "} sd_array;\n\n";

    out_ << "static sd_array* sd_make_array(const void* data, size_t nbytes, int length, size_t esize) {\n";
    out_ << "    size_t el = esize ? esize : 1;\n";
    out_ << "    sd_array* a = malloc(sizeof(sd_array));\n";
    out_ << "    if (!a) exit(1);\n";
    out_ << "    a->esize = (int)el;\n";
    out_ << "    a->length = length;\n";
    out_ << "    a->capacity = length + 16;\n";
    out_ << "    a->data = malloc(nbytes ? nbytes : el);\n";
    out_ << "    if (!a->data) exit(1);\n";
    out_ << "    if (nbytes) memcpy(a->data, data, nbytes);\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_push(sd_array* a, const void* item, size_t esize) {\n";
    out_ << "    if (a->length >= a->capacity) {\n";
    out_ << "        a->capacity = a->capacity * 2 + 8;\n";
    out_ << "        a->data = realloc(a->data, (size_t)a->capacity * (size_t)a->esize);\n";
    out_ << "        if (!a->data) exit(1);\n";
    out_ << "    }\n";
    out_ << "    memcpy((char*)a->data + (size_t)a->length * (size_t)a->esize, item, esize);\n";
    out_ << "    a->length++;\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_ensure_capacity(sd_array* a, int extra) {\n";
    out_ << "    if (a->length + extra > a->capacity) {\n";
    out_ << "        while (a->length + extra > a->capacity) a->capacity = a->capacity * 2 + 8;\n";
    out_ << "        a->data = realloc(a->data, (size_t)a->capacity * (size_t)a->esize);\n";
    out_ << "        if (!a->data) exit(1);\n";
    out_ << "    }\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_array_slice(sd_array* a, int start, int end) {\n";
    out_ << "    if (start < 0 || end < start || end > a->length) { fprintf(stderr, \"Error: slice out of bounds (%d, %d)\\n\", start, end); exit(1); }\n";
    out_ << "    return sd_make_array((char*)a->data + (size_t)start * (size_t)a->esize, (size_t)(end - start) * (size_t)a->esize, end - start, (size_t)a->esize);\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_split(const char* s, const char* sep) {\n";
    out_ << "    size_t pl = strlen(sep ? sep : \"\");\n";
    out_ << "    if (pl == 0) { fprintf(stderr, \"Error: split separator must not be empty\\n\"); exit(1); }\n";
    out_ << "    sd_array* a = malloc(sizeof(sd_array));\n";
    out_ << "    if (!a) exit(1);\n";
    out_ << "    a->esize = (int)sizeof(char*);\n";
    out_ << "    a->length = 0;\n";
    out_ << "    a->capacity = 4;\n";
    out_ << "    a->data = malloc(a->capacity * sizeof(char*));\n";
    out_ << "    if (!a->data) exit(1);\n";
    out_ << "    const char* cur = s;\n";
    out_ << "    for (;;) {\n";
    out_ << "        const char* hit = strstr(cur, sep);\n";
    out_ << "        size_t len = hit ? (size_t)(hit - cur) : strlen(cur);\n";
    out_ << "        char* piece = malloc(len + 1);\n";
    out_ << "        if (!piece) exit(1);\n";
    out_ << "        memcpy(piece, cur, len);\n";
    out_ << "        piece[len] = '\\0';\n";
    out_ << "        if (a->length >= a->capacity) {\n";
    out_ << "            a->capacity *= 2;\n";
    out_ << "            a->data = realloc(a->data, a->capacity * sizeof(char*));\n";
    out_ << "            if (!a->data) exit(1);\n";
    out_ << "        }\n";
    out_ << "        ((char**)a->data)[a->length++] = piece;\n";
    out_ << "        if (!hit) break;\n";
    out_ << "        cur = hit + pl;\n";
    out_ << "    }\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static int sd_check_index(int length, int index) {\n";
    out_ << "    if (index < 0 || index >= length) {\n";
    out_ << "        fprintf(stderr, \"Error: array index out of bounds (index %d, length %d)\\n\", index, length);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return index;\n";
    out_ << "}\n\n";

    out_ << "typedef struct sd_closure {\n";
    out_ << "    void* fn;\n";
    out_ << "    void* env;\n";
    out_ << "} sd_closure;\n\n";

    out_ << "static sd_closure sd_make_closure(void* fn, void* env) {\n";
    out_ << "    sd_closure c;\n";
    out_ << "    c.fn = fn;\n";
    out_ << "    c.env = env;\n";
    out_ << "    return c;\n";
    out_ << "}\n\n";

    out_ << "static void* sd_copy_env(const void* src, size_t size) {\n";
    out_ << "    void* r = malloc(size ? size : 1);\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    if (size) memcpy(r, src, size);\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    for (auto& stmt : program.statements) collect_tuple_types(stmt.get());

    std::vector<Statement*> top_level;

    for (auto& stmt : program.statements) {
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
            all_functions_.push_back(fn);
            for (auto& body_stmt : fn->body) collect_function_decls(body_stmt.get());
        } else {
            top_level.push_back(stmt.get());
        }
    }

    for (auto* fn : all_functions_) {
        for (auto& p : fn->params) register_desc_types(p.desc);
        register_desc_types(fn->return_desc);
        for (auto& c : fn->captures) register_desc_types(c.desc);
    }

    emit_pending_tuple_types();

    for (auto* fn : all_functions_) {
        if (fn->name != "main" && !fn->captures.empty()) {
            out_ << "typedef struct sd_env_" << fn->name << " {\n";
            for (auto& c : fn->captures) {
                out_ << "    " << c_type_for_desc(c.desc) << " " << c.name << ";\n";
            }
            out_ << "} sd_env_" << fn->name << ";\n\n";
        }
    }

    for (auto* fn : all_functions_) {
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
    for (auto* fn : all_functions_) {
        functions_by_name_[fn->name] = fn;
        if (fn->name == "main") main_fn = fn;
    }
    if (main_fn) {
        current_fn_ = main_fn;
        line_file_ = fn_file(main_fn);
        for (auto& body_stmt : main_fn->body) {
            emit_stmt(body_stmt.get());
        }
        current_fn_ = nullptr;
        line_file_ = source_file_;
    }

    if (!main_fn || !main_fn->has_return_type) {
        out_ << "    return 0;\n";
    }
    out_ << "}\n\n";

    for (auto* fn : all_functions_) {
        if (fn->name != "main") {
            current_fn_ = fn;
            line_file_ = fn_file(fn);
            out_ << emit_function_signature(fn) << " {\n";
            for (auto& body_stmt : fn->body) {
                emit_stmt(body_stmt.get());
            }
            out_ << "}\n\n";
        }
    }
    current_fn_ = nullptr;
    line_file_ = source_file_;
    return out_.str();
}

void CodeGen::collect_function_decls(Statement* stmt) {
    auto recurse = [this](const std::vector<StmtPtr>& list) {
        for (auto& s : list) collect_function_decls(s.get());
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        all_functions_.push_back(fn);
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

std::string CodeGen::emit_function_signature(FunctionDecl* fn) {
    std::string s;
    if (fn->has_return_type) {
        if (fn->return_type == TypeKind::Tuple) {
            s += tuple_name(fn->return_tuple_members);
        } else if (fn->return_type == TypeKind::Array) {
            s += c_type_for_desc(fn->return_desc);
        } else {
            s += type_to_c(fn->return_type);
        }
    } else {
        s += "void";
    }
    s += " " + fn->name + "(";
    if (fn->name != "main") s += "void* _sd_env";
    if (fn->name != "main" && fn->has_nonlocal) s += ", void* _sd_nl";
    for (size_t i = 0; i < fn->params.size(); i++) {
        if (i > 0 || fn->name != "main") s += ", ";
        s += c_type_for_desc(codegen_param_desc(fn->params[i])) + " " + fn->params[i].name;
    }
    s += ")";
    return s;
}

std::string CodeGen::c_type_for_desc(const TypeDesc& d) {
    if (d.type == TypeKind::Array) return "sd_array*";
    if (d.type == TypeKind::Tuple) return tuple_name(d.tuple_members);
    if (d.type == TypeKind::Function) return "sd_closure";
    return type_to_c(d.type);
}

void CodeGen::register_desc_types(const TypeDesc& d) {
    if (d.type == TypeKind::Tuple) {
        register_tuple_types_deep(d);
    }
    if (d.type == TypeKind::Function && d.fn_info) {
        for (auto& p : d.fn_info->params) register_desc_types(p);
        register_desc_types(d.fn_info->ret);
    }
}

bool CodeGen::is_capture(const FunctionDecl* fn, const std::string& name) const {
    if (!fn) return false;
    for (auto& c : fn->captures) {
        if (c.name == name) return true;
    }
    return false;
}

void CodeGen::emit_env_arg(const FunctionDecl* callee) {
    if (callee->name == "main" || callee->captures.empty()) {
        out_ << "((void*)0)";
        return;
    }
    out_ << "(void*)&(sd_env_" << callee->name << "){";
    for (size_t i = 0; i < callee->captures.size(); i++) {
        if (i > 0) out_ << ", ";
        emit_identifier_value(callee->captures[i].name);
    }
    out_ << "}";
}

void CodeGen::emit_env_heap_arg(const FunctionDecl* callee) {
    if (callee->name == "main" || callee->captures.empty()) {
        out_ << "((void*)0)";
        return;
    }
    out_ << "sd_copy_env(&(sd_env_" << callee->name << "){";
    for (size_t i = 0; i < callee->captures.size(); i++) {
        if (i > 0) out_ << ", ";
        emit_identifier_value(callee->captures[i].name);
    }
    out_ << "}, sizeof(sd_env_" << callee->name << "))";
}

void CodeGen::emit_identifier_value(const std::string& name) {
    if (current_fn_ && is_capture(current_fn_, name)) {
        out_ << "((sd_env_" << current_fn_->name << "*) _sd_env)->" << name;
    } else {
        out_ << name;
    }
}

void CodeGen::emit_line_directive(int line, const std::string& file) {
    out_ << "#line " << line << " \"" << file << "\"\n";
}

TypeKind CodeGen::get_expr_type(Expression* expr) {
    return expr->resolved_type;
}

static std::string mangle_type_name(const TypeDesc& d) {
    if (d.type == TypeKind::Array)
        return "arr_of_" + mangle_type_name(d.element());
    if (d.type == TypeKind::Tuple) {
        std::string s = "tup";
        for (auto& m : d.tuple_members) s += "_" + mangle_type_name(m);
        return s;
    }
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

void CodeGen::register_tuple_types_deep(const TypeDesc& d) {
    if (d.type == TypeKind::Tuple) {
        tuple_name(d.tuple_members);
        for (auto& m : d.tuple_members) register_tuple_types_deep(m);
    } else if (d.type == TypeKind::Array) {
        register_tuple_types_deep(d.element());
    } else if (d.type == TypeKind::Function && d.fn_info) {
        for (auto& p : d.fn_info->params) register_tuple_types_deep(p);
        register_tuple_types_deep(d.fn_info->ret);
    }
}

void CodeGen::emit_pending_tuple_types() {
    std::set<std::vector<TypeDesc>> emitted;
    bool progress = true;
    while (progress) {
        progress = false;
        std::vector<std::pair<std::vector<TypeDesc>, std::string>> pending;
        for (auto& [members, name] : tuple_types_) {
            if (!emitted.count(members)) pending.push_back({members, name});
        }
        for (auto& [members, name] : pending) {
            if (emitted.count(members)) continue;
            bool ready = true;
            for (auto& m : members) {
                if (m.type == TypeKind::Tuple && !emitted.count(m.tuple_members)) {
                    ready = false;
                    break;
                }
            }
            if (!ready) continue;
            out_ << "typedef struct " << name << " {\n";
            for (size_t i = 0; i < members.size(); i++) {
                out_ << "    " << c_type_for_desc(members[i]) << " f" << i << ";\n";
            }
            out_ << "} " << name << ";\n\n";
            emitted.insert(members);
            progress = true;
        }
    }
}

void CodeGen::collect_tuple_types(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple && !var->tuple_members.empty()) {
            TypeDesc d{TypeKind::Tuple, {}, var->tuple_members, {}};
            register_tuple_types_deep(d);
        }
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        for (auto& p : td->patterns) register_tuple_types_deep(p.vdesc);
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        for (auto& p : ma->patterns) register_tuple_types_deep(p.vdesc);
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        for (auto& p : fn->params) {
            if (p.type == TypeKind::Tuple && !p.tuple_members.empty()) {
                TypeDesc d{TypeKind::Tuple, {}, p.tuple_members, {}};
                register_tuple_types_deep(d);
            }
        }
        if (fn->return_type == TypeKind::Tuple && !fn->return_tuple_members.empty()) {
            TypeDesc d{TypeKind::Tuple, {}, fn->return_tuple_members, {}};
            register_tuple_types_deep(d);
        }
        for (auto& s : fn->body) collect_tuple_types(s.get());
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        for (auto& s : loop->body) collect_tuple_types(s.get());
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        for (auto& s : fe->body) collect_tuple_types(s.get());
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
            TypeDesc d{TypeKind::Tuple, {}, ret->return_tuple_members, {}};
            register_tuple_types_deep(d);
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
        if (id->is_function_reference) {
            auto it = functions_by_name_.find(id->name);
            if (it != functions_by_name_.end()) {
                out_ << "sd_make_closure((void*)" << id->name << ", ";
                emit_env_heap_arg(it->second);
                out_ << ")";
            } else {
                throw std::runtime_error("internal error: unknown function reference '" + id->name + "'");
            }
        } else {
            emit_identifier_value(id->name);
        }
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "length") {
            if (get_expr_type(call->args[0].get()) == TypeKind::Array) {
                emit_expr(call->args[0].get());
                out_ << "->length";
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
        } else if (call->name == "ord") {
            out_ << "((int)(unsigned char)(";
            emit_expr(call->args[0].get());
            out_ << "))";
        } else if (call->name == "chr") {
            out_ << "({ int _sd_c = (";
            emit_expr(call->args[0].get());
            out_ << "); if (_sd_c < 0 || _sd_c > 255) { fprintf(stderr, \"Error: chr expects a character code between 0 and 255, got %d\\n\", _sd_c); exit(1); } (char)_sd_c; })";
        } else if (call->name == "split") {
            out_ << "sd_split((";
            emit_expr(call->args[0].get());
            out_ << "), (";
            emit_expr(call->args[1].get());
            out_ << "))";
        } else if (call->name == "push") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ " << T << " _sd_v = (";
            emit_expr(call->args[1].get());
            out_ << "); sd_push((";
            emit_expr(call->args[0].get());
            out_ << "), &_sd_v, sizeof(" << T << ")); })";
        } else if (call->name == "pop") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ sd_array* _sd_p = (";
            emit_expr(call->args[0].get());
            out_ << "); if (_sd_p->length == 0) { fprintf(stderr, \"Error: pop on empty array\\n\"); exit(1); } --_sd_p->length; "
                 << T << " _sd_v = *((" << T << "*)((char*)_sd_p->data + (size_t)_sd_p->length * sizeof(" << T << "))); _sd_v; })";
        } else if (call->name == "sort") {
            std::string T = c_type_for_desc(call->array_aux);
            bool is_text = call->array_aux.type == TypeKind::Text;
            out_ << "({ sd_array* _sd_a = (";
            emit_expr(call->args[0].get());
            out_ << "); for (int _sd_i = 1; _sd_i < _sd_a->length; _sd_i++) { for (int _sd_j = _sd_i; _sd_j > 0; _sd_j--) { ";
            if (is_text) {
                out_ << "int _sd_c = strcmp(((" << T << "*)_sd_a->data)[_sd_j - 1], ((" << T << "*)_sd_a->data)[_sd_j]); ";
            } else {
                out_ << "int _sd_c = ((" << T << "*)_sd_a->data)[_sd_j - 1] > ((" << T << "*)_sd_a->data)[_sd_j]; ";
            }
            out_ << "if (_sd_c <= 0) break; " << T << " _sd_w = ((" << T << "*)_sd_a->data)[_sd_j]; "
                 << "((" << T << "*)_sd_a->data)[_sd_j] = ((" << T << "*)_sd_a->data)[_sd_j - 1]; "
                 << "((" << T << "*)_sd_a->data)[_sd_j - 1] = _sd_w; } } })";
        } else if (call->name == "slice") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ sd_array* _sd_s = (";
            emit_expr(call->args[0].get());
            out_ << "); int _sd_a = (";
            emit_expr(call->args[1].get());
            out_ << "); int _sd_b = (";
            emit_expr(call->args[2].get());
            out_ << "); if (_sd_a < 0 || _sd_b > _sd_s->length || _sd_a > _sd_b) { fprintf(stderr, \"Error: slice out of bounds (%d, %d)\\n\", _sd_a, _sd_b); exit(1); } sd_make_array((char*)_sd_s->data + (size_t)_sd_a * sizeof(" << T << "), (size_t)(_sd_b - _sd_a) * sizeof(" << T << "), _sd_b - _sd_a, sizeof(" << T << ")); })";
        } else if (call->name == "concat") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ sd_array* _sd_x = (";
            emit_expr(call->args[0].get());
            out_ << "); sd_array* _sd_y = (";
            emit_expr(call->args[1].get());
            out_ << "); sd_array* _sd_c = sd_make_array(0, 0, 0, sizeof(" << T << ")); "
                 << "size_t _sd_n = (size_t)_sd_x->length * sizeof(" << T << ") + (size_t)_sd_y->length * sizeof(" << T << "); "
                 << "_sd_c->data = malloc(_sd_n ? _sd_n : 1); if (!_sd_c->data) exit(1); "
                 << "_sd_c->length = _sd_x->length + _sd_y->length; _sd_c->capacity = _sd_c->length + 16; "
                 << "if (_sd_x->length) memcpy(_sd_c->data, _sd_x->data, (size_t)_sd_x->length * sizeof(" << T << ")); "
                 << "if (_sd_y->length) memcpy((char*)_sd_c->data + (size_t)_sd_x->length * sizeof(" << T << "), _sd_y->data, (size_t)_sd_y->length * sizeof(" << T << ")); _sd_c; })";
        } else if (call->name == "index_of" || call->name == "contains") {
            std::string T = c_type_for_desc(call->array_aux);
            bool is_text = call->array_aux.type == TypeKind::Text;
            out_ << "({ " << T << " _sd_v = (";
            emit_expr(call->args[1].get());
            out_ << "); sd_array* _sd_a = (";
            emit_expr(call->args[0].get());
            out_ << "); int _sd_r = " << (call->name == "index_of" ? "-1" : "0") << "; "
                 << "for (int _sd_i = 0; _sd_i < _sd_a->length; _sd_i++) { ";
            if (is_text) {
                out_ << "int _sd_f = strcmp(((" << T << "*)_sd_a->data)[_sd_i], _sd_v) == 0; ";
            } else {
                out_ << "int _sd_f = ((" << T << "*)_sd_a->data)[_sd_i] == _sd_v; ";
            }
            if (call->name == "index_of") {
                out_ << "if (_sd_f) { _sd_r = _sd_i; break; } } _sd_r; })";
            } else {
                out_ << "if (_sd_f) { _sd_r = 1; break; } } _sd_r; })";
            }
        } else if (call->name == "input") {
            out_ << "sd_read_line()";
        } else if (call->name == "tostr") {
            TypeKind at = get_expr_type(call->args[0].get());
            if (at == TypeKind::Text) {
                emit_expr(call->args[0].get());
            } else if (at == TypeKind::Decimal) {
                out_ << "sd_to_str_decimal(";
                emit_expr(call->args[0].get());
                out_ << ")";
            } else if (at == TypeKind::Char) {
                out_ << "sd_to_str_char(";
                emit_expr(call->args[0].get());
                out_ << ")";
            } else {
                out_ << "sd_to_str_int(";
                emit_expr(call->args[0].get());
                out_ << ")";
            }
        } else if (call->name == "parse_int") {
            out_ << "sd_parse_int(";
            emit_expr(call->args[0].get());
            out_ << ")";
        } else if (call->name == "parse_decimal") {
            out_ << "sd_parse_decimal(";
            emit_expr(call->args[0].get());
            out_ << ")";
        } else if (call->is_function_value_call) {
            const FunctionTypeInfo& info = *call->fn_type.fn_info;
            out_ << "((" << c_type_for_desc(info.ret) << " (*)(void*";
            for (size_t i = 0; i < info.params.size(); i++) {
                out_ << ", " << c_type_for_desc(info.params[i]);
            }
            out_ << "))";
            emit_identifier_value(call->name);
            out_ << ".fn)(";
            emit_identifier_value(call->name);
            out_ << ".env";
            for (size_t i = 0; i < call->args.size(); i++) {
                out_ << ", ";
                emit_expr(call->args[i].get());
            }
            out_ << ")";
        } else {
            auto it = functions_by_name_.find(call->name);
            if (it != functions_by_name_.end()) {
                const FunctionDecl* callee = it->second;
                size_t variadic_index = (size_t)-1;
                for (size_t i = 0; i < callee->params.size(); i++) {
                    if (callee->params[i].variadic) { variadic_index = i; break; }
                }
                size_t fixed = (variadic_index == (size_t)-1) ? callee->params.size() : variadic_index;
                out_ << call->name << "(";
                emit_env_arg(callee);
                if (callee->has_nonlocal) {
                    out_ << ", (void*)_sd_nl_buf" << callee->nl_target_loop_id;
                }
                for (size_t i = 0; i < fixed; i++) {
                    out_ << ", ";
                    if (i < call->args.size()) {
                        emit_expr(call->args[i].get());
                    } else {
                        emit_expr(callee->params[i].default_value.get());
                    }
                }
                if (variadic_index != (size_t)-1) {
                    out_ << ", ";
                    if (call->args.size() > fixed) {
                        out_ << "sd_make_array(("
                             << c_type_for_desc(callee->params[variadic_index].elem_desc)
                             << "[]){";
                        for (size_t i = fixed; i < call->args.size(); i++) {
                            if (i > fixed) out_ << ", ";
                            emit_expr(call->args[i].get());
                        }
                        out_ << "}, sizeof(" << c_type_for_desc(callee->params[variadic_index].elem_desc)
                             << ") * " << (call->args.size() - fixed) << ", "
                             << (call->args.size() - fixed) << ", sizeof("
                             << c_type_for_desc(callee->params[variadic_index].elem_desc) << "))";
                    } else {
                        out_ << "sd_make_array(0, 0, 0, sizeof("
                             << c_type_for_desc(callee->params[variadic_index].elem_desc) << "))";
                    }
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
            out_ << "sd_make_array(0, 0, 0, sizeof(" << c_type_for_desc(arr->elem) << "))";
        } else {
            out_ << "sd_make_array((" << c_type_for_desc(arr->elem) << "[]){";
            for (size_t i = 0; i < arr->elements.size(); i++) {
                if (i > 0) out_ << ", ";
                emit_expr(arr->elements[i].get());
            }
            out_ << "}, sizeof(" << c_type_for_desc(arr->elem) << ") * "
                 << arr->elements.size() << ", " << arr->elements.size() << ", sizeof("
                 << c_type_for_desc(arr->elem) << "))";
        }
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->base) {
            if (idx->is_tuple) {
                emit_expr(idx->base.get());
                out_ << ".f" << idx->member_index;
            } else if (idx->is_text) {
                emit_expr(idx->base.get());
                out_ << "[sd_check_index((int)strlen(";
                emit_expr(idx->base.get());
                out_ << "), ";
                emit_expr(idx->index.get());
                out_ << ")]";
            } else {
                std::string ct = c_type_for_desc(idx->elem);
                out_ << "((" << ct << "*)";
                emit_expr(idx->base.get());
                out_ << "->data)";
                out_ << "[sd_check_index(";
                emit_expr(idx->base.get());
                out_ << "->length, ";
                emit_expr(idx->index.get());
                out_ << ")]";
            }
        } else if (idx->is_tuple) {
            emit_identifier_value(idx->name);
            out_ << ".f" << idx->member_index;
        } else if (idx->is_text) {
            emit_identifier_value(idx->name);
            out_ << "[sd_check_index((int)strlen(";
            emit_identifier_value(idx->name);
            out_ << "), ";
            emit_expr(idx->index.get());
            out_ << ")]";
        } else {
            out_ << "((" << c_type_for_desc(idx->elem) << "*)";
            emit_identifier_value(idx->name);
            out_ << "->data)";
            out_ << "[sd_check_index(";
            emit_identifier_value(idx->name);
            out_ << "->length, ";
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

void CodeGen::emit_binding(const DestructPattern& slot, const std::string& rhs,
                           const TypeDesc& vd, bool declare) {
    if (declare) {
        out_ << "    " << c_type_for_desc(vd) << " " << slot.name << " = " << rhs << ";\n";
    } else {
        out_ << "    " << slot.name << " = " << rhs << ";\n";
    }
}

void CodeGen::emit_destruct_level(const std::vector<DestructPattern>& slots,
                                  const std::string& src, const TypeDesc& val,
                                  bool declare) {
    if (val.type == TypeKind::Tuple) {
        for (size_t i = 0; i < slots.size(); i++) {
            const DestructPattern& slot = slots[i];
            const TypeDesc& member = val.tuple_members[i];
            std::string member_src = "(" + src + ").f" + std::to_string(i);
            if (slot.nested) {
                emit_destruct_level(slot.items, member_src, member, declare);
            } else {
                emit_binding(slot, member_src, member, declare);
            }
        }
        return;
    }
    if (val.type == TypeKind::Array) {
        const TypeDesc& elem = val.element();
        size_t n = 0;
        for (auto& p : slots) if (!p.is_rest) n++;
        out_ << "    if (" << src << "->length < " << n << ") { fprintf(stderr, \"Error: cannot destructure array of length %d into " << n << " targets\\n\", " << src << "->length); exit(1); }\n";
        size_t fix_i = 0;
        for (size_t i = 0; i < slots.size(); i++) {
            const DestructPattern& slot = slots[i];
            if (slot.is_rest) {
                out_ << (declare ? "    sd_array* " : "    ") << slot.name
                     << " = sd_array_slice(" << src << ", " << n << ", "
                     << src << "->length);\n";
                continue;
            }
            std::string T = c_type_for_desc(elem);
            std::string member_src = "((" + T + "*)(" + src + ")->data)[" + std::to_string(fix_i) + "]";
            if (slot.nested) {
                emit_destruct_level(slot.items, member_src, elem, declare);
            } else {
                emit_binding(slot, member_src, elem, declare);
            }
            fix_i++;
        }
        return;
    }
    // Text source: src is a char*.
    size_t n = 0;
    for (auto& p : slots) if (!p.is_rest) n++;
    std::string len_expr = "(int)strlen(" + src + ")";
    out_ << "    if (" << len_expr << " < " << n << ") { fprintf(stderr, \"Error: cannot destructure text of length %d into " << n << " targets\\n\", " << len_expr << "); exit(1); }\n";
    size_t fix_i = 0;
    TypeDesc char_desc{TypeKind::Char, {}, {}, {}};
    for (size_t i = 0; i < slots.size(); i++) {
        const DestructPattern& slot = slots[i];
        if (slot.is_rest) {
            out_ << (declare ? "    char* " : "    ") << slot.name
                 << " = sd_substring(" << src << ", " << n << ", "
                 << "(int)strlen(" << src << "));\n";
            continue;
        }
        std::string member_src = src + "[" + std::to_string(fix_i) + "]";
        emit_binding(slot, member_src, char_desc, declare);
        fix_i++;
    }
}

void CodeGen::emit_stmt(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        emit_line_directive(var->line, line_file_);
        out_ << "    " << (var->is_mutable ? "" : "const ");
        if (var->annotation == TypeKind::Tuple) {
            out_ << tuple_name(var->tuple_members);
        } else if (var->annotation == TypeKind::Array) {
            out_ << "sd_array*";
        } else {
            out_ << type_to_c(var->annotation);
        }
        out_ << " " << var->name << " = ";
        emit_expr(var->initializer.get());
        out_ << ";\n";
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        emit_line_directive(assign->line, line_file_);
        out_ << "    " << assign->name;
        if (assign->op == "++" || assign->op == "--") {
            out_ << assign->op << ";\n";
        } else {
            out_ << " " << assign->op << " ";
            emit_expr(assign->rhs.get());
            out_ << ";\n";
        }
    } else if (auto* aa = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        emit_line_directive(aa->line, line_file_);
        TypeKind elem_type = get_expr_type(aa->rhs.get());
        out_ << "    ((" << type_to_c(elem_type) << "*)" << aa->name << "->data)";
        out_ << "[sd_check_index(" << aa->name << "->length, ";
        emit_expr(aa->index.get());
        out_ << ")] = ";
        emit_expr(aa->rhs.get());
        out_ << ";\n";
    } else if (auto* ea = dynamic_cast<ElementAssignStmt*>(stmt)) {
        emit_line_directive(ea->line, line_file_);
        out_ << "    ";
        emit_expr(ea->target.get());
        out_ << " = ";
        emit_expr(ea->rhs.get());
        out_ << ";\n";
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        emit_line_directive(td->line, line_file_);
        std::string tmp = "__sd_d" + std::to_string(temp_counter_++);
        TypeDesc val;
        if (td->destruct_type == TypeKind::Tuple) {
            val.type = TypeKind::Tuple;
            val.tuple_members = td->tuple_members;
            out_ << "    " << tuple_name(td->tuple_members) << " " << tmp << " = ";
            emit_expr(td->rhs.get());
            out_ << ";\n";
        } else if (td->destruct_type == TypeKind::Array) {
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(td->destruct_elem);
            out_ << "    sd_array* " << tmp << " = ";
            emit_expr(td->rhs.get());
            out_ << ";\n";
        } else {
            val.type = TypeKind::Text;
            out_ << "    char* " << tmp << " = ";
            emit_expr(td->rhs.get());
            out_ << ";\n";
        }
        emit_destruct_level(td->patterns, tmp, val, /*declare=*/true);
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        emit_line_directive(ma->line, line_file_);
        std::string tmp = "__sd_m" + std::to_string(temp_counter_++);
        TypeDesc val;
        if (ma->destruct_type == TypeKind::Tuple) {
            val.type = TypeKind::Tuple;
            val.tuple_members = ma->tuple_members;
            out_ << "    " << tuple_name(ma->tuple_members) << " " << tmp << " = ";
            emit_expr(ma->rhs.get());
            out_ << ";\n";
        } else if (ma->destruct_type == TypeKind::Array) {
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(ma->destruct_elem);
            out_ << "    sd_array* " << tmp << " = ";
            emit_expr(ma->rhs.get());
            out_ << ";\n";
        } else {
            val.type = TypeKind::Text;
            out_ << "    char* " << tmp << " = ";
            emit_expr(ma->rhs.get());
            out_ << ";\n";
        }
        emit_destruct_level(ma->patterns, tmp, val, /*declare=*/false);
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        emit_line_directive(print->line, line_file_);
        out_ << "    printf(\"";
        for (size_t i = 0; i < print->args.size(); i++) {
            if (i > 0) out_ << " ";
            out_ << type_to_format(get_expr_type(print->args[i].get()));
        }
        out_ << "\\n\", ";
        for (size_t i = 0; i < print->args.size(); i++) {
            if (i > 0) out_ << ", ";
            TypeKind at = get_expr_type(print->args[i].get());
            emit_expr(print->args[i].get(), at == TypeKind::Text);
        }
        out_ << ");\n";
    } else if (auto* expr_stmt = dynamic_cast<ExprStmt*>(stmt)) {
        emit_line_directive(expr_stmt->line, line_file_);
        out_ << "    ";
        emit_expr(expr_stmt->expr.get());
        out_ << ";\n";
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        emit_line_directive(loop->line, line_file_);
        if (loop->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << loop->nl_id << ";\n";
        }
        out_ << "    for (int _i = 0; _i < ";
        emit_expr(loop->count.get());
        out_ << "; _i++) {\n";
        if (loop->nl_target) {
            out_ << "    volatile int _sd_nls" << loop->nl_id << " = setjmp(_sd_nl_buf" << loop->nl_id << ");\n";
            out_ << "    if (_sd_nls" << loop->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << loop->nl_id << " == 0) {\n";
        }
        for (auto& body_stmt : loop->body) {
            emit_stmt(body_stmt.get());
        }
        if (loop->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        emit_line_directive(fe->line, line_file_);
        TypeKind itype = get_expr_type(fe->iterable.get());
        std::string idx = fe->index_name.empty() ? "_fe" : fe->index_name;
        if (fe->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << fe->nl_id << ";\n";
        }
        auto nl_arm = [&]() {
            if (fe->nl_target) {
                out_ << "    volatile int _sd_nls" << fe->nl_id << " = setjmp(_sd_nl_buf" << fe->nl_id << ");\n";
                out_ << "    if (_sd_nls" << fe->nl_id << " == 1) break;\n";
                out_ << "    if (_sd_nls" << fe->nl_id << " == 0) {\n";
            }
        };
        auto nl_disarm = [&]() {
            if (fe->nl_target) {
                out_ << "    }\n";
            }
        };
        if (itype == TypeKind::Array) {
            TypeDesc ed = fe->elem;
            std::string ct = c_type_for_desc(ed);
            out_ << "    for (int " << idx << " = 0; " << idx << " < ";
            emit_expr(fe->iterable.get());
            out_ << "->length; " << idx << "++) {\n";
            nl_arm();
            out_ << "        " << ct << " " << fe->value_name
                 << " = ((" << ct << "*)";
            emit_expr(fe->iterable.get());
            out_ << "->data)[" << idx << "];\n";
            for (auto& body_stmt : fe->body) emit_stmt(body_stmt.get());
            nl_disarm();
            out_ << "    }\n";
        } else {
            out_ << "    for (int " << idx << " = 0; " << idx << " < (int)strlen(";
            emit_expr(fe->iterable.get());
            out_ << "); " << idx << "++) {\n";
            nl_arm();
            out_ << "        char " << fe->value_name << " = " << idx << "[" ;
            emit_expr(fe->iterable.get());
            out_ << "];\n";
            for (auto& body_stmt : fe->body) emit_stmt(body_stmt.get());
            nl_disarm();
            out_ << "    }\n";
        }
    } else if (auto* while_stmt = dynamic_cast<WhileStmt*>(stmt)) {
        emit_line_directive(while_stmt->line, line_file_);
        if (while_stmt->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << while_stmt->nl_id << ";\n";
        }
        out_ << "    while (";
        emit_expr(while_stmt->condition.get());
        out_ << ") {\n";
        if (while_stmt->nl_target) {
            out_ << "    volatile int _sd_nls" << while_stmt->nl_id << " = setjmp(_sd_nl_buf" << while_stmt->nl_id << ");\n";
            out_ << "    if (_sd_nls" << while_stmt->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << while_stmt->nl_id << " == 0) {\n";
        }
        for (auto& body_stmt : while_stmt->body) {
            emit_stmt(body_stmt.get());
        }
        if (while_stmt->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* for_stmt = dynamic_cast<ForStmt*>(stmt)) {
        emit_line_directive(for_stmt->line, line_file_);
        if (for_stmt->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << for_stmt->nl_id << ";\n";
        }
        out_ << "    for (";
        emit_for_component(for_stmt->init.get());
        out_ << "; ";
        emit_expr(for_stmt->condition.get());
        out_ << "; ";
        emit_for_component(for_stmt->update.get());
        out_ << ") {\n";
        if (for_stmt->nl_target) {
            out_ << "    volatile int _sd_nls" << for_stmt->nl_id << " = setjmp(_sd_nl_buf" << for_stmt->nl_id << ");\n";
            out_ << "    if (_sd_nls" << for_stmt->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << for_stmt->nl_id << " == 0) {\n";
        }
        for (auto& body_stmt : for_stmt->body) {
            emit_stmt(body_stmt.get());
        }
        if (for_stmt->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* do_while = dynamic_cast<DoWhileStmt*>(stmt)) {
        emit_line_directive(do_while->line, line_file_);
        if (do_while->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << do_while->nl_id << ";\n";
        }
        out_ << "    do {\n";
        if (do_while->nl_target) {
            out_ << "    volatile int _sd_nls" << do_while->nl_id << " = setjmp(_sd_nl_buf" << do_while->nl_id << ");\n";
            out_ << "    if (_sd_nls" << do_while->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << do_while->nl_id << " == 0) {\n";
        }
        for (auto& body_stmt : do_while->body) {
            emit_stmt(body_stmt.get());
        }
        if (do_while->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    } while (";
        emit_expr(do_while->condition.get());
        out_ << ");\n";
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        emit_line_directive(ret->line, line_file_);
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
        emit_line_directive(ifs->line, line_file_);
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
        emit_line_directive(sw->line, line_file_);
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
        emit_line_directive(brk->line, line_file_);
        if (brk->nonlocal) {
            out_ << "    longjmp(*(jmp_buf*)_sd_nl, 1);\n";
        } else {
            out_ << "    break;\n";
        }
    } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
        emit_line_directive(cont->line, line_file_);
        if (cont->nonlocal) {
            out_ << "    longjmp(*(jmp_buf*)_sd_nl, 2);\n";
        } else {
            out_ << "    continue;\n";
        }
    } else if (dynamic_cast<FunctionDecl*>(stmt)) {
        // Nested function declarations are hoisted to program scope during
        // generation; nothing is emitted at their definition site.
    }
}

void CodeGen::emit_for_component(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple) {
            out_ << tuple_name(var->tuple_members);
        } else if (var->annotation == TypeKind::Array) {
            out_ << "sd_array*";
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
