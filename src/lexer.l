%{
#include "parser.hpp"
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <climits>
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
"foreach"         { return FOREACH; }
"in"              { return IN; }
"for"             { return FOR; }
"while"           { return WHILE; }
"do"              { return DO; }
"switch"          { return SWITCH; }
"case"            { return CASE; }
"default"         { return DEFAULT; }
"print"           { return PRINT; }
"return"          { return RETURN; }
"break"           { return BREAK; }
"continue"        { return CONTINUE; }
"if"              { return IF; }
"else"            { return ELSE; }
"true"            { return TRUE; }
"false"           { return FALSE; }
"and"             { return AND; }
"or"              { return OR; }
"not"             { return NOT; }
"as"              { return AS; }
"use"             { return USE; }
"lambda"          { return LAMBDA; }
"struct"          { return STRUCT; }
"enum"            { return ENUM; }
"alias"           { return ALIAS; }
"defer"           { return DEFER; }
"try"             { return TRY; }
"catch"           { return CATCH; }

"int"             { return TYPE_INT; }
"decimal"         { return TYPE_DECIMAL; }
"text"            { return TYPE_TEXT; }
"bool"            { return TYPE_BOOL; }
"char"            { return TYPE_CHAR; }
"byte"            { return TYPE_BYTE; }

[0-9]+\.[0-9]+    { yylval.fval = atof(yytext); return DECIMAL; }
[0-9]+            {
    errno = 0;
    char* end = NULL;
    long long v = strtoll(yytext, &end, 10);
    if (errno == ERANGE || *end != '\0' || v > 2147483647LL) {
        fprintf(stderr,
            "Error [line %d]: integer literal '%s' out of range (max 2147483647)\n",
            yylineno, yytext);
        yyterminate();
    }
    yylval.ival = (int)v;
    return NUMBER;
}
\"([^"\\]|\\.)*\" {
    // Source is text, so a raw NUL byte is an error. Two things depend on
    // catching it here. strlen() stops at the NUL, so the old length arithmetic
    // ran off the match and malloc/memcpy saw a negative size -- malloc aborted
    // the compiler (found by the front-end fuzzer). And codegen copies the value
    // verbatim into a C string literal, where a raw NUL cannot survive. Write
    // "\0" (backslash-zero) for a NUL byte inside a string.
    if ((int)strlen(yytext) != yyleng) {
        fprintf(stderr,
            "Error [line %d]: NUL byte in source; write \\0 for a NUL byte\n",
            yylineno);
        yyterminate();
    }
    char* str = (char*)malloc(yyleng - 1);
    memcpy(str, yytext + 1, yyleng - 2);
    str[yyleng - 2] = '\0';
    yylval.sval = str;
    return STRING;
}

\'[^\'\\]\'        {
    // The same NUL rule as a string. strdup(yytext + 1) also made a 1-byte
    // allocation for a NUL and then wrote sval[1], one past the end.
    if (yytext[1] == '\0') {
        fprintf(stderr,
            "Error [line %d]: NUL byte in source; write \\0 for a NUL byte\n",
            yylineno);
        yyterminate();
    }
    yylval.sval = (char*)malloc(2);
    yylval.sval[0] = yytext[1];
    yylval.sval[1] = '\0';
    return CHAR;
}

([a-zA-Z_]|[^\x00-\x7F])([a-zA-Z0-9_]|[^\x00-\x7F])* { yylval.sval = strdup(yytext); return IDENTIFIER; }

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
"["               { return '['; }
"]"               { return ']'; }
"..."           { return ELLIPSIS; }
"->"            { return ARROW; }
"."             { return DOT; }
"+="              { return PLUS_EQ; }
"-="              { return MINUS_EQ; }
"*="              { return STAR_EQ; }
"/="              { return SLASH_EQ; }
"%="              { return MOD_EQ; }
"%"               { return '%'; }
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

\x00              {
    // A NUL outside any literal (one inside a string or char is caught by those
    // rules). Same reason: source is text.
    fprintf(stderr,
        "Error [line %d]: NUL byte in source; write \\0 for a NUL byte\n",
        yylineno);
    return 1;
}

.                 { fprintf(stderr, "Unexpected character: %s at line %d\n", yytext, yylineno); return 1; }

%%
