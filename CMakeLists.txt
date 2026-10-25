cmake_minimum_required(VERSION 3.16)
project(hmx VERSION 0.10.0 LANGUAGES C CXX)

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
    src/ir.cpp
    src/backend.cpp
    src/type_resolver.cpp
    src/codegen.cpp
    ${FLEX_Lexer_OUTPUTS}
    ${BISON_Parser_OUTPUTS}
)

# ── P2 (ADR 0004): shared runtime ────────────────────────────────────
# Built once here instead of being emitted inline into every generated
# build_temp.c. User programs include runtime/hxrt.h and link libhmxrt.a,
# which the compiler binary tells the host C compiler about through
# HMX_RUNTIME_INC / HMX_RUNTIME_LIB paths baked in at hmx's build time.
add_library(hmxrt STATIC runtime/hxrt.c)
target_include_directories(hmxrt PRIVATE ${CMAKE_SOURCE_DIR}/runtime)
add_dependencies(hmx hmxrt)
target_compile_definitions(hmx PRIVATE
    HMX_RUNTIME_INC="${CMAKE_SOURCE_DIR}/runtime"
    HMX_RUNTIME_LIB="$<TARGET_FILE:hmxrt>"
    HMX_RUNTIME_SRC="${CMAKE_SOURCE_DIR}/runtime/hxrt.c"
)

target_include_directories(hmx PRIVATE
    ${CMAKE_CURRENT_BINARY_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

target_compile_options(hmx PRIVATE -Wall -Wextra -Wpedantic)

target_compile_definitions(hmx PRIVATE HMX_VERSION="${PROJECT_VERSION}")

# ── Default backend (P4) ─────────────────────────────────────
# The direct-backend repo (hmx-compiler, marked by its roadmap doc) flips the
# default backend to the asm Tier A shim via HMX_DEFAULT_BACKEND=asm;
# hmx-lang keeps the full-language C emitter as its default until the asm
# backend reaches feature parity. The source stays identical in both repos —
# vendoring never changes this branch's outcome per repo.
if(EXISTS "${CMAKE_SOURCE_DIR}/docs/COMPILER_ROADMAP.md")
    target_compile_definitions(hmx PRIVATE HMX_DEFAULT_BACKEND="asm")
endif()

# ── Optional front-end fuzz target (Clang libFuzzer) ────────
# Off by default: GCC ships no libFuzzer, and the target is not part of a normal
# build. Enable it with Clang, e.g.
#   cmake -S . -B build-fuzz -DHMX_BUILD_FUZZER=ON -DCMAKE_CXX_COMPILER=clang++
#   cmake --build build-fuzz --target hmx_fuzz
# or simply run ./tests/fuzz/run_fuzz.sh, which does both.
option(HMX_BUILD_FUZZER "Build the libFuzzer front-end target (requires Clang)" OFF)

if(HMX_BUILD_FUZZER)
    if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
        message(FATAL_ERROR
            "HMX_BUILD_FUZZER=ON needs Clang (libFuzzer is Clang-only); "
            "configure with -DCMAKE_CXX_COMPILER=clang++.")
    endif()
    # The harness links the front end only: lexer -> parser -> resolver, no
    # codegen and no main.cpp, so libFuzzer supplies main and nothing shells out
    # to a C compiler.
    add_executable(hmx_fuzz
        tests/fuzz/fuzz_frontend.cpp
        src/ast.cpp
        src/type_resolver.cpp
        ${FLEX_Lexer_OUTPUTS}
        ${BISON_Parser_OUTPUTS}
    )
    target_include_directories(hmx_fuzz PRIVATE
        ${CMAKE_CURRENT_BINARY_DIR}
        ${CMAKE_SOURCE_DIR}/src
    )
    # -O1 is libFuzzer's recommended build level: it keeps symbols and frame
    # pointers usable while cutting stack frames enough that the recursive
    # front-end walks reach the parser's own nesting cap with room to spare.
    target_compile_options(hmx_fuzz PRIVATE
        -Wall -Wextra -O1 -g -fno-omit-frame-pointer -fsanitize=fuzzer,address)
    target_link_options(hmx_fuzz PRIVATE -fsanitize=fuzzer,address)
    # NOTE (dynamic_cast under the libFuzzer runtime) -- referenced from
    # src/ast.cpp. Some Clang libFuzzer runtimes
    # (libclang_rt.fuzzer-x86_64.a) statically bundle a libc++abi whose
    # __dynamic_cast disagrees with the libstdc++ typeinfo vtables the rest of
    # the binary is built against. The observed failure mode is that a
    # dynamic_cast to a *base* class (e.g. Statement*, Expression*, ASTNode*)
    # silently returns null, while a dynamic_cast to the object's exact type
    # still succeeds (Clang's own fast path, no runtime call). The front end is
    # therefore written to only ever cast to concrete node types -- see
    # gather_children()/gather_stmts() in src/ast.cpp -- and helpers that need a
    # base-class behaviour go through a virtual (ASTNode::source_line). Adding a
    # base-class dynamic_cast to the front end will compile and may pass a
    # non-fuzzer build, then silently misbehave under hmx_fuzz. If this runtime
    # is ever fixed upstream the constraint can be relaxed, but the concrete-cast
    # style is equally correct everywhere and costs nothing, so it stays.
endif()

# ── Install ─────────────────────────────────────────────────
include(GNUInstallDirs)
install(TARGETS hmx RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(TARGETS hmxrt ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(FILES ${CMAKE_SOURCE_DIR}/runtime/hxrt.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(FILES ${CMAKE_SOURCE_DIR}/LICENSE DESTINATION ${CMAKE_INSTALL_DOCDIR})

# ── Packaging (cpack -G DEB) ────────────────────────────────
set(CPACK_GENERATOR "DEB")
set(CPACK_PACKAGE_NAME "hmx")
set(CPACK_PACKAGE_VENDOR "HMX")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_PACKAGE_CONTACT "Himanshu Kumar <himanshujsr462@gmail.com>")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "HMX — a small statically typed systems language")
set(CPACK_PACKAGE_DESCRIPTION
    "HMX is a small statically typed systems language that transpiles to C. "
    "This package installs the hmx command-line compiler.")
set(CPACK_DEBIAN_PACKAGE_DEPENDS "gcc")
set(CPACK_DEBIAN_PACKAGE_SECTION "devel")
set(CPACK_DEBIAN_PACKAGE_PRIORITY "optional")
include(CPack)