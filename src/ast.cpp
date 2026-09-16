#include "ast.hpp"

bool TypeDesc::operator==(const TypeDesc& other) const {
    return type == other.type &&
           element_type == other.element_type &&
           tuple_members == other.tuple_members;
}

bool TypeDesc::operator<(const TypeDesc& other) const {
    if (type != other.type) return type < other.type;
    if (element_type != other.element_type) return element_type < other.element_type;
    return tuple_members < other.tuple_members;
}

std::string type_to_c(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "double";
        case TypeKind::Text:    return "char*";
        case TypeKind::Bool:    return "int";
        case TypeKind::Char:    return "char";
        case TypeKind::Byte:    return "unsigned char";
        case TypeKind::Array:   return "sd_array";
        case TypeKind::Tuple:   return "sd_tuple";
        default:                return "void";
    }
}

std::string type_to_format(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "%d";
        case TypeKind::Decimal: return "%f";
        case TypeKind::Text:    return "%s";
        case TypeKind::Bool:    return "%d";
        case TypeKind::Char:    return "%c";
        case TypeKind::Byte:    return "%d";
        case TypeKind::Array:   return "%d";
        default:                return "%d";
    }
}

std::string type_to_string(TypeKind kind) {
    switch (kind) {
        case TypeKind::Int:     return "int";
        case TypeKind::Decimal: return "decimal";
        case TypeKind::Text:    return "text";
        case TypeKind::Bool:    return "bool";
        case TypeKind::Char:    return "char";
        case TypeKind::Byte:    return "byte";
        case TypeKind::Array:   return "array";
        case TypeKind::Tuple:   return "tuple";
        default:                return "unknown";
    }
}

std::string type_desc_to_string(const TypeDesc& desc) {
    if (desc.type == TypeKind::Array) {
        return "array of " + type_to_string(desc.element_type);
    }
    if (desc.type == TypeKind::Tuple) {
        return tuple_type_to_string(desc.tuple_members);
    }
    return type_to_string(desc.type);
}

std::string tuple_type_to_string(const std::vector<TypeDesc>& members) {
    if (members.empty()) return "tuple";
    std::string s = "(";
    for (size_t i = 0; i < members.size(); i++) {
        if (i > 0) s += ", ";
        s += type_desc_to_string(members[i]);
    }
    s += ")";
    return s;
}
