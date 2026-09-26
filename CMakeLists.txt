cmake_minimum_required(VERSION 3.16)
project(hmx VERSION 0.9.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(FLEX REQUIRED)
find_package(BISON REQUIRED)

FLEX_TARGET(Lexer
    ${CMAKE_SOURCE_DIR}/src/lexer.l
    ${CMAKE_CURRENT_BINARY_DIR}/lexer.cpp
)
BISON_TARGET(Parser
    ${CMAKE_SOURCE_DIR}/src/parser.y
    ${CMAKE_CURRENT_BINARY_DIR}/parser.cpp
)
ADD_FLEX_BISON_DEPENDENCY(Lexer Parser)

add_executable(hmx
    src/main.cpp
    src/ast.cpp
    src/type_resolver.cpp
    src/codegen.cpp
    ${FLEX_Lexer_OUTPUTS}
    ${BISON_Parser_OUTPUTS}
)

target_include_directories(hmx PRIVATE
    ${CMAKE_CURRENT_BINARY_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

target_compile_options(hmx PRIVATE -Wall -Wextra -Wpedantic)

target_compile_definitions(hmx PRIVATE HMX_VERSION="${PROJECT_VERSION}")

# ── Install ─────────────────────────────────────────────────
include(GNUInstallDirs)
install(TARGETS hmx RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES ${CMAKE_SOURCE_DIR}/LICENSE DESTINATION ${CMAKE_INSTALL_DOCDIR})

# ── Packaging (cpack -G DEB) ────────────────────────────────
set(CPACK_GENERATOR "DEB")
set(CPACK_PACKAGE_NAME "hmx")
set(CPACK_PACKAGE_VENDOR "HMX")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_PACKAGE_CONTACT "Himanshu Kumar <himanshu2010.dev@gmail.com>")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "HMX — a small statically typed systems language")
set(CPACK_PACKAGE_DESCRIPTION
    "HMX is a small statically typed systems language that transpiles to C. "
    "This package installs the hmx command-line compiler.")
set(CPACK_DEBIAN_PACKAGE_DEPENDS "gcc")
set(CPACK_DEBIAN_PACKAGE_SECTION "devel")
set(CPACK_DEBIAN_PACKAGE_PRIORITY "optional")
include(CPack)