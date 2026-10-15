#include "ast.hpp"

namespace {

// Push one owned child into `out`. Release=true detaches ownership from the
// parent (so the parent's own destructor becomes shallow); Release=false just
// records the pointer for a read-only traversal.
template <bool Release>
void push_child(std::vector<ASTNode*>& out, ExprPtr& e) {
    if (e) out.push_back(Release ? static_cast<ASTNode*>(e.release())
                                 : static_cast<ASTNode*>(e.get()));
}
template <bool Release>
void push_child(std::vector<ASTNode*>& out, StmtPtr& s) {
    if (s) out.push_back(Release ? static_cast<ASTNode*>(s.release())
                                 : static_cast<ASTNode*>(s.get()));
}
template <bool Release>
void push_expr_list(std::vector<ASTNode*>& out, std::vector<ExprPtr>& v) {
    for (auto& e : v) push_child<Release>(out, e);
}
template <bool Release>
void push_stmt_list(std::vector<ASTNode*>& out, std::vector<StmtPtr>& v) {
    for (auto& s : v) push_child<Release>(out, s);
}

// Enumerate a node's direct children in a fixed order. MUST be kept in sync
// with the node definitions in ast.hpp: a node type added there without a
// branch here would hide its subtree from destroy_ast (leak) and from
// ast_max_depth (unbounded recursion slips past the nesting guard).
//
// Each branch casts straight to a *concrete* node type from ASTNode*. The node
// hierarchy is flat -- every node derives directly from Expression, Statement
// or ASTNode -- so an exact-type cast is the only success case. Casting to the
// Expression/Statement *base* classes instead would be more natural, but some
// Clang libFuzzer runtimes statically bundle a libc++abi whose __dynamic_cast
// disagrees with libstdc++'s typeinfo vtables (see the note in CMakeLists.txt):
// a cast to a base silently returns null there, which would hide every subtree
// from both helpers. Concrete-type casts take the compiler's own fast path and
// are correct under either ABI.
template <bool Release>
void gather_children(ASTNode* node, std::vector<ASTNode*>& out) {
    if (auto* p = dynamic_cast<Program*>(node)) {
        push_stmt_list<Release>(out, p->statements);
    } else if (auto* b = dynamic_cast<BinaryExpr*>(node)) {
        push_child<Release>(out, b->left);
        push_child<Release>(out, b->right);
    } else if (auto* n = dynamic_cast<NotExpr*>(node)) {
        push_child<Release>(out, n->operand);
    } else if (auto* n = dynamic_cast<NegExpr*>(node)) {
        push_child<Release>(out, n->operand);
    } else if (auto* c = dynamic_cast<ConditionalExpr*>(node)) {
        push_child<Release>(out, c->condition);
        push_child<Release>(out, c->then_expr);
        push_child<Release>(out, c->else_expr);
    } else if (auto* c = dynamic_cast<CastExpr*>(node)) {
        push_child<Release>(out, c->operand);
    } else if (auto* c = dynamic_cast<CallExpr*>(node)) {
        push_expr_list<Release>(out, c->args);
    } else if (auto* a = dynamic_cast<ArrayLiteral*>(node)) {
        push_expr_list<Release>(out, a->elements);
    } else if (auto* t = dynamic_cast<TupleLiteral*>(node)) {
        push_expr_list<Release>(out, t->values);
    } else if (auto* i = dynamic_cast<ArrayIndexExpr*>(node)) {
        push_child<Release>(out, i->base);
        push_child<Release>(out, i->index);
    } else if (auto* m = dynamic_cast<MemberAccessExpr*>(node)) {
        push_child<Release>(out, m->base);
    } else if (auto* l = dynamic_cast<LambdaExpr*>(node)) {
        push_stmt_list<Release>(out, l->body);
    } else if (auto* v = dynamic_cast<VarDecl*>(node)) {
        push_child<Release>(out, v->initializer);
    } else if (auto* a = dynamic_cast<AssignStmt*>(node)) {
        push_child<Release>(out, a->rhs);
    } else if (auto* a = dynamic_cast<MultiAssignStmt*>(node)) {
        push_child<Release>(out, a->rhs);
    } else if (auto* d = dynamic_cast<DestructDecl*>(node)) {
        push_child<Release>(out, d->rhs);
    } else if (auto* a = dynamic_cast<ArrayAssignStmt*>(node)) {
        push_child<Release>(out, a->index);
        push_child<Release>(out, a->rhs);
    } else if (auto* a = dynamic_cast<ElementAssignStmt*>(node)) {
        push_child<Release>(out, a->target);
        push_child<Release>(out, a->rhs);
    } else if (auto* m = dynamic_cast<MemberAssignStmt*>(node)) {
        push_child<Release>(out, m->base);
        push_child<Release>(out, m->rhs);
    } else if (auto* p = dynamic_cast<PrintStmt*>(node)) {
        push_expr_list<Release>(out, p->args);
    } else if (auto* l = dynamic_cast<LoopStmt*>(node)) {
        push_child<Release>(out, l->count);
        push_stmt_list<Release>(out, l->body);
    } else if (auto* w = dynamic_cast<WhileStmt*>(node)) {
        push_child<Release>(out, w->condition);
        push_stmt_list<Release>(out, w->body);
    } else if (auto* f = dynamic_cast<ForStmt*>(node)) {
        push_child<Release>(out, f->init);
        push_child<Release>(out, f->condition);
        push_child<Release>(out, f->update);
        push_stmt_list<Release>(out, f->body);
    } else if (auto* d = dynamic_cast<DoWhileStmt*>(node)) {
        push_stmt_list<Release>(out, d->body);
        push_child<Release>(out, d->condition);
    } else if (auto* f = dynamic_cast<ForeachStmt*>(node)) {
        push_child<Release>(out, f->iterable);
        push_stmt_list<Release>(out, f->body);
    } else if (auto* i = dynamic_cast<IfStmt*>(node)) {
        push_child<Release>(out, i->condition);
        push_stmt_list<Release>(out, i->then_body);
        push_stmt_list<Release>(out, i->else_body);
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(node)) {
        push_child<Release>(out, sw->value);
        for (auto& c : sw->cases) {
            push_child<Release>(out, c.value);
            push_stmt_list<Release>(out, c.body);
        }
    } else if (auto* f = dynamic_cast<FunctionDecl*>(node)) {
        for (auto& p : f->params) push_child<Release>(out, p.default_value);
        push_stmt_list<Release>(out, f->body);
    } else if (auto* r = dynamic_cast<ReturnStmt*>(node)) {
        push_expr_list<Release>(out, r->values);
    } else if (auto* x = dynamic_cast<ExprStmt*>(node)) {
        push_child<Release>(out, x->expr);
    }
    // NumberLiteral / DecimalLiteral / StringLiteral / CharLiteral /
    // BoolLiteral / Identifier / BreakStmt / ContinueStmt / TypeDecl:
    // no children.
}

}  // namespace

void destroy_ast(ASTNode* node) {
    if (!node) return;
    std::vector<ASTNode*> work;
    work.push_back(node);
    while (!work.empty()) {
        ASTNode* n = work.back();
        work.pop_back();
        gather_children<true>(n, work);  // detach children first
        delete n;                        // now a shallow delete
    }
}

int ast_max_depth(ASTNode* node, int* out_line) {
    struct Frame {
        ASTNode* node;
        int depth;
    };
    std::vector<Frame> stack;
    if (node) stack.push_back({node, 1});
    int best_depth = 0;
    int best_stmt_depth = 0;   // depth at which the deepest statement sits
    int best_stmt_line = 0;
    std::vector<ASTNode*> kids;
    while (!stack.empty()) {
        Frame f = stack.back();
        stack.pop_back();
        if (f.depth > best_depth) best_depth = f.depth;
        int line = f.node->source_line();   // virtual: 0 for expressions
        if (line > 0 && f.depth > best_stmt_depth) {
            best_stmt_depth = f.depth;
            best_stmt_line = line;
        }
        kids.clear();
        gather_children<false>(f.node, kids);
        for (auto* k : kids) {
            if (k) stack.push_back({k, f.depth + 1});
        }
    }
    if (out_line) *out_line = best_stmt_line;
    return best_depth;
}

Program::~Program() {
    for (auto& s : statements) destroy_ast(s.release());
    statements.clear();
}

void destroy_expr_list(std::vector<ExprPtr>* v) {
    if (!v) return;
    for (auto& e : *v) destroy_ast(e.release());
    delete v;
}
void destroy_stmt_list(std::vector<StmtPtr>* v) {
    if (!v) return;
    for (auto& s : *v) destroy_ast(s.release());
    delete v;
}
void destroy_param_list(std::vector<FunctionDecl::Param>* v) {
    if (!v) return;
    for (auto& p : *v) destroy_ast(p.default_value.release());
    delete v;
}
void destroy_case_list(std::vector<SwitchCase>* v) {
    if (!v) return;
    for (auto& c : *v) {
        destroy_ast(c.value.release());
        for (auto& s : c.body) destroy_ast(s.release());
    }
    delete v;
}
void destroy_param(FunctionDecl::Param* p) {
    if (!p) return;
    destroy_ast(p->default_value.release());
    delete p;
}

bool TypeDesc::operator==(const TypeDesc& other) const {
    if (type != other.type) return false;
    if (elem != other.elem) {
        if (!elem || !other.elem) return false;
        if (*elem != *other.elem) return false;
    }
    if (tuple_members != other.tuple_members) return false;
    if (type == TypeKind::Struct || type == TypeKind::Enum) {
        return type_name == other.type_name;
    }
    if (type == TypeKind::Function) {
        if (fn_info == other.fn_info) return true;
        if (!fn_info || !other.fn_info) return false;
        return *fn_info == *other.fn_info;
    }
    return true;
}

bool TypeDesc::operator<(const TypeDesc& other) const {
    if (type != other.type) return type < other.type;
    if (elem != other.elem) {
        if (!elem) return true;
        if (!other.elem) return false;
        if (*elem != *other.elem) return *elem < *other.elem;
    }
    if (tuple_members != other.tuple_members) return tuple_members < other.tuple_members;
    if (type == TypeKind::Struct || type == TypeKind::Enum) {
        return type_name < other.type_name;
    }
    if (type == TypeKind::Function) {
        if (fn_info && other.fn_info) {
            if (fn_info->params != other.fn_info->params)
                return fn_info->params < other.fn_info->params;
            return fn_info->ret < other.fn_info->ret;
        }
        return (bool)other.fn_info;
    }
    return false;
}

bool FunctionTypeInfo::operator==(const FunctionTypeInfo& other) const {
    return params == other.params && ret == other.ret;
}

bool FunctionTypeInfo::operator<(const FunctionTypeInfo& other) const {
    if (params != other.params) return params < other.params;
    return ret < other.ret;
}

std::string type_to_c(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "double";
        case TypeKind::Text:    return "sd_str*";
        case TypeKind::Bool:    return "int";
        case TypeKind::Char:    return "char";
        case TypeKind::Byte:    return "unsigned char";
        case TypeKind::Array:   return "sd_array";
        case TypeKind::Tuple:   return "sd_tuple";
        case TypeKind::Function: return "sd_closure";
        case TypeKind::Enum:    return "int";
        default:                return "void";
    }
}

std::string type_to_format(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "%d";
        case TypeKind::Decimal: return "%f";
        case TypeKind::Text:    return "%s";
        case TypeKind::Bool:    return "%d";
        case TypeKind::Char:    return "%c";
        case TypeKind::Byte:    return "%d";
        case TypeKind::Array:   return "%d";
        case TypeKind::Enum:    return "%d";
        default:                return "%d";
    }
}

std::string type_to_string(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "decimal";
        case TypeKind::Text:    return "text";
        case TypeKind::Bool:    return "bool";
        case TypeKind::Char:    return "char";
        case TypeKind::Byte:    return "byte";
        case TypeKind::Array:   return "array";
        case TypeKind::Tuple:   return "tuple";
        case TypeKind::Function: return "function";
        case TypeKind::Struct:  return "struct";
        case TypeKind::Enum:    return "enum";
        default:                return "unknown";
    }
}

std::string type_desc_to_string(const TypeDesc& desc) {
    if (desc.type == TypeKind::Struct || desc.type == TypeKind::Enum) {
        return desc.type_name.empty() ? type_to_string(desc.type) : desc.type_name;
    }
    // A not-yet-expanded named-type reference prints as its name.
    if (desc.type == TypeKind::Unknown && !desc.type_name.empty()) return desc.type_name;
    if (desc.type == TypeKind::Array) {
        return "array of " + type_desc_to_string(desc.element());
    }
    if (desc.type == TypeKind::Tuple) {
        return tuple_type_to_string(desc.tuple_members);
    }
    if (desc.type == TypeKind::Function) {
        if (!desc.fn_info) return "function";
        std::string s = "fn(";
        for (size_t i = 0; i < desc.fn_info->params.size(); i++) {
            if (i > 0) s += ", ";
            s += type_desc_to_string(desc.fn_info->params[i]);
        }
        s += ") -> " + type_desc_to_string(desc.fn_info->ret);
        return s;
    }
    return type_to_string(desc.type);
}

std::string tuple_type_to_string(const std::vector<TypeDesc>& members) {
    if (members.empty()) return "tuple";
    std::string s = "(";
    for (size_t i = 0; i < members.size(); i++) {
        if (i > 0) s += ", ";
        s += type_desc_to_string(members[i]);
    }
    s += ")";
    return s;
}
