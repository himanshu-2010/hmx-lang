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
    std::vector<SwitchCase>* cases;
    std::vector<TypeDesc>* tlist;
    std::vector<std::string>* idlist;
    TypeDesc* tdesc;
}

%token LET CONST FN LOOP FOR WHILE DO SWITCH CASE DEFAULT PRINT RETURN TRUE FALSE
%token IF ELSE
%token BREAK CONTINUE
%token TYPE_INT TYPE_DECIMAL TYPE_TEXT TYPE_BOOL TYPE_CHAR TYPE_BYTE
%token NUMBER DECIMAL STRING CHAR IDENTIFIER
%token EQ NEQ LT GT LEQ GEQ
%token AND OR NOT
%token PLUS_EQ MINUS_EQ STAR_EQ SLASH_EQ MOD_EQ INCR DECR
%token ARROW
%token AS

%type <ival> NUMBER
%type <fval> DECIMAL
%type <sval> STRING CHAR IDENTIFIER
%type <expr> expression conditional logical_or logical_and equality relational additive term factor
%type <stmt> statement var_decl assign_stmt print_stmt loop_stmt while_stmt for_stmt do_while_stmt if_stmt switch_stmt return_stmt call_stmt fn_decl break_stmt continue_stmt
%type <stmt> for_init for_update
%type <params> param_list
%type <args> args
%type <cases> case_list
%type <tlist> tuple_elem_list
%type <idlist> id_list
%type <tdesc> param_type
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
    | switch_stmt  { $$ = $1; }
    | return_stmt  { $$ = $1; }
    | break_stmt   { $$ = $1; }
    | continue_stmt { $$ = $1; }
    | fn_decl      { $$ = $1; }
    ;

break_stmt
    : BREAK
        {
            auto* b = new BreakStmt();
            b->line = yylineno;
            $$ = b;
        }
    ;

continue_stmt
    : CONTINUE
        {
            auto* c = new ContinueStmt();
            c->line = yylineno;
            $$ = c;
        }
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
    | LET IDENTIFIER ':' '[' param_type ']' '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Array;
            v->array_element_type = $5->type;
            delete $5;
            v->is_mutable = true;
            v->initializer = ExprPtr($8);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' '(' tuple_elem_list ')' '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Tuple;
            v->tuple_members = std::move(*$5);
            delete $5;
            v->is_mutable = true;
            v->initializer = ExprPtr($8);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' '[' param_type ']' '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Array;
            v->array_element_type = $5->type;
            delete $5;
            v->is_mutable = false;
            v->initializer = ExprPtr($8);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' '(' tuple_elem_list ')' '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Tuple;
            v->tuple_members = std::move(*$5);
            delete $5;
            v->is_mutable = false;
            v->initializer = ExprPtr($8);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET '(' id_list ')' '=' expression
        {
            auto* d = new DestructDecl();
            d->names = std::move(*$3);
            delete $3;
            d->rhs = ExprPtr($6);
            d->is_mutable = true;
            d->line = yylineno;
            $$ = d;
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
    | IDENTIFIER MOD_EQ expression
        {
            auto* a = new AssignStmt();
            a->name = $1;
            a->op = "%=";
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
    | IDENTIFIER '[' expression ']' '=' expression
        {
            auto* a = new ArrayAssignStmt();
            a->name = $1;
            a->index = ExprPtr($3);
            a->rhs = ExprPtr($6);
            a->line = yylineno;
            free($1);
            $$ = a;
        }
    | '(' id_list ')' '=' expression
        {
            auto* m = new MultiAssignStmt();
            m->names = std::move(*$2);
            delete $2;
            m->rhs = ExprPtr($5);
            m->line = yylineno;
            $$ = m;
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

switch_stmt
    : SWITCH '(' expression ')' '{' case_list '}'
        {
            auto* s = new SwitchStmt();
            s->value = ExprPtr($3);
            s->cases = std::move(*$6);
            delete $6;
            s->line = yylineno;
            $$ = s;
        }
    ;

case_list
    : case_list CASE expression ':' stmt_list
        {
            SwitchCase c;
            c.value = ExprPtr($3);
            for (auto& stmt : *$5) c.body.push_back(std::move(stmt));
            delete $5;
            $1->push_back(std::move(c));
            $$ = $1;
        }
    | case_list DEFAULT ':' stmt_list
        {
            SwitchCase c;
            c.is_default = true;
            for (auto& stmt : *$4) c.body.push_back(std::move(stmt));
            delete $4;
            $1->push_back(std::move(c));
            $$ = $1;
        }
    | CASE expression ':' stmt_list
        {
            auto* cases = new std::vector<SwitchCase>();
            SwitchCase c;
            c.value = ExprPtr($2);
            for (auto& stmt : *$4) c.body.push_back(std::move(stmt));
            delete $4;
            cases->push_back(std::move(c));
            $$ = cases;
        }
    | DEFAULT ':' stmt_list
        {
            auto* cases = new std::vector<SwitchCase>();
            SwitchCase c;
            c.is_default = true;
            for (auto& stmt : *$3) c.body.push_back(std::move(stmt));
            delete $3;
            cases->push_back(std::move(c));
            $$ = cases;
        }
    ;

return_stmt
    : RETURN args
        {
            auto* r = new ReturnStmt();
            for (auto& e : *$2) {
                r->values.push_back(std::move(e));
            }
            delete $2;
            r->line = yylineno;
            $$ = r;
        }
    | RETURN
        {
            auto* r = new ReturnStmt();
            r->line = yylineno;
            $$ = r;
        }
    ;

param_type
    : TYPE_INT     { $$ = new TypeDesc{TypeKind::Int, TypeKind::Unknown, {}}; }
    | TYPE_DECIMAL { $$ = new TypeDesc{TypeKind::Decimal, TypeKind::Unknown, {}}; }
    | TYPE_TEXT    { $$ = new TypeDesc{TypeKind::Text, TypeKind::Unknown, {}}; }
    | TYPE_BOOL    { $$ = new TypeDesc{TypeKind::Bool, TypeKind::Unknown, {}}; }
    | TYPE_CHAR    { $$ = new TypeDesc{TypeKind::Char, TypeKind::Unknown, {}}; }
    | TYPE_BYTE    { $$ = new TypeDesc{TypeKind::Byte, TypeKind::Unknown, {}}; }
    | '[' param_type ']'
        {
            if ($2->type == TypeKind::Tuple) {
                yyerror("arrays of tuples are not supported");
            }
            $$ = new TypeDesc{TypeKind::Array, $2->type, {}};
            delete $2;
        }
    | '(' tuple_elem_list ')'
        {
            auto* td = new TypeDesc{TypeKind::Tuple, TypeKind::Unknown, {}};
            td->tuple_members = std::move(*$2);
            delete $2;
            $$ = td;
        }
    ;

tuple_elem_list
    : tuple_elem_list ',' param_type
        {
            if ($3->type == TypeKind::Tuple) {
                yyerror("nested tuple types are not supported");
            }
            $1->push_back(*$3);
            delete $3;
            $$ = $1;
        }
    | param_type ',' param_type
        {
            if ($1->type == TypeKind::Tuple || $3->type == TypeKind::Tuple) {
                yyerror("nested tuple types are not supported");
            }
            auto* v = new std::vector<TypeDesc>();
            v->push_back(*$1);
            v->push_back(*$3);
            delete $1;
            delete $3;
            $$ = v;
        }
    ;

id_list
    : id_list ',' IDENTIFIER
        {
            $1->push_back(std::string($3));
            free($3);
            $$ = $1;
        }
    | IDENTIFIER ',' IDENTIFIER
        {
            auto* v = new std::vector<std::string>();
            v->push_back(std::string($1));
            v->push_back(std::string($3));
            free($1);
            free($3);
            $$ = v;
        }
    ;

param_list
    : param_list ',' IDENTIFIER ':' param_type
        {
            FunctionDecl::Param p;
            p.name = std::string($3);
            p.type = $5->type;
            p.array_element_type = $5->element_type;
            if (p.type == TypeKind::Tuple) p.tuple_members = std::move($5->tuple_members);
            delete $5;
            $1->push_back(std::move(p));
            free($3);
            $$ = $1;
        }
    | IDENTIFIER ':' param_type
        {
            auto* v = new std::vector<FunctionDecl::Param>();
            FunctionDecl::Param p;
            p.name = std::string($1);
            p.type = $3->type;
            p.array_element_type = $3->element_type;
            if (p.type == TypeKind::Tuple) p.tuple_members = std::move($3->tuple_members);
            delete $3;
            v->push_back(std::move(p));
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
            f->return_type = $6->type;
            f->return_array_element_type = $6->element_type;
            if (f->return_type == TypeKind::Tuple) f->return_tuple_members = std::move($6->tuple_members);
            delete $6;
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
            f->return_type = $7->type;
            f->return_array_element_type = $7->element_type;
            if (f->return_type == TypeKind::Tuple) f->return_tuple_members = std::move($7->tuple_members);
            delete $7;
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
    | term '%' factor
        {
            $$ = new BinaryExpr("%", ExprKind::Arithmetic, ExprPtr($1), ExprPtr($3));
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
    | '-' factor
        {
            $$ = new NegExpr(ExprPtr($2));
        }
    | '+' factor
        {
            $$ = $2;
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
    | IDENTIFIER '[' expression ']'
        {
            auto* idx = new ArrayIndexExpr(std::string($1), ExprPtr($3));
            free($1);
            $$ = idx;
        }
    | '[' ']'
        {
            $$ = new ArrayLiteral({});
        }
    | '[' args ']'
        {
            auto* arr = new ArrayLiteral(std::move(*$2));
            delete $2;
            $$ = arr;
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
