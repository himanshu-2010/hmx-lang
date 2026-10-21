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
    } else if (auto* d = dynamic_cast<DeferStmt*>(node)) {
        push_stmt_list<Release>(out, d->body);
    } else if (auto* t = dynamic_cast<TryStmt*>(node)) {
        push_stmt_list<Release>(out, t->body);
        push_stmt_list<Release>(out, t->handler);
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

// --- M17 deep clone ---------------------------------------------------------
// A faithful structural copy of a statement/expression subtree. Only the
// parser-populated fields are carried over (names, operator kinds, type
// descriptors, source lines); resolver-synthesized state (resolved_type, the
// various `is_*` flags, tuple/element descriptors computed during resolution,
// non-local-exit bookkeeping) is left at its default so the clone resolves
// from a clean slate. The clone is used to monomorphize generic templates and
// runs only after the HMX_MAX_NESTING guard, so the recursion is bounded.

namespace {

ExprPtr clone_expr_impl(const Expression* e);
StmtPtr clone_stmt_impl(const Statement* s);

std::vector<ExprPtr> clone_expr_list(const std::vector<ExprPtr>& v) {
    std::vector<ExprPtr> out;
    out.reserve(v.size());
    for (auto& e : v) out.push_back(clone_expr_impl(e.get()));
    return out;
}

std::vector<StmtPtr> clone_stmt_list(const std::vector<StmtPtr>& v) {
    std::vector<StmtPtr> out;
    out.reserve(v.size());
    for (auto& s : v) out.push_back(clone_stmt_impl(s.get()));
    return out;
}

std::vector<FunctionDecl::Param> clone_params(const std::vector<FunctionDecl::Param>& v) {
    std::vector<FunctionDecl::Param> out;
    out.reserve(v.size());
    for (auto& p : v) {
        FunctionDecl::Param q;
        q.name = p.name;
        q.type = p.type;
        q.elem_desc = p.elem_desc;
        q.tuple_members = p.tuple_members;
        q.desc = p.desc;
        q.default_value = clone_expr_impl(p.default_value.get());
        q.variadic = p.variadic;
        out.push_back(std::move(q));
    }
    return out;
}

DestructPattern clone_pattern(const DestructPattern& p) {
    DestructPattern q;
    q.name = p.name;
    q.is_rest = p.is_rest;
    q.nested = p.nested;
    q.items.reserve(p.items.size());
    for (auto& it : p.items) q.items.push_back(clone_pattern(it));
    return q;
}

std::vector<DestructPattern> clone_patterns(const std::vector<DestructPattern>& v) {
    std::vector<DestructPattern> out;
    out.reserve(v.size());
    for (auto& p : v) out.push_back(clone_pattern(p));
    return out;
}

ExprPtr clone_expr_impl(const Expression* e) {
    if (!e) return nullptr;
    if (auto* n = dynamic_cast<const NumberLiteral*>(e))
        return std::make_unique<NumberLiteral>(n->value);
    if (auto* d = dynamic_cast<const DecimalLiteral*>(e))
        return std::make_unique<DecimalLiteral>(d->value);
    if (auto* s = dynamic_cast<const StringLiteral*>(e))
        return std::make_unique<StringLiteral>(s->value);
    if (auto* c = dynamic_cast<const CharLiteral*>(e))
        return std::make_unique<CharLiteral>(c->value);
    if (auto* b = dynamic_cast<const BoolLiteral*>(e))
        return std::make_unique<BoolLiteral>(b->value);
    if (auto* id = dynamic_cast<const Identifier*>(e))
        return std::make_unique<Identifier>(id->name);
    if (auto* b = dynamic_cast<const BinaryExpr*>(e))
        return std::make_unique<BinaryExpr>(b->op, b->kind,
                                            clone_expr_impl(b->left.get()),
                                            clone_expr_impl(b->right.get()));
    if (auto* n = dynamic_cast<const NotExpr*>(e))
        return std::make_unique<NotExpr>(clone_expr_impl(n->operand.get()));
    if (auto* n = dynamic_cast<const NegExpr*>(e))
        return std::make_unique<NegExpr>(clone_expr_impl(n->operand.get()));
    if (auto* c = dynamic_cast<const ConditionalExpr*>(e))
        return std::make_unique<ConditionalExpr>(clone_expr_impl(c->condition.get()),
                                                 clone_expr_impl(c->then_expr.get()),
                                                 clone_expr_impl(c->else_expr.get()));
    if (auto* c = dynamic_cast<const CastExpr*>(e))
        return std::make_unique<CastExpr>(c->target_type, clone_expr_impl(c->operand.get()));
    if (auto* c = dynamic_cast<const CallExpr*>(e))
        return std::make_unique<CallExpr>(c->name, clone_expr_list(c->args));
    if (auto* a = dynamic_cast<const ArrayLiteral*>(e))
        return std::make_unique<ArrayLiteral>(clone_expr_list(a->elements));
    if (auto* t = dynamic_cast<const TupleLiteral*>(e))
        return std::make_unique<TupleLiteral>(clone_expr_list(t->values));
    if (auto* i = dynamic_cast<const ArrayIndexExpr*>(e)) {
        if (i->base)
            return std::make_unique<ArrayIndexExpr>(clone_expr_impl(i->base.get()),
                                                    clone_expr_impl(i->index.get()));
        return std::make_unique<ArrayIndexExpr>(i->name, clone_expr_impl(i->index.get()));
    }
    if (auto* m = dynamic_cast<const MemberAccessExpr*>(e))
        return std::make_unique<MemberAccessExpr>(clone_expr_impl(m->base.get()), m->member);
    if (auto* l = dynamic_cast<const LambdaExpr*>(e)) {
        auto out = std::make_unique<LambdaExpr>();
        out->params = clone_params(l->params);
        out->has_return_type = l->has_return_type;
        out->return_type = l->return_type;
        out->return_elem = l->return_elem;
        out->return_tuple_members = l->return_tuple_members;
        out->return_desc = l->return_desc;
        out->body = clone_stmt_list(l->body);
        out->line = l->line;
        return out;
    }
    return nullptr;
}

StmtPtr clone_stmt_impl(const Statement* s) {
    if (!s) return nullptr;
    if (auto* v = dynamic_cast<const VarDecl*>(s)) {
        auto out = std::make_unique<VarDecl>();
        out->name = v->name;
        out->file = v->file;
        out->annotation = v->annotation;
        out->elem_desc = v->elem_desc;
        out->tuple_members = v->tuple_members;
        out->annotation_desc = v->annotation_desc;
        out->has_annotation = v->has_annotation;
        out->is_mutable = v->is_mutable;
        out->initializer = clone_expr_impl(v->initializer.get());
        out->line = v->line;
        return out;
    }
    if (auto* a = dynamic_cast<const AssignStmt*>(s)) {
        auto out = std::make_unique<AssignStmt>();
        out->name = a->name;
        out->op = a->op;
        out->rhs = clone_expr_impl(a->rhs.get());
        out->line = a->line;
        return out;
    }
    if (auto* m = dynamic_cast<const MultiAssignStmt*>(s)) {
        auto out = std::make_unique<MultiAssignStmt>();
        out->patterns = clone_patterns(m->patterns);
        out->rhs = clone_expr_impl(m->rhs.get());
        out->line = m->line;
        return out;
    }
    if (auto* d = dynamic_cast<const DestructDecl*>(s)) {
        auto out = std::make_unique<DestructDecl>();
        out->patterns = clone_patterns(d->patterns);
        out->rhs = clone_expr_impl(d->rhs.get());
        out->is_mutable = d->is_mutable;
        out->file = d->file;
        out->line = d->line;
        return out;
    }
    if (auto* a = dynamic_cast<const ArrayAssignStmt*>(s)) {
        auto out = std::make_unique<ArrayAssignStmt>();
        out->name = a->name;
        out->index = clone_expr_impl(a->index.get());
        out->rhs = clone_expr_impl(a->rhs.get());
        out->line = a->line;
        return out;
    }
    if (auto* e = dynamic_cast<const ElementAssignStmt*>(s)) {
        auto out = std::make_unique<ElementAssignStmt>();
        out->target = clone_expr_impl(e->target.get());
        out->rhs = clone_expr_impl(e->rhs.get());
        out->line = e->line;
        return out;
    }
    if (auto* m = dynamic_cast<const MemberAssignStmt*>(s)) {
        auto out = std::make_unique<MemberAssignStmt>();
        out->base = clone_expr_impl(m->base.get());
        out->member = m->member;
        out->op = m->op;
        out->rhs = clone_expr_impl(m->rhs.get());
        out->line = m->line;
        return out;
    }
    if (auto* p = dynamic_cast<const PrintStmt*>(s)) {
        auto out = std::make_unique<PrintStmt>();
        out->args = clone_expr_list(p->args);
        out->line = p->line;
        return out;
    }
    if (auto* l = dynamic_cast<const LoopStmt*>(s)) {
        auto out = std::make_unique<LoopStmt>();
        out->count = clone_expr_impl(l->count.get());
        out->body = clone_stmt_list(l->body);
        out->line = l->line;
        return out;
    }
    if (auto* w = dynamic_cast<const WhileStmt*>(s)) {
        auto out = std::make_unique<WhileStmt>();
        out->condition = clone_expr_impl(w->condition.get());
        out->body = clone_stmt_list(w->body);
        out->line = w->line;
        return out;
    }
    if (auto* f = dynamic_cast<const ForStmt*>(s)) {
        auto out = std::make_unique<ForStmt>();
        out->init = clone_stmt_impl(f->init.get());
        out->condition = clone_expr_impl(f->condition.get());
        out->update = clone_stmt_impl(f->update.get());
        out->body = clone_stmt_list(f->body);
        out->line = f->line;
        return out;
    }
    if (auto* d = dynamic_cast<const DoWhileStmt*>(s)) {
        auto out = std::make_unique<DoWhileStmt>();
        out->body = clone_stmt_list(d->body);
        out->condition = clone_expr_impl(d->condition.get());
        out->line = d->line;
        return out;
    }
    if (auto* f = dynamic_cast<const ForeachStmt*>(s)) {
        auto out = std::make_unique<ForeachStmt>();
        out->value_name = f->value_name;
        out->index_name = f->index_name;
        out->iterable = clone_expr_impl(f->iterable.get());
        out->body = clone_stmt_list(f->body);
        out->line = f->line;
        return out;
    }
    if (auto* i = dynamic_cast<const IfStmt*>(s)) {
        auto out = std::make_unique<IfStmt>();
        out->condition = clone_expr_impl(i->condition.get());
        out->then_body = clone_stmt_list(i->then_body);
        out->else_body = clone_stmt_list(i->else_body);
        out->has_else = i->has_else;
        out->line = i->line;
        return out;
    }
    if (auto* sw = dynamic_cast<const SwitchStmt*>(s)) {
        auto out = std::make_unique<SwitchStmt>();
        out->value = clone_expr_impl(sw->value.get());
        for (auto& c : sw->cases) {
            SwitchCase nc;
            nc.value = clone_expr_impl(c.value.get());
            nc.body = clone_stmt_list(c.body);
            out->cases.push_back(std::move(nc));
        }
        out->line = sw->line;
        return out;
    }
    if (auto* fn = dynamic_cast<const FunctionDecl*>(s)) {
        auto out = std::make_unique<FunctionDecl>();
        out->name = fn->name;
        out->file = fn->file;
        out->type_params = fn->type_params;
        out->is_lambda = fn->is_lambda;
        out->params = clone_params(fn->params);
        out->return_type = fn->return_type;
        out->return_elem = fn->return_elem;
        out->return_tuple_members = fn->return_tuple_members;
        out->return_desc = fn->return_desc;
        out->has_return_type = fn->has_return_type;
        out->body = clone_stmt_list(fn->body);
        out->line = fn->line;
        return out;
    }
    if (auto* r = dynamic_cast<const ReturnStmt*>(s)) {
        auto out = std::make_unique<ReturnStmt>();
        out->values = clone_expr_list(r->values);
        out->line = r->line;
        return out;
    }
    if (auto* b = dynamic_cast<const BreakStmt*>(s)) {
        auto out = std::make_unique<BreakStmt>();
        out->line = b->line;
        return out;
    }
    if (auto* c = dynamic_cast<const ContinueStmt*>(s)) {
        auto out = std::make_unique<ContinueStmt>();
        out->line = c->line;
        return out;
    }
    if (auto* e = dynamic_cast<const ExprStmt*>(s)) {
        auto out = std::make_unique<ExprStmt>();
        out->expr = clone_expr_impl(e->expr.get());
        out->line = e->line;
        return out;
    }
    if (auto* d = dynamic_cast<const DeferStmt*>(s)) {
        auto out = std::make_unique<DeferStmt>();
        out->body = clone_stmt_list(d->body);
        out->line = d->line;
        return out;
    }
    if (auto* t = dynamic_cast<const TryStmt*>(s)) {
        auto out = std::make_unique<TryStmt>();
        out->body = clone_stmt_list(t->body);
        out->handler = clone_stmt_list(t->handler);
        out->error_name = t->error_name;
        out->line = t->line;
        return out;
    }
    if (auto* t = dynamic_cast<const TypeDecl*>(s)) {
        auto out = std::make_unique<TypeDecl>();
        out->kind = t->kind;
        out->name = t->name;
        out->file = t->file;
        out->alias_target = t->alias_target;
        out->fields = t->fields;
        out->variants = t->variants;
        out->type_params = t->type_params;
        out->line = t->line;
        return out;
    }
    return nullptr;
}

}  // namespace

StmtPtr clone_stmt(const Statement* s) { return clone_stmt_impl(s); }
ExprPtr clone_expr(const Expression* e) { return clone_expr_impl(e); }

bool TypeDesc::operator==(const TypeDesc& other) const {
    if (type != other.type) return false;
    if (elem != other.elem) {
        if (!elem || !other.elem) return false;
        if (*elem != *other.elem) return false;
    }
    if (tuple_members != other.tuple_members) return false;
    if (type == TypeKind::Struct || type == TypeKind::Enum) {
        // M17.3: `Box[int]` and `Box[text]` share the base name; the type
        // arguments are what make the specializations distinct.
        return type_name == other.type_name && type_args == other.type_args;
    }
    if (type == TypeKind::Function) {
        if (fn_info == other.fn_info) return true;
        if (!fn_info || !other.fn_info) return false;
        return *fn_info == *other.fn_info;
    }
    // Primitive kinds have an empty type_name; named-type markers (Unknown +
    // type_name, possibly with type arguments) must compare their reference.
    return type_name == other.type_name && type_args == other.type_args;
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
        if (type_name != other.type_name) return type_name < other.type_name;
        return type_args < other.type_args;
    }
    if (type == TypeKind::Function) {
        if (fn_info && other.fn_info) {
            if (fn_info->params != other.fn_info->params)
                return fn_info->params < other.fn_info->params;
            return fn_info->ret < other.fn_info->ret;
        }
        return (bool)other.fn_info;
    }
    if (type_name != other.type_name) return type_name < other.type_name;
    return type_args < other.type_args;
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

static std::string type_args_to_string(const TypeDesc& desc) {
    if (desc.type_args.empty()) return std::string();
    std::string s = "[";
    for (size_t i = 0; i < desc.type_args.size(); i++) {
        if (i > 0) s += ", ";
        s += type_desc_to_string(desc.type_args[i]);
    }
    s += "]";
    return s;
}

std::string type_desc_to_string(const TypeDesc& desc) {
    if (desc.type == TypeKind::Struct || desc.type == TypeKind::Enum) {
        if (desc.type_name.empty()) return type_to_string(desc.type);
        return desc.type_name + type_args_to_string(desc);
    }
    // A not-yet-expanded named-type reference prints as its name.
    if (desc.type == TypeKind::Unknown && !desc.type_name.empty())
        return desc.type_name + type_args_to_string(desc);
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

// M17.3: C-identifier-safe encoding of a concrete descriptor, used to name
// generic instantiations (`__gen_f_n_Box__int`). Structs and enums mangle by
// their specialization key so `Box[int]` and `Box[text]` never collide.
std::string type_mangle(const TypeDesc& d) {
    switch (d.type) {
        case TypeKind::Int: return "int";
        case TypeKind::Decimal: return "dec";
        case TypeKind::Text: return "text";
        case TypeKind::Bool: return "bool";
        case TypeKind::Char: return "char";
        case TypeKind::Byte: return "byte";
        case TypeKind::Array: return "arr_" + type_mangle(d.element());
        case TypeKind::Tuple: {
            std::string s = "tup";
            for (auto& m : d.tuple_members) s += "_" + type_mangle(m);
            return s;
        }
        case TypeKind::Function: {
            std::string s = "fn";
            if (d.fn_info) {
                for (auto& p : d.fn_info->params) s += "_" + type_mangle(p);
                s += "_r_" + type_mangle(d.fn_info->ret);
            }
            return s;
        }
        case TypeKind::Struct:
        case TypeKind::Enum:
            return "n_" + type_inst_name(d);
        case TypeKind::Unknown:
            return d.type_name.empty() ? "unk" : ("n_" + type_inst_name(d));
    }
    return "unk";
}

// Canonical key of a type's specialization: the plain declared name when the
// type takes no type arguments, `Box__int` for `Box[int]`. The resolver
// registers the cloned TypeDecl of a generic struct under exactly this name,
// and codegen maps a resolved descriptor back to it with this function, so the
// two sides can never disagree on a specialization's identity.
std::string type_inst_name(const TypeDesc& d) {
    if (d.type_name.empty() || d.type_args.empty()) return d.type_name;
    std::string s = d.type_name + "__";
    for (size_t i = 0; i < d.type_args.size(); i++) {
        if (i > 0) s += "_";
        s += type_mangle(d.type_args[i]);
    }
    return s;
}
