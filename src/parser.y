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
    FunctionDecl::Param* param;   // single parameter (may carry default/variadic)
    std::vector<ExprPtr>* args;
    std::vector<SwitchCase>* cases;
    std::vector<TypeDesc>* tlist;
    std::vector<std::string>* strlist;
    IdList* idlist;
    DestructPattern* dpat;
    TypeDesc* tdesc;
}

%token LET CONST FN LOOP FOREACH IN FOR WHILE DO SWITCH CASE DEFAULT PRINT RETURN TRUE FALSE
%token IF ELSE
%token BREAK CONTINUE
%token TYPE_INT TYPE_DECIMAL TYPE_TEXT TYPE_BOOL TYPE_CHAR TYPE_BYTE
%token NUMBER DECIMAL STRING CHAR IDENTIFIER
%token EQ NEQ LT GT LEQ GEQ
%token AND OR NOT
%token PLUS_EQ MINUS_EQ STAR_EQ SLASH_EQ MOD_EQ INCR DECR
%token ARROW
%token LAMBDA
%token ELLIPSIS
%token AS
%token USE

%type <ival> NUMBER
%type <fval> DECIMAL
%type <sval> STRING CHAR IDENTIFIER
%type <expr> expression conditional logical_or logical_and equality relational additive term factor postfix_index
%type <stmt> statement var_decl assign_stmt print_stmt loop_stmt foreach_stmt while_stmt for_stmt do_while_stmt if_stmt switch_stmt return_stmt call_stmt fn_decl break_stmt continue_stmt
%type <stmt> for_init for_update
%type <params> param_list
%type <param> param
%type <args> args
%type <cases> case_list
%type <tlist> tuple_elem_list
%type <idlist> id_list
%type <dpat> pattern_item
%type <tdesc> param_type
%type <tlist> fn_type_params
%type <program> program
%type <stmts> stmt_list
%type <strlist> use_list
%type <sval> use_stmt

%%

program
    : use_list stmt_list
        {
            $$ = new Program();
            if ($1) {
                $$->use_files = std::move(*$1);
                delete $1;
            }
            for (auto& s : *$2) {
                $$->statements.push_back(std::move(s));
            }
            delete $2;
            g_program = $$;
        }
    ;

use_list
    : /* empty */
        {
            $$ = nullptr;
        }
    | use_list use_stmt
        {
            if ($1 == nullptr) {
                $1 = new std::vector<std::string>();
            }
            $1->push_back($2);
            $$ = $1;
        }
    ;

use_stmt
    : USE STRING         { $$ = $2; }
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
    | foreach_stmt { $$ = $1; }
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
            v->elem_desc = *$5;
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
    | LET IDENTIFIER ':' FN '(' fn_type_params ')' ARROW param_type '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Function;
            auto* info = new FunctionTypeInfo();
            info->params = std::move(*$6);
            delete $6;
            info->ret = *$9;
            delete $9;
            v->annotation_desc = TypeDesc{};
            v->annotation_desc.type = TypeKind::Function;
            v->annotation_desc.fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            v->is_mutable = true;
            v->initializer = ExprPtr($11);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET IDENTIFIER ':' FN '(' ')' ARROW param_type '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Function;
            auto* info = new FunctionTypeInfo();
            info->ret = *$8;
            delete $8;
            v->annotation_desc = TypeDesc{};
            v->annotation_desc.type = TypeKind::Function;
            v->annotation_desc.fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            v->is_mutable = true;
            v->initializer = ExprPtr($10);
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
            v->elem_desc = *$5;
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
    | CONST IDENTIFIER ':' FN '(' fn_type_params ')' ARROW param_type '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Function;
            auto* info = new FunctionTypeInfo();
            info->params = std::move(*$6);
            delete $6;
            info->ret = *$9;
            delete $9;
            v->annotation_desc = TypeDesc{};
            v->annotation_desc.type = TypeKind::Function;
            v->annotation_desc.fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            v->is_mutable = false;
            v->initializer = ExprPtr($11);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | CONST IDENTIFIER ':' FN '(' ')' ARROW param_type '=' expression
        {
            auto* v = new VarDecl();
            v->name = $2;
            v->has_annotation = true;
            v->annotation = TypeKind::Function;
            auto* info = new FunctionTypeInfo();
            info->ret = *$8;
            delete $8;
            v->annotation_desc = TypeDesc{};
            v->annotation_desc.type = TypeKind::Function;
            v->annotation_desc.fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            v->is_mutable = false;
            v->initializer = ExprPtr($10);
            v->line = yylineno;
            free($2);
            $$ = v;
        }
    | LET '(' id_list ')' '=' expression
        {
            auto* d = new DestructDecl();
            d->patterns = std::move($3->items);
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
    | postfix_index '[' expression ']' '=' expression
        {
            auto* a = new ElementAssignStmt();
            a->target = ExprPtr(new ArrayIndexExpr(ExprPtr($1), ExprPtr($3)));
            a->rhs = ExprPtr($6);
            a->line = yylineno;
            $$ = a;
        }
    | '(' id_list ')' '=' expression
        {
            auto* m = new MultiAssignStmt();
            m->patterns = std::move($2->items);
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
    : PRINT '(' args ')'
        {
            auto* p = new PrintStmt();
            p->args = std::move(*$3);
            delete $3;
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

foreach_stmt
    : FOREACH '(' IDENTIFIER IN expression ')' '{' stmt_list '}'
        {
            auto* f = new ForeachStmt();
            f->value_name = $3;
            free($3);
            f->iterable = ExprPtr($5);
            for (auto& s : *$8) {
                f->body.push_back(std::move(s));
            }
            delete $8;
            f->line = yylineno;
            $$ = f;
        }
    | FOREACH '(' IDENTIFIER ',' IDENTIFIER IN expression ')' '{' stmt_list '}'
        {
            auto* f = new ForeachStmt();
            f->index_name = $3;
            free($3);
            f->value_name = $5;
            free($5);
            f->iterable = ExprPtr($7);
            for (auto& s : *$10) {
                f->body.push_back(std::move(s));
            }
            delete $10;
            f->line = yylineno;
            $$ = f;
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
    : TYPE_INT     { $$ = new TypeDesc{TypeKind::Int, {}, {}, {}}; }
    | TYPE_DECIMAL { $$ = new TypeDesc{TypeKind::Decimal, {}, {}, {}}; }
    | TYPE_TEXT    { $$ = new TypeDesc{TypeKind::Text, {}, {}, {}}; }
    | TYPE_BOOL    { $$ = new TypeDesc{TypeKind::Bool, {}, {}, {}}; }
    | TYPE_CHAR    { $$ = new TypeDesc{TypeKind::Char, {}, {}, {}}; }
    | TYPE_BYTE    { $$ = new TypeDesc{TypeKind::Byte, {}, {}, {}}; }
    | '[' param_type ']'
        {
            $$ = new TypeDesc(TypeDesc::array_of(*$2));
            delete $2;
        }
    | '(' tuple_elem_list ')'
        {
            auto* td = new TypeDesc{TypeKind::Tuple, {}, {}, {}};
            td->tuple_members = std::move(*$2);
            delete $2;
            $$ = td;
        }
    | FN '(' fn_type_params ')' ARROW param_type
        {
            auto* td = new TypeDesc{TypeKind::Function, {}, {}, {}};
            auto* info = new FunctionTypeInfo();
            info->params = std::move(*$3);
            delete $3;
            info->ret = *$6;
            delete $6;
            td->fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            $$ = td;
        }
    | FN '(' ')' ARROW param_type
        {
            auto* td = new TypeDesc{TypeKind::Function, {}, {}, {}};
            auto* info = new FunctionTypeInfo();
            info->ret = *$5;
            delete $5;
            td->fn_info = std::shared_ptr<FunctionTypeInfo>(info);
            $$ = td;
        }
    ;

fn_type_params
    : fn_type_params ',' param_type
        {
            $1->push_back(*$3);
            delete $3;
            $$ = $1;
        }
    | param_type
        {
            auto* v = new std::vector<TypeDesc>();
            v->push_back(*$1);
            delete $1;
            $$ = v;
        }
    ;

tuple_elem_list
    : tuple_elem_list ',' param_type
        {
            $1->push_back(*$3);
            delete $3;
            $$ = $1;
        }
    | param_type ',' param_type
        {
            auto* v = new std::vector<TypeDesc>();
            v->push_back(*$1);
            v->push_back(*$3);
            delete $1;
            delete $3;
            $$ = v;
        }
    ;

id_list
    : id_list ',' pattern_item
        {
            $1->items.push_back(std::move(*$3));
            delete $3;
            $$ = $1;
        }
    | pattern_item ',' pattern_item
        {
            auto* v = new IdList();
            v->items.push_back(std::move(*$1));
            v->items.push_back(std::move(*$3));
            delete $1;
            delete $3;
            $$ = v;
        }
    ;

pattern_item
    : IDENTIFIER
        {
            auto* p = new DestructPattern();
            p->name = std::string($1);
            free($1);
            $$ = p;
        }
    | ELLIPSIS IDENTIFIER
        {
            auto* p = new DestructPattern();
            p->name = std::string($2);
            p->is_rest = true;
            free($2);
            $$ = p;
        }
    | '(' id_list ')'
        {
            auto* p = new DestructPattern();
            p->items = std::move($2->items);
            p->nested = true;
            delete $2;
            $$ = p;
        }
    ;

param_list
    : param_list ',' param
        {
            $1->push_back(std::move(*$3));
            delete $3;
            $$ = $1;
        }
    | param
        {
            auto* v = new std::vector<FunctionDecl::Param>();
            v->push_back(std::move(*$1));
            delete $1;
            $$ = v;
        }
    ;

param
    : IDENTIFIER ':' param_type
        {
            auto* p = new FunctionDecl::Param();
            p->name = std::string($1);
            p->type = $3->type;
            p->desc = *$3;
            if (p->type == TypeKind::Tuple) {
                p->tuple_members = std::move($3->tuple_members);
                p->desc.tuple_members = p->tuple_members;
            } else {
                p->elem_desc = $3->elem ? *$3->elem : TypeDesc{};
            }
            delete $3;
            free($1);
            $$ = p;
        }
    | IDENTIFIER ':' param_type '=' expression
        {
            auto* p = new FunctionDecl::Param();
            p->name = std::string($1);
            p->type = $3->type;
            p->desc = *$3;
            if (p->type == TypeKind::Tuple) {
                p->tuple_members = std::move($3->tuple_members);
                p->desc.tuple_members = p->tuple_members;
            } else {
                p->elem_desc = $3->elem ? *$3->elem : TypeDesc{};
            }
            p->default_value = ExprPtr($5);
            delete $3;
            free($1);
            $$ = p;
        }
    | IDENTIFIER ':' ELLIPSIS param_type
        {
            auto* p = new FunctionDecl::Param();
            p->name = std::string($1);
            p->type = TypeKind::Array;
            p->elem_desc = *$4;
            p->variadic = true;
            p->desc = TypeDesc::array_of(*$4);
            delete $4;
            free($1);
            $$ = p;
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
            f->return_elem = $6->elem ? *$6->elem : TypeDesc{};
            f->return_desc = *$6;
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
            f->params = std::move(*$4);
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
            f->params = std::move(*$4);
            delete $4;
            f->has_return_type = true;
            f->return_type = $7->type;
            f->return_elem = $7->elem ? *$7->elem : TypeDesc{};
            f->return_desc = *$7;
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
    | LAMBDA '(' ')' '{' stmt_list '}'
        {
            auto* lam = new LambdaExpr();
            lam->has_return_type = false;
            for (auto& s : *$5) {
                lam->body.push_back(std::move(s));
            }
            delete $5;
            lam->line = yylineno;
            $$ = lam;
        }
    | LAMBDA '(' ')' ARROW param_type '{' stmt_list '}'
        {
            auto* lam = new LambdaExpr();
            lam->has_return_type = true;
            lam->return_type = $5->type;
            lam->return_elem = $5->elem ? *$5->elem : TypeDesc{};
            lam->return_desc = *$5;
            if (lam->return_type == TypeKind::Tuple) lam->return_tuple_members = std::move($5->tuple_members);
            delete $5;
            for (auto& s : *$7) {
                lam->body.push_back(std::move(s));
            }
            delete $7;
            lam->line = yylineno;
            $$ = lam;
        }
    | LAMBDA '(' param_list ')' '{' stmt_list '}'
        {
            auto* lam = new LambdaExpr();
            lam->params = std::move(*$3);
            delete $3;
            lam->has_return_type = false;
            for (auto& s : *$6) {
                lam->body.push_back(std::move(s));
            }
            delete $6;
            lam->line = yylineno;
            $$ = lam;
        }
    | LAMBDA '(' param_list ')' ARROW param_type '{' stmt_list '}'
        {
            auto* lam = new LambdaExpr();
            lam->params = std::move(*$3);
            delete $3;
            lam->has_return_type = true;
            lam->return_type = $6->type;
            lam->return_elem = $6->elem ? *$6->elem : TypeDesc{};
            lam->return_desc = *$6;
            if (lam->return_type == TypeKind::Tuple) lam->return_tuple_members = std::move($6->tuple_members);
            delete $6;
            for (auto& s : *$8) {
                lam->body.push_back(std::move(s));
            }
            delete $8;
            lam->line = yylineno;
            $$ = lam;
        }
    | postfix_index
        {
            $$ = $1;
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
    | factor AS TYPE_BYTE
        {
            $$ = new CastExpr(TypeKind::Byte, ExprPtr($1));
        }
    | factor AS TYPE_CHAR
        {
            $$ = new CastExpr(TypeKind::Char, ExprPtr($1));
        }
    | '(' args ')'
        {
            if ($2->size() == 1) {
                $$ = (*$2)[0].release();
            } else {
                $$ = new TupleLiteral(std::move(*$2));
            }
            delete $2;
        }
    ;

postfix_index
    : IDENTIFIER '[' expression ']'
        {
            auto* idx = new ArrayIndexExpr(std::string($1), ExprPtr($3));
            free($1);
            $$ = idx;
        }
    | postfix_index '[' expression ']'
        {
            $$ = new ArrayIndexExpr(ExprPtr($1), ExprPtr($3));
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
