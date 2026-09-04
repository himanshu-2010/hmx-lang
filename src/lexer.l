%{
#include "parser.hpp"
#include <cstdlib>
#include <cstring>
%}

%option noyywrap nounput
%option yylineno
%x BLOCK_COMMENT

%%

[ \t\r\n]+        { /* skip whitespace */ }

"/*"              { BEGIN(BLOCK_COMMENT); }

<BLOCK_COMMENT>"*/"  { BEGIN(INITIAL); }
<BLOCK_COMMENT>.     { /* skip comment body */ }
<BLOCK_COMMENT>\n    { /* skip, yylineno advances automatically */ }
<BLOCK_COMMENT><<EOF>> {
    fprintf(stderr, "Error [line %d]: unterminated block comment\n", yylineno);
    yyterminate();
}

"//".*            { /* skip line comments */ }

"let"             { return LET; }
"const"           { return CONST; }
"fn"              { return FN; }
"loop"            { return LOOP; }
"for"             { return FOR; }
"while"           { return WHILE; }
"do"              { return DO; }
"print"           { return PRINT; }
"return"          { return RETURN; }
"if"              { return IF; }
"else"            { return ELSE; }
"true"            { return TRUE; }
"false"           { return FALSE; }
"and"             { return AND; }
"or"              { return OR; }
"not"             { return NOT; }
"as"              { return AS; }

"int"             { return TYPE_INT; }
"decimal"         { return TYPE_DECIMAL; }
"text"            { return TYPE_TEXT; }
"bool"            { return TYPE_BOOL; }

[0-9]+\.[0-9]+    { yylval.fval = atof(yytext); return DECIMAL; }
[0-9]+            { yylval.ival = atoi(yytext); return NUMBER; }
\"([^"\\]|\\.)*\" {
    int len = strlen(yytext);
    char* str = (char*)malloc(len - 1);
    memcpy(str, yytext + 1, len - 2);
    str[len - 2] = '\0';
    yylval.sval = str;
    return STRING;
}

[a-zA-Z_][a-zA-Z0-9_]* { yylval.sval = strdup(yytext); return IDENTIFIER; }

"{"               { return '{'; }
"}"               { return '}'; }
"("               { return '('; }
")"               { return ')'; }
";"               { return ';'; }
"+"               { return '+'; }
"-"               { return '-'; }
"*"               { return '*'; }
"/"               { return '/'; }
":"               { return ':'; }
"="               { return '='; }
","               { return ','; }
"?"               { return '?'; }
"->"              { return ARROW; }
"+="              { return PLUS_EQ; }
"-="              { return MINUS_EQ; }
"*="              { return STAR_EQ; }
"/="              { return SLASH_EQ; }
"++"              { return INCR; }
"--"              { return DECR; }
"=="              { return EQ; }
"!="              { return NEQ; }
"<"               { return LT; }
">"               { return GT; }
"<="              { return LEQ; }
">="              { return GEQ; }
"&&"              { return AND; }
"||"              { return OR; }
"!"               { return NOT; }

.                 { fprintf(stderr, "Unexpected character: %s at line %d\n", yytext, yylineno); return 1; }

%%
