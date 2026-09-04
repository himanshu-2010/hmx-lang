#pragma once

#include <string>
#include <vector>
#include <memory>

enum class TypeKind {
    Int,
    Decimal,
    Text,
    Bool,
    Unknown
};

std::string type_to_c(TypeKind kind);
std::string type_to_format(TypeKind kind);
std::string type_to_string(TypeKind kind);

struct ASTNode {
    virtual ~ASTNode() = default;
};

using ASTNodePtr = std::unique_ptr<ASTNode>;

struct Expression : ASTNode {
    TypeKind resolved_type = TypeKind::Unknown;
    virtual ~Expression() = default;
};

using ExprPtr = std::unique_ptr<Expression>;

struct NumberLiteral : Expression {
    int value;
    explicit NumberLiteral(int v) : value(v) {}
};

struct DecimalLiteral : Expression {
    double value;
    explicit DecimalLiteral(double v) : value(v) {}
};

struct StringLiteral : Expression {
    std::string value;
    explicit StringLiteral(std::string v) : value(std::move(v)) {}
};

struct BoolLiteral : Expression {
    bool value;
    explicit BoolLiteral(bool v) : value(v) {}
};

struct Identifier : Expression {
    std::string name;
    explicit Identifier(std::string n) : name(std::move(n)) {}
};

enum class ExprKind {
    Arithmetic,
    Comparison,
    Logical
};

struct BinaryExpr : Expression {
    std::string op;
    ExprKind kind;
    ExprPtr left;
    ExprPtr right;
    BinaryExpr(std::string o, ExprKind k, ExprPtr l, ExprPtr r)
        : op(std::move(o)), kind(k), left(std::move(l)), right(std::move(r)) {}
};

struct NotExpr : Expression {
    ExprPtr operand;
    explicit NotExpr(ExprPtr o) : operand(std::move(o)) {}
};

struct CallExpr : Expression {
    std::string name;
    std::vector<ExprPtr> args;
    CallExpr(std::string n, std::vector<ExprPtr> a)
        : name(std::move(n)), args(std::move(a)) {}
};

struct Statement : ASTNode {
    int line = 0;
    TypeKind resolved_type = TypeKind::Unknown;
    virtual ~Statement() = default;
};

using StmtPtr = std::unique_ptr<Statement>;

struct VarDecl : Statement {
    std::string name;
    TypeKind annotation = TypeKind::Unknown;
    bool has_annotation = false;
    ExprPtr initializer;
};

struct AssignStmt : Statement {
    std::string name;
    std::string op;      // "=", "+=", "-=", "*=", "/=", "++", "--"
    ExprPtr rhs;         // null for "++" / "--"
};

struct PrintStmt : Statement {
    ExprPtr expr;
};

struct LoopStmt : Statement {
    ExprPtr count;
    std::vector<StmtPtr> body;
};

struct WhileStmt : Statement {
    ExprPtr condition;
    std::vector<StmtPtr> body;
};

struct ForStmt : Statement {
    StmtPtr init;
    ExprPtr condition;
    StmtPtr update;
    std::vector<StmtPtr> body;
};

struct DoWhileStmt : Statement {
    std::vector<StmtPtr> body;
    ExprPtr condition;
};

struct IfStmt : Statement {
    ExprPtr condition;
    std::vector<StmtPtr> then_body;
    std::vector<StmtPtr> else_body;
    bool has_else = false;
};

struct FunctionDecl : Statement {
    std::string name;
    struct Param {
        std::string name;
        TypeKind type;
    };
    std::vector<Param> params;
    TypeKind return_type = TypeKind::Unknown;
    bool has_return_type = false;
    std::vector<StmtPtr> body;
};

struct ReturnStmt : Statement {
    ExprPtr value = nullptr;   // null for bare return
};

struct ExprStmt : Statement {
    ExprPtr expr;
};

struct Program : ASTNode {
    std::vector<StmtPtr> statements;
};
