%code requires {
#include "ast.hpp"
#include <vector>
}

%{
#include "ast.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>

extern int yylex();
extern int yylineno;
extern char* yytext;

void yyerror(const char* s) {
    fprintf(stderr, "Parse error [line %d]: %s near '%s'\n", yylineno, s, yytext);
    exit(1);
}

Program* g_program = nullptr;
%}

%union {
    int ival;
    double fval;
    char* sval;
    Expression* expr;
    Statement* stmt;
    Program* program;
    std::vector<StmtPtr>* stmts;
    std::vector<FunctionDecl::Param>* params;
    std::vector<ExprPtr>* args;
    TypeKind tkind;
}

%token LET CONST FN LOOP FOR WHILE DO PRINT RETURN TRUE FALSE
%token IF ELSE
%token TYPE_INT TYPE_DECIMAL TYPE_TEXT TYPE_BOOL TYPE_CHAR TYPE_BYTE
%token NUMBER DECIMAL STRING CHAR IDENTIFIER
%token EQ NEQ LT GT LEQ GEQ
%token AND OR NOT
%token PLUS_EQ MINUS_EQ STAR_EQ SLASH_EQ INCR DECR
%token ARROW
%token AS

%type <ival> NUMBER
%type <fval> DECIMAL
%type <sval> STRING CHAR IDENTIFIER
%type <expr> expression conditional logical_or logical_and equality relational additive term factor
%type <stmt> statement var_decl assign_stmt print_stmt loop_stmt while_stmt for_stmt do_while_stmt if_stmt return_stmt call_stmt fn_decl
%type <stmt> for_init for_update
%type <params> param_list
%type <args> args
%type <tkind> param_type
%type <program> program
%type <stmts> stmt_list

%%

program
    : stmt_list
        {
            $$ = new Program();
            for (auto& s : *$1) {
                $$->statements.push_back(std::move(s));
            }
            delete $1;
            g_program = $$;
        }
    ;

stmt_list
    : stmt_list statement
        {
            $1->push_back(StmtPtr($2));
            $$ = $1;
        }
    | statement
        {
            $$ = new std::vector<StmtPtr>();
            $$->push_back(StmtPtr($1));
        }
    ;

statement
    : var_decl     { $$ = $1; }
    | assign_stmt  { $$ = $1; }
    | call_stmt    { $$ = $1; }
    | print_stmt   { $$ = $1; }
    | loop_stmt    { $$ = $1; }
    | while_stmt   { $$ = $1; }
    | for_stmt     { $$ = $1; }
    | do_while_stmt { $$ = $1; }
    | if_stmt      { $$ = $1; }
    | return_stmt  { $$ = $1; }
    | fn_decl      { $$ = $1; }
    ;

var_decl
    : LET IDENTIFIER '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = false;
            v->is_mutable = true;
            v->initializer = ExprPtr($4);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_INT '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->is_mutable = true;
            v->annotation = TypeKind::Int;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_DECIMAL '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->is_mutable = true;
            v->annotation = TypeKind::Decimal;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_TEXT '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->is_mutable = true;
            v->annotation = TypeKind::Text;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_BOOL '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->is_mutable = true;
            v->annotation = TypeKind::Bool;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->is_mutable = false;
            v->initializer = ExprPtr($4);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_INT '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Int;
            v->is_mutable = false;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_DECIMAL '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Decimal;
            v->is_mutable = false;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_TEXT '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Text;
            v->is_mutable = false;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_BOOL '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Bool;
            v->is_mutable = false;
            v->initializer = ExprPtr($6);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_CHAR '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2; v->has_annotation = true; v->annotation = TypeKind::Char;
            v->is_mutable = true; v->initializer = ExprPtr($6); v->line = yylineno;
            free($2); $$ = v;
        }
    | LET IDENTIFIER ':' TYPE_BYTE '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2; v->has_annotation = true; v->annotation = TypeKind::Byte;
            v->is_mutable = true; v->initializer = ExprPtr($6); v->line = yylineno;
            free($2); $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_CHAR '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2; v->has_annotation = true; v->annotation = TypeKind::Char;
            v->is_mutable = false; v->initializer = ExprPtr($6); v->line = yylineno;
            free($2); $$ = v;
        }
    | CONST IDENTIFIER ':' TYPE_BYTE '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2; v->has_annotation = true; v->annotation = TypeKind::Byte;
            v->is_mutable = false; v->initializer = ExprPtr($6); v->line = yylineno;
            free($2); $$ = v;
        }
    ;

assign_stmt
    : IDENTIFIER '=' expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "=";
            a->rhs = ExprPtr($3);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER PLUS_EQ expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "+=";
            a->rhs = ExprPtr($3);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER MINUS_EQ expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "-=";
            a->rhs = ExprPtr($3);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER STAR_EQ expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "*=";
            a->rhs = ExprPtr($3);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER SLASH_EQ expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "/=";
            a->rhs = ExprPtr($3);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER INCR
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "++";
            a->rhs = nullptr;
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | IDENTIFIER DECR
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "--";
            a->rhs = nullptr;
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    ;

call_stmt
    : IDENTIFIER '(' args ')'
        {
            auto* call = new CallExpr(std::string($1), std::move(*$3));
            delete $3;
            free($1);
            auto* e = new ExprStmt();
            e->expr = ExprPtr(call);
            e->line = yylineno;
            $$ = e;
        }
    | IDENTIFIER '(' ')'
        {
            auto* call = new CallExpr(std::string($1), {});
            free($1);
            auto* e = new ExprStmt();
            e->expr = ExprPtr(call);
            e->line = yylineno;
            $$ = e;
        }
    ;

print_stmt
    : PRINT '(' expression ')'
        {
            auto* p = new PrintStmt();
            p->expr = ExprPtr($3);
            p->line = yylineno;
            $$ = p;
        }
    ;

loop_stmt
    : LOOP '(' expression ')' '{' stmt_list '}'
        {
            auto* l = new LoopStmt();
            l->count = ExprPtr($3);
            for (auto& s : *$6) {
                l->body.push_back(std::move(s));
            }
            delete $6;
            l->line = yylineno;
            $$ = l;
        }
    ;

while_stmt
    : WHILE '(' expression ')' '{' stmt_list '}'
        {
            auto* w = new WhileStmt();
            w->condition = ExprPtr($3);
            for (auto& s : *$6) {
                w->body.push_back(std::move(s));
            }
            delete $6;
            w->line = yylineno;
            $$ = w;
        }
    ;

for_stmt
    : FOR '(' for_init ';' expression ';' for_update ')' '{' stmt_list '}'
        {
            auto* f = new ForStmt();
            f->init = StmtPtr($3);
            f->condition = ExprPtr($5);
            f->update = StmtPtr($7);
            for (auto& s : *$10) {
                f->body.push_back(std::move(s));
            }
            delete $10;
            f->line = yylineno;
            $$ = f;
        }
    ;

for_init
    : var_decl    { $$ = $1; }
    | assign_stmt { $$ = $1; }
    ;

for_update
    : assign_stmt { $$ = $1; }
    ;

do_while_stmt
    : DO '{' stmt_list '}' WHILE '(' expression ')'
        {
            auto* d = new DoWhileStmt();
            for (auto& s : *$3) {
                d->body.push_back(std::move(s));
            }
            delete $3;
            d->condition = ExprPtr($7);
            d->line = yylineno;
            $$ = d;
        }
    ;

if_stmt
    : IF '(' expression ')' '{' stmt_list '}'
        {
            auto* n = new IfStmt();
            n->condition = ExprPtr($3);
            for (auto& s : *$6) {
                n->then_body.push_back(std::move(s));
            }
            delete $6;
            n->has_else = false;
            n->line = yylineno;
            $$ = n;
        }
    | IF '(' expression ')' '{' stmt_list '}' ELSE '{' stmt_list '}'
        {
            auto* n = new IfStmt();
            n->condition = ExprPtr($3);
            for (auto& s : *$6) {
                n->then_body.push_back(std::move(s));
            }
            delete $6;
            for (auto& s : *$10) {
                n->else_body.push_back(std::move(s));
            }
            delete $10;
            n->has_else = true;
            n->line = yylineno;
            $$ = n;
        }
    | IF '(' expression ')' '{' stmt_list '}' ELSE if_stmt
        {
            auto* n = new IfStmt();
            n->condition = ExprPtr($3);
            for (auto& s : *$6) {
                n->then_body.push_back(std::move(s));
            }
            delete $6;
            n->else_body.push_back(StmtPtr($9));
            n->has_else = true;
            n->line = yylineno;
            $$ = n;
        }
    ;

return_stmt
    : RETURN expression
        {
            auto* r = new ReturnStmt();
            r->value = ExprPtr($2);
            r->line = yylineno;
            $$ = r;
        }
    | RETURN
        {
            auto* r = new ReturnStmt();
            r->value = nullptr;
            r->line = yylineno;
            $$ = r;
        }
    ;

param_type
    : TYPE_INT     { $$ = TypeKind::Int; }
    | TYPE_DECIMAL { $$ = TypeKind::Decimal; }
    | TYPE_TEXT    { $$ = TypeKind::Text; }
    | TYPE_BOOL    { $$ = TypeKind::Bool; }
    | TYPE_CHAR    { $$ = TypeKind::Char; }
    | TYPE_BYTE    { $$ = TypeKind::Byte; }
    ;

param_list
    : param_list ',' IDENTIFIER ':' param_type
        {
            $1->push_back({std::string($3), $5});
            free($3);
            $$ = $1;
        }
    | IDENTIFIER ':' param_type
        {
            auto* v = new std::vector<FunctionDecl::Param>();
            v->push_back({std::string($1), $3});
            free($1);
            $$ = v;
        }
    ;

fn_decl
    : FN IDENTIFIER '(' ')' '{' stmt_list '}'
        {
            auto* f = new FunctionDecl();
            f->name = $2;
            for (auto& s : *$6) {
                f->body.push_back(std::move(s));
            }
            delete $6;
            f->has_return_type = false;
            f->line = yylineno;
            free($2);
            $$ = f;
        }
    | FN IDENTIFIER '(' ')' ARROW param_type '{' stmt_list '}'
        {
            auto* f = new FunctionDecl();
            f->name = $2;
            f->has_return_type = true;
            f->return_type = $6;
            for (auto& s : *$8) {
                f->body.push_back(std::move(s));
            }
            delete $8;
            f->line = yylineno;
            free($2);
            $$ = f;
        }
    | FN IDENTIFIER '(' param_list ')' '{' stmt_list '}'
        {
            auto* f = new FunctionDecl();
            f->name = $2;
            f->params = *$4;
            delete $4;
            for (auto& s : *$7) {
                f->body.push_back(std::move(s));
            }
            delete $7;
            f->has_return_type = false;
            f->line = yylineno;
            free($2);
            $$ = f;
        }
    | FN IDENTIFIER '(' param_list ')' ARROW param_type '{' stmt_list '}'
        {
            auto* f = new FunctionDecl();
            f->name = $2;
            f->params = *$4;
            delete $4;
            f->has_return_type = true;
            f->return_type = $7;
            for (auto& s : *$9) {
                f->body.push_back(std::move(s));
            }
            delete $9;
            f->line = yylineno;
            free($2);
            $$ = f;
        }
    ;

expression
    : conditional
        {
            $$ = $1;
        }
    ;

conditional
    : logical_or '?' expression ':' expression
        {
            $$ = new ConditionalExpr(ExprPtr($1), ExprPtr($3), ExprPtr($5));
        }
    | logical_or
        {
            $$ = $1;
        }
    ;

logical_or
    : logical_or OR logical_and
        {
            $$ = new BinaryExpr("||", ExprKind::Logical, ExprPtr($1), ExprPtr($3));
        }
    | logical_and
        {
            $$ = $1;
        }
    ;

logical_and
    : logical_and AND equality
        {
            $$ = new BinaryExpr("&&", ExprKind::Logical, ExprPtr($1), ExprPtr($3));
        }
    | equality
        {
            $$ = $1;
        }
    ;

equality
    : equality EQ relational
        {
            $$ = new BinaryExpr("==", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | equality NEQ relational
        {
            $$ = new BinaryExpr("!=", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | relational
        {
            $$ = $1;
        }
    ;

relational
    : relational LT additive
        {
            $$ = new BinaryExpr("<", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | relational GT additive
        {
            $$ = new BinaryExpr(">", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | relational LEQ additive
        {
            $$ = new BinaryExpr("<=", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | relational GEQ additive
        {
            $$ = new BinaryExpr(">=", ExprKind::Comparison, ExprPtr($1), ExprPtr($3));
        }
    | additive
        {
            $$ = $1;
        }
    ;

additive
    : additive '+' term
        {
            $$ = new BinaryExpr("+", ExprKind::Arithmetic, ExprPtr($1), ExprPtr($3));
        }
    | additive '-' term
        {
            $$ = new BinaryExpr("-", ExprKind::Arithmetic, ExprPtr($1), ExprPtr($3));
        }
    | term
        {
            $$ = $1;
        }
    ;

term
    : term '*' factor
        {
            $$ = new BinaryExpr("*", ExprKind::Arithmetic, ExprPtr($1), ExprPtr($3));
        }
    | term '/' factor
        {
            $$ = new BinaryExpr("/", ExprKind::Arithmetic, ExprPtr($1), ExprPtr($3));
        }
    | factor
        {
            $$ = $1;
        }
    ;

factor
    : NUMBER
        {
            $$ = new NumberLiteral($1);
        }
    | DECIMAL
        {
            $$ = new DecimalLiteral($1);
        }
    | STRING
        {
            auto* s = new StringLiteral(std::string($1));
            free($1);
            $$ = s;
        }
    | CHAR
        {
            auto* c = new CharLiteral($1[0]);
            free($1);
            $$ = c;
        }
    | TRUE
        {
            $$ = new BoolLiteral(true);
        }
    | FALSE
        {
            $$ = new BoolLiteral(false);
        }
    | NOT factor
        {
            $$ = new NotExpr(ExprPtr($2));
        }
    | IDENTIFIER
        {
            auto* id = new Identifier(std::string($1));
            free($1);
            $$ = id;
        }
    | IDENTIFIER '(' args ')'
        {
            auto* call = new CallExpr(std::string($1), std::move(*$3));
            delete $3;
            free($1);
            $$ = call;
        }
    | IDENTIFIER '(' ')'
        {
            auto* call = new CallExpr(std::string($1), {});
            free($1);
            $$ = call;
        }
    | factor AS TYPE_INT
        {
            $$ = new CastExpr(TypeKind::Int, ExprPtr($1));
        }
    | factor AS TYPE_DECIMAL
        {
            $$ = new CastExpr(TypeKind::Decimal, ExprPtr($1));
        }
    | '(' expression ')'
        {
            $$ = $2;
        }
    ;

args
    : args ',' expression
        {
            $1->push_back(ExprPtr($3));
            $$ = $1;
        }
    | expression
        {
            auto* v = new std::vector<ExprPtr>();
            v->push_back(ExprPtr($1));
            $$ = v;
        }
    ;

%%
