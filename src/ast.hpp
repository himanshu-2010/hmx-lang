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
    Function,
    Unknown
};

struct FunctionTypeInfo;

struct TypeDesc {
    TypeKind type = TypeKind::Unknown;
    std::shared_ptr<TypeDesc> elem;                    // valid when type == Array (recursive)
    std::vector<TypeDesc> tuple_members;                // valid when type == Tuple
    std::shared_ptr<FunctionTypeInfo> fn_info = nullptr; // valid when type == Function
    const TypeDesc& element() const {
        static const TypeDesc empty{};
        return elem ? *elem : empty;
    }
    static TypeDesc array_of(const TypeDesc& e) {
        TypeDesc d;
        d.type = TypeKind::Array;
        d.elem = std::make_shared<TypeDesc>(e);
        return d;
    }
    bool operator==(const TypeDesc& other) const;
    bool operator!=(const TypeDesc& other) const { return !(*this == other); }
    bool operator<(const TypeDesc& other) const;
};

struct FunctionTypeInfo {
    std::vector<TypeDesc> params;
    TypeDesc ret;
    bool operator==(const FunctionTypeInfo& other) const;
    bool operator<(const FunctionTypeInfo& other) const;
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
    bool is_function_reference = false;   // resolved to a defined function used as a value
    TypeDesc fn_type;                     // function's type when is_function_reference
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

struct NegExpr : Expression {
    ExprPtr operand;
    explicit NegExpr(ExprPtr o) : operand(std::move(o)) {}
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
    bool is_function_value_call = false;   // set by resolver: name is a function-typed value
    TypeDesc fn_type;                      // function type of the value when is_function_value_call
    CallExpr(std::string n, std::vector<ExprPtr> a)
        : name(std::move(n)), args(std::move(a)) {}
};

struct ArrayLiteral : Expression {
    std::vector<ExprPtr> elements;
    TypeDesc elem;                       // element descriptor after resolution
    explicit ArrayLiteral(std::vector<ExprPtr> e) : elements(std::move(e)) {}
};

struct ArrayIndexExpr : Expression {
    std::string name;                       // valid when base == null (direct indentifier)
    ExprPtr base;                           // non-null for chained indexing (a[0][1])
    ExprPtr index;
    TypeDesc elem;                              // element descriptor after resolution
    bool is_tuple = false;                      // valid after resolution
    int member_index = -1;                      // valid after resolution when is_tuple
    ArrayIndexExpr(std::string n, ExprPtr i)
        : name(std::move(n)), base(nullptr), index(std::move(i)) {}
    ArrayIndexExpr(ExprPtr b, ExprPtr i)
        : name(), base(std::move(b)), index(std::move(i)) {}
};

struct Statement : ASTNode {
    int line = 0;
    TypeKind resolved_type = TypeKind::Unknown;
    int nl_id = -1;                       // unique loop id (assigned by resolver for every loop)
    bool nl_target = false;               // true if some nested function non-locally exits this loop
    struct FunctionDecl* nl_owner = nullptr;  // function whose body lexically contains this loop
    virtual ~Statement() = default;
};

using StmtPtr = std::unique_ptr<Statement>;

struct VarDecl : Statement {
    std::string name;
    TypeKind annotation = TypeKind::Unknown;
    TypeDesc elem_desc;                              // element descriptor when annotation == Array
    std::vector<TypeDesc> tuple_members;               // valid when annotation == Tuple
    TypeDesc annotation_desc;                          // full desc for Function annotations
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

struct ElementAssignStmt : Statement {
    ExprPtr target;   // ArrayIndexExpr (possibly chained)
    ExprPtr rhs;
};

struct PrintStmt : Statement {
    std::vector<ExprPtr> args;
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

struct ForeachStmt : Statement {
    std::string value_name;
    std::string index_name;     // empty when only the value form is used
    ExprPtr iterable;
    std::vector<StmtPtr> body;
    TypeDesc elem;              // element descriptor (arrays) / char (text); filled by resolver
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

struct CapturedVar {
    std::string name;
    TypeDesc desc;                 // type of the captured variable
};

struct FunctionDecl : Statement {
    std::string name;
    std::string file;                            // source .hmx file (filled by module loader)
    struct Param {
        std::string name;
        TypeKind type;
        TypeDesc elem_desc;                                    // valid when type == Array
        std::vector<TypeDesc> tuple_members;                   // valid when type == Tuple
        TypeDesc desc;                                         // full descriptor (Function etc.)
        ExprPtr default_value;                                 // null when no default
        bool variadic = false;                                 // trailing ...elem collector
    };
    std::vector<Param> params;
    TypeKind return_type = TypeKind::Unknown;
    TypeDesc return_elem;                                     // element descriptor when return_type == Array
    std::vector<TypeDesc> return_tuple_members;              // valid when return_type == Tuple
    TypeDesc return_desc;                                    // full descriptor (Function etc.)
    bool has_return_type = false;
    std::vector<StmtPtr> body;
    std::vector<CapturedVar> captures;            // outer locals referenced by body (filled by resolver)
    bool has_nonlocal = false;                    // body non-locally breaks/continues an enclosing loop
    int nl_target_loop_id = -1;                   // loop (Statement::nl_id) targeted by the non-local exit
    bool nl_use_break = false;                    // non-local break present
    bool nl_use_continue = false;                 // non-local continue present
};

struct ReturnStmt : Statement {
    std::vector<ExprPtr> values;                  // empty for bare return
    std::vector<TypeDesc> return_tuple_members;   // filled by resolver for tuple returns
};

struct BreakStmt : Statement {
    bool nonlocal = false;    // set by resolver: breaks an enclosing function's loop
};

struct ContinueStmt : Statement {
    bool nonlocal = false;    // set by resolver: continues an enclosing function's loop
};

struct ExprStmt : Statement {
    ExprPtr expr;
};

struct Program : ASTNode {
    std::vector<StmtPtr> statements;
    std::vector<std::string> use_files;           // `use "path.hmx"` at top of file
    std::string source_file;                      // entry .hmx path (set by driver)
};
