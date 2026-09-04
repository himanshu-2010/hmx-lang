#include "ast.hpp"

std::string type_to_c(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "double";
        case TypeKind::Text:    return "char*";
        case TypeKind::Bool:    return "int";
        default:                return "void";
    }
}

std::string type_to_format(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "%d";
        case TypeKind::Decimal: return "%f";
        case TypeKind::Text:    return "%s";
        case TypeKind::Bool:    return "%d";
        default:                return "%d";
    }
}

std::string type_to_string(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "decimal";
        case TypeKind::Text:    return "text";
        case TypeKind::Bool:    return "bool";
        default:                return "unknown";
    }
}
