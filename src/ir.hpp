#pragma once
// ── P1a: the IR statement tree ─────────────────────────────────────────────
//
// The IR is the backend seam established by ADR 0004. Statements below the
// resolver are lowered once into `ir::Node` trees; every consumer (today the
// C emitter, later the x86-64 and WASM backends) walks this tree instead of
// dynamic-casting through the AST.
//
// The tree mirrors the resolved AST statement structure exactly — same
// ordering, same nesting — so the C emitter keeps producing byte-identical
// output while its dispatch and child access move off the AST. Expressions
// stay AST pointers in this phase (P1b lowers them); they are reached through
// the AST object this node wraps, so lowering is purely structural.
//
// Ownership: `ast` points into the Program the IR was built from; IR nodes
// own nothing but their own child nodes. Build the IR once from the final
// (resolved, monomorphized) program.

#include "ast.hpp"
#include <memory>
#include <vector>

namespace ir {

enum class SKind : unsigned char {
    VarDecl,        // declaration with initializer
    Assign,         // simple `name <op> rhs`
    ArrayAssign,    // `name[idx] = rhs` on an array variable
    ElementAssign,  // `a[...] = v` on a nested lvalue chain / tuple member
    MemberAssign,   // `base.field <op> rhs`
    DestructDecl,   // destructure declaration (let-pattern)
    MultiAssign,    // multi-target destructure assignment
    Print,
    ExprStmt,
    Return,
    Break,
    Continue,
    Defer,
    Try,
    If,
    Switch,
    Loop,
    While,
    DoWhile,
    For,
    Foreach,
    FuncDecl,
    TypeDecl,
};

struct Node;

struct Case {
    const SwitchCase* ast = nullptr;   // case value / default flag live here
    std::vector<std::unique_ptr<Node>> body;
};

struct Node {
    SKind kind;
    Statement* ast;                // the resolved AST statement for this node
    // Ordered statement children by kind:
    //   If:      body = then-branch children, else_body = else-branch children
    //   Try:     body = try body, handler = catch body
    //   Switch:  cases[i].body (per-case C scope, in declaration order)
    //   Loop / While / DoWhile / Foreach / For / Defer / FuncDecl: body
    //   For:     additionally init (may be null) and update (may be null)
    std::vector<std::unique_ptr<Node>> body;
    std::vector<std::unique_ptr<Node>> else_body;
    std::vector<std::unique_ptr<Node>> handler;
    std::unique_ptr<Node> init;
    std::unique_ptr<Node> update;
    std::vector<Case> cases;

    // Defined out-of-line in ir.cpp: the nested `vector<unique_ptr<Node>>`
    // and `vector<Case>` (Case itself holds one) must be instantiated at a
    // point where Node/Case are complete.
    ~Node();
};

constexpr bool is_valid(SKind k) { return k <= SKind::TypeDecl; }

// Lower a resolved statement list into IR children (same order).
std::vector<std::unique_ptr<Node>> build(const std::vector<StmtPtr>& stmts);
// Same lowering over a borrowed statement list (codegen's top_level list).
std::vector<std::unique_ptr<Node>> build(const std::vector<Statement*>& stmts);
// Lower one resolved statement into a single IR node (used by For init/update
// and anywhere a lazily-built single node is handy).
std::unique_ptr<Node> build_one(const Statement* stmt);

}  // namespace ir
