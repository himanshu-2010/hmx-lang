#pragma once

#include <string>
#include <vector>
#include <memory>

enum class TypeKind {
    Int,
    Decimal,
    Text,
    Bool,
    Char,
    Byte,
    Array,
    Tuple,
    Unknown
};

struct TypeDesc {
    TypeKind type = TypeKind::Unknown;
    TypeKind element_type = TypeKind::Unknown;          // valid when type == Array
    std::vector<TypeDesc> tuple_members;                // valid when type == Tuple
    bool operator==(const TypeDesc& other) const;
    bool operator<(const TypeDesc& other) const;
};

std::string type_to_c(TypeKind kind);
std::string type_to_format(TypeKind kind);
std::string type_to_string(TypeKind kind);
std::string type_desc_to_string(const TypeDesc& desc);
std::string tuple_type_to_string(const std::vector<TypeDesc>& members);

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

struct CharLiteral : Expression {
    char value;
    explicit CharLiteral(char v) : value(v) {}
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

struct ConditionalExpr : Expression {
    ExprPtr condition;
    ExprPtr then_expr;
    ExprPtr else_expr;
    ConditionalExpr(ExprPtr c, ExprPtr t, ExprPtr e)
        : condition(std::move(c)), then_expr(std::move(t)), else_expr(std::move(e)) {}
};

struct CastExpr : Expression {
    TypeKind target_type;
    ExprPtr operand;
    CastExpr(TypeKind target, ExprPtr value)
        : target_type(target), operand(std::move(value)) {}
};

struct CallExpr : Expression {
    std::string name;
    std::vector<ExprPtr> args;
    CallExpr(std::string n, std::vector<ExprPtr> a)
        : name(std::move(n)), args(std::move(a)) {}
};

struct ArrayLiteral : Expression {
    std::vector<ExprPtr> elements;
    TypeKind element_type = TypeKind::Unknown;
    explicit ArrayLiteral(std::vector<ExprPtr> e) : elements(std::move(e)) {}
};

struct ArrayIndexExpr : Expression {
    std::string name;
    ExprPtr index;
    TypeKind element_type = TypeKind::Unknown;
    bool is_tuple = false;                     // valid after resolution
    int member_index = -1;                     // valid after resolution when is_tuple
    TypeKind array_of_element_type = TypeKind::Unknown;  // tuple member that is an array
    ArrayIndexExpr(std::string n, ExprPtr i)
        : name(std::move(n)), index(std::move(i)) {}
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
    TypeKind array_element_type = TypeKind::Unknown;   // valid when annotation == Array
    std::vector<TypeDesc> tuple_members;               // valid when annotation == Tuple
    bool has_annotation = false;
    bool is_mutable = true;
    ExprPtr initializer;
};

struct AssignStmt : Statement {
    std::string name;
    std::string op;      // "=", "+=", "-=", "*=", "/=", "++", "--"
    ExprPtr rhs;         // null for "++" / "--"
};

struct MultiAssignStmt : Statement {
    std::vector<std::string> names;
    ExprPtr rhs;
    std::vector<TypeDesc> tuple_members;   // filled by resolver
};

struct DestructDecl : Statement {
    std::vector<std::string> names;
    ExprPtr rhs;
    bool is_mutable = true;
    std::vector<TypeDesc> tuple_members;   // filled by resolver
};

struct ArrayAssignStmt : Statement {
    std::string name;
    ExprPtr index;
    ExprPtr rhs;
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

struct SwitchCase {
    ExprPtr value;
    std::vector<StmtPtr> body;
    bool is_default = false;
};

struct SwitchStmt : Statement {
    ExprPtr value;
    std::vector<SwitchCase> cases;
};

struct FunctionDecl : Statement {
    std::string name;
    struct Param {
        std::string name;
        TypeKind type;
        TypeKind array_element_type = TypeKind::Unknown;   // valid when type == Array
        std::vector<TypeDesc> tuple_members;               // valid when type == Tuple
    };
    std::vector<Param> params;
    TypeKind return_type = TypeKind::Unknown;
    TypeKind return_array_element_type = TypeKind::Unknown;  // valid when return_type == Array
    std::vector<TypeDesc> return_tuple_members;              // valid when return_type == Tuple
    bool has_return_type = false;
    std::vector<StmtPtr> body;
};

struct ReturnStmt : Statement {
    std::vector<ExprPtr> values;                  // empty for bare return
    std::vector<TypeDesc> return_tuple_members;   // filled by resolver for tuple returns
};

struct ExprStmt : Statement {
    ExprPtr expr;
};

struct Program : ASTNode {
    std::vector<StmtPtr> statements;
};
