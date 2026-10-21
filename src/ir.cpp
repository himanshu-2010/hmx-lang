#include "ir.hpp"
#include <stdexcept>

namespace ir {

namespace {

// Map an exact AST statement type onto its IR kind. The chain order here is
// irrelevant for output: lowering is purely structural and the only contract
// is that every statement kind gets exactly one SKind.
SKind kind_of(const Statement* stmt) {
    if (dynamic_cast<const VarDecl*>(stmt)) return SKind::VarDecl;
    if (dynamic_cast<const AssignStmt*>(stmt)) return SKind::Assign;
    if (dynamic_cast<const ArrayAssignStmt*>(stmt)) return SKind::ArrayAssign;
    if (dynamic_cast<const ElementAssignStmt*>(stmt)) return SKind::ElementAssign;
    if (dynamic_cast<const MemberAssignStmt*>(stmt)) return SKind::MemberAssign;
    if (dynamic_cast<const DestructDecl*>(stmt)) return SKind::DestructDecl;
    if (dynamic_cast<const MultiAssignStmt*>(stmt)) return SKind::MultiAssign;
    if (dynamic_cast<const PrintStmt*>(stmt)) return SKind::Print;
    if (dynamic_cast<const ExprStmt*>(stmt)) return SKind::ExprStmt;
    if (dynamic_cast<const ReturnStmt*>(stmt)) return SKind::Return;
    if (dynamic_cast<const BreakStmt*>(stmt)) return SKind::Break;
    if (dynamic_cast<const ContinueStmt*>(stmt)) return SKind::Continue;
    if (dynamic_cast<const DeferStmt*>(stmt)) return SKind::Defer;
    if (dynamic_cast<const TryStmt*>(stmt)) return SKind::Try;
    if (dynamic_cast<const IfStmt*>(stmt)) return SKind::If;
    if (dynamic_cast<const SwitchStmt*>(stmt)) return SKind::Switch;
    if (dynamic_cast<const LoopStmt*>(stmt)) return SKind::Loop;
    if (dynamic_cast<const WhileStmt*>(stmt)) return SKind::While;
    if (dynamic_cast<const DoWhileStmt*>(stmt)) return SKind::DoWhile;
    if (dynamic_cast<const ForStmt*>(stmt)) return SKind::For;
    if (dynamic_cast<const ForeachStmt*>(stmt)) return SKind::Foreach;
    if (dynamic_cast<const FunctionDecl*>(stmt)) return SKind::FuncDecl;
    if (dynamic_cast<const TypeDecl*>(stmt)) return SKind::TypeDecl;
    throw std::runtime_error("internal error: unknown statement kind in IR build");
}

std::vector<std::unique_ptr<Node>> build_children(const std::vector<StmtPtr>& stmts);

std::unique_ptr<Node> build_node(const Statement* stmt) {
    auto n = std::make_unique<Node>();
    n->ast = const_cast<Statement*>(stmt);
    n->kind = kind_of(stmt);
    switch (n->kind) {
        case SKind::If: {
            auto* ifs = dynamic_cast<const IfStmt*>(stmt);
            n->body = build_children(ifs->then_body);
            n->else_body = build_children(ifs->else_body);
            break;
        }
        case SKind::Switch: {
            auto* sw = dynamic_cast<const SwitchStmt*>(stmt);
            n->cases.resize(sw->cases.size());
            for (size_t i = 0; i < sw->cases.size(); i++) {
                n->cases[i].ast = &sw->cases[i];
                n->cases[i].body = build_children(sw->cases[i].body);
            }
            break;
        }
        case SKind::Try: {
            auto* t = dynamic_cast<const TryStmt*>(stmt);
            n->body = build_children(t->body);
            n->handler = build_children(t->handler);
            break;
        }
        case SKind::For: {
            auto* f = dynamic_cast<const ForStmt*>(stmt);
            if (f->init) n->init = build_node(f->init.get());
            if (f->update) n->update = build_node(f->update.get());
            n->body = build_children(f->body);
            break;
        }
        case SKind::Loop: {
            auto* l = dynamic_cast<const LoopStmt*>(stmt);
            n->body = build_children(l->body);
            break;
        }
        case SKind::While: {
            auto* w = dynamic_cast<const WhileStmt*>(stmt);
            n->body = build_children(w->body);
            break;
        }
        case SKind::DoWhile: {
            auto* dw = dynamic_cast<const DoWhileStmt*>(stmt);
            n->body = build_children(dw->body);
            break;
        }
        case SKind::Foreach: {
            auto* fe = dynamic_cast<const ForeachStmt*>(stmt);
            n->body = build_children(fe->body);
            break;
        }
        case SKind::Defer: {
            auto* d = dynamic_cast<const DeferStmt*>(stmt);
            n->body = build_children(d->body);
            break;
        }
        case SKind::FuncDecl: {
            auto* fn = dynamic_cast<const FunctionDecl*>(stmt);
            n->body = build_children(fn->body);
            break;
        }
        default:
            break;
    }
    return n;
}

std::vector<std::unique_ptr<Node>> build_children(const std::vector<StmtPtr>& stmts) {
    std::vector<std::unique_ptr<Node>> out;
    out.reserve(stmts.size());
    for (auto& s : stmts) out.push_back(build_node(s.get()));
    return out;
}

}  // namespace

Node::~Node() = default;

std::vector<std::unique_ptr<Node>> build(const std::vector<StmtPtr>& stmts) {
    return build_children(stmts);
}

std::vector<std::unique_ptr<Node>> build(const std::vector<Statement*>& stmts) {
    std::vector<std::unique_ptr<Node>> out;
    out.reserve(stmts.size());
    for (auto* s : stmts) out.push_back(build_node(s));
    return out;
}

std::unique_ptr<Node> build_one(const Statement* stmt) {
    if (!stmt) throw std::runtime_error("internal error: IR build over null statement");
    return build_node(stmt);
}

}  // namespace ir
