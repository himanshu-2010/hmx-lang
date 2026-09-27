#!/usr/bin/env bash
# CLI behaviour tests for the hmx command (M9 hardening):
#   default-run, run/build, -o, -keep-c, -h/--help, --version,
#   `hmx new`, unknown options, wrong-arg handling and exit codes.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
BIN="$REPO/build/hmx"
TMPDIR="/tmp/hmx_cli_tests"
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"
cd "$TMPDIR"

PASS=0
FAIL=0

check() { # check <name> <expected_exit> <expected_stdout_substring> <cmd...>
    local name="$1" want_exit="$2" want_out="$3"
    shift 3
    local actual=""
    local code=0
    set +e
    actual=$("$@" 2>&1)
    code=$?
    set -e
    if [ "$code" = "$want_exit" ]; then
        if [ -z "$want_out" ] || printf '%s' "$actual" | grep -qF "$want_out"; then
            echo "PASS (CLI): $name"
            PASS=$((PASS+1))
            return
        fi
    fi
    echo "FAIL (CLI): $name  (exit=$code, wanted=$want_exit)"
    echo "$actual" | sed 's/^/   /'
    FAIL=$((FAIL+1))
}

printf 'fn main() {\n    print("hello")\n}\n' > hello.hmx
printf 'fn main() -> int {\n    return 42\n}\n' > exit42.hmx

check "bare-file defaults to run"         0     "hello"           "$BIN" hello.hmx
check "explicit run"                      0     "hello"           "$BIN" run hello.hmx
check "run -keep-c leaves .c behind"      0     "hello"           "$BIN" run hello.hmx -keep-c
[ -f build_temp.c ] && PASS=$((PASS+1)) && echo "PASS (CLI): -keep-c wrote build_temp.c" || { echo "FAIL (CLI): -keep-c wrote build_temp.c"; FAIL=$((FAIL+1)); }

check "exit code propagates"              42    ""                "$BIN" exit42.hmx

# Audit finding #2: a genuine signal death must be diagnosed (not masked).
# POSIX only: the Windows run path goes through system(), which has no
# WIFSIGNALED to inspect, so there is no signal to name there.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "SKIP (CLI): crash reports signal (POSIX-only run path)" ;;
    *)
        printf 'fn f(a: [int], n: int) -> int {\n    if (n == 0) { return 0 }\n    return f(a, n - 1) + a[n %% 5]\n}\nfn main() -> int {\n    let arr: [int] = [1, 2, 3, 4, 5]\n    return f(arr, 5000000)\n}\n' > crash.hmx
        check "crash reports signal + exit 139"   139   "program crashed with signal 11 (SIGSEGV)" "$BIN" run crash.hmx
        ;;
esac
check "build produces binary"             0     "Built: hello"    "$BIN" build hello.hmx -o hello_app
[ -x hello_app ] && PASS=$((PASS+1)) && echo "PASS (CLI): build binary exists & executable" || { echo "FAIL (CLI): build binary exists"; FAIL=$((FAIL+1)); }
[ "$(./hello_app)" = "hello" ] && PASS=$((PASS+1)) && echo "PASS (CLI): built binary runs" || { echo "FAIL (CLI): built binary runs"; FAIL=$((FAIL+1)); }

# The generated C must stay portable across the toolchains the release builds
# on. sd_read_line() used getline(), which is POSIX 2008 and absent from
# MinGW-w64, so every program calling input() failed to compile on Windows
# with "implicit declaration of function 'getline'". Nothing catches that on
# Linux — the generated C is compiled with the host gcc either way — so assert
# it here on the emitted source.
printf 'fn main() {\n    let a = input()\n    print(a, length(a))\n}\n' > stdin.hmx
printf 'hi\n' | "$BIN" build stdin.hmx -keep-c >/dev/null
posix_only="$(grep -oE '\b(getline|ssize_t|strdup|strndup|strcasecmp|fileno|isatty|popen|strtok_r|asprintf|getopt)\b' build_temp.c | sort -u | tr '\n' ' ' || true)"
if [ -n "$posix_only" ]; then
    echo "FAIL (CLI): generated C uses POSIX-only calls"
    echo "   found: $posix_only"
    FAIL=$((FAIL+1))
else
    echo "PASS (CLI): generated C has no POSIX-only calls"
    PASS=$((PASS+1))
fi
rm -f build_temp.c

# gcc does not warn about an unused statement-expression, clang does, so a
# builtin emitted as one and used as a statement (pop, which releases the array
# on its way out) passed silently on Linux and only surfaced as a stray
# -Wunused-value line on the macOS runner's stderr — breaking an exact-output
# test with a warning the user can do nothing about. Compile with the warning
# promoted to an error on *every* host compiler, not just the first one found:
# taking only `cc` means gcc, which never warns, hides the regression on the
# very platform whose silence caused it. An HMX expression statement's value is
# always discarded, so codegen casts it to void; this pins that.
printf 'fn main() {\n    let a = [1, 2, 3]\n    push(a, 4)\n    pop(a)\n    sort(a)\n    print(length(a))\n}\n' > stmts.hmx
"$BIN" build stmts.hmx -keep-c >/dev/null 2>&1
uv_checked=0
for c in cc gcc clang; do
    command -v "$c" >/dev/null 2>&1 || continue
    uv_checked=$((uv_checked+1))
    uv_out="$( "$c" -O2 -Werror=unused-value -fsyntax-only build_temp.c 2>&1 )" && uv_code=0 || uv_code=$?
    if [ "$uv_code" = 0 ]; then
        echo "PASS (CLI): generated C has no unused-value warning ($c)"
        PASS=$((PASS+1))
    else
        echo "FAIL (CLI): generated C warns about an unused value ($c)"
        echo "$uv_out" | sed 's/^/   /'
        FAIL=$((FAIL+1))
    fi
done
[ "$uv_checked" -gt 0 ] || echo "SKIP (CLI): no host C compiler for the unused-value check"
rm -f build_temp.c

# `hmx run` transpiles into the *current working directory*, so an unwritable
# cwd is a real failure mode — a Docker bind mount owned by another uid being
# the case that motivated it. Unchecked, the ofstream failed silently and gcc
# reported "cc1: fatal error: build_temp.c: No such file or directory", which
# blames the C compiler for a filesystem problem.
# The unreadable-source half matters too: the throwing std::filesystem::exists
# aborted with an unhandled filesystem_error and a `terminate` instead of
# printing anything at all.
# POSIX only — the mode bits and the uid that owns them mean nothing on Windows.
# `case`, not `[ "$(uname -s)" != "MINGW"* ]`: when a glob matches nothing bash
# leaves the word in place but marks it quoted, so `test` compares it literally
# and the prefix test silently returns "not equal" — on msys2 that ran both
# cases against a Windows filesystem, where chmod is a no-op, and they passed
# vacuously with exit 0. `case` pattern-matches the value itself.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    mkdir -p ro && cp hello.hmx ro/ && chmod 555 ro
    ro_out="$( cd ro && "$BIN" run hello.hmx 2>&1 )" && ro_code=0 || ro_code=$?
    chmod 755 ro
    if [ "$ro_code" = 1 ] && printf '%s' "$ro_out" | grep -qF "cannot write build_temp.c"; then
      echo "PASS (CLI): unwritable cwd is named, not blamed on the C compiler"
      PASS=$((PASS+1))
    else
      echo "FAIL (CLI): unwritable cwd is named (exit=$ro_code)"
      echo "$ro_out" | sed 's/^/   /'
      FAIL=$((FAIL+1))
    fi

    # An unreadable path must produce a diagnostic, never a crash: assert on the
    # absence of the terminate message, not just on the exit code, because an
    # abort also exits non-zero. The source is named by path rather than reached
    # with cd, because a mode-000 directory cannot be entered either.
    mkdir -p nolist && cp hello.hmx nolist/ && chmod 000 nolist
    nr_out="$( "$BIN" run nolist/hello.hmx 2>&1 )" && nr_code=0 || nr_code=$?
    chmod 755 nolist
    if [ "$nr_code" = 1 ] \
       && printf '%s' "$nr_out" | grep -qF "cannot access 'nolist/hello.hmx'" \
       && ! printf '%s' "$nr_out" | grep -qF "terminate called"; then
      echo "PASS (CLI): unreadable source is a diagnostic, not an abort"
      PASS=$((PASS+1))
    else
      echo "FAIL (CLI): unreadable source is a diagnostic, not an abort (exit=$nr_code)"
      echo "$nr_out" | sed 's/^/   /'
      FAIL=$((FAIL+1))
    fi

    # A #line filename is a C string literal, and a Windows path is full of
    # backslashes: "#line 2 "D:\hmx\main.hmx"" makes C read \h and \m as
    # unknown escapes, and the C compiler answers with a warning on the
    # program's stderr — which the stress suite compares byte for byte, so
    # every module test failed on Windows for that alone.
    #
    # The bug only shows up on a Windows path, but Windows cannot hold a
    # backslash in a filename, so the check runs *here* instead: a backslash is
    # a perfectly legal character in a Linux filename, and the emitted C is
    # the same either way. That inversion is deliberate — the gate has to be
    # somewhere that always runs, not where the symptom appears.
    cp hello.hmx 'back\slash.hmx' 2>/dev/null || true
    if [ -f 'back\slash.hmx' ]; then
      "$BIN" build 'back\slash.hmx' -keep-c >/dev/null 2>&1
      ln_checked=0
      for c in cc gcc clang; do
        command -v "$c" >/dev/null 2>&1 || continue
        ln_checked=$((ln_checked+1))
        ln_out="$( "$c" -O2 -fsyntax-only build_temp.c 2>&1 )" || true
        if printf '%s' "$ln_out" | grep -q "unknown escape sequence"; then
          echo "FAIL (CLI): #line filename is not escaped for a backslash path ($c)"
          printf '%s' "$ln_out" | grep "unknown escape" | head -3 | sed 's/^/   /'
          FAIL=$((FAIL+1))
        else
          echo "PASS (CLI): #line filename survives a backslash path ($c)"
          PASS=$((PASS+1))
        fi
      done
      [ "$ln_checked" -gt 0 ] || echo "SKIP (CLI): no host C compiler for the #line check"
      rm -f build_temp.c 'back\slash.hmx'
    else
      echo "SKIP (CLI): cannot create a backslash filename here"
    fi
    ;;
esac

# The version is pinned in exactly one place — CMakeLists' project(VERSION) —
# so a release bump can never leave this test asserting a stale string.
VERSION="$(sed -n 's/^project(hmx VERSION \([0-9][0-9.]*\).*/\1/p' "$REPO/CMakeLists.txt")"
[ -n "$VERSION" ] || { echo "FAIL (CLI): could not read VERSION from CMakeLists.txt"; exit 1; }
check "--version prints semver"           0     "hmx $VERSION"    "$BIN" --version
check "-v prints semver"                  0     "hmx $VERSION"    "$BIN" -v
check "--help lists usage"                0     "Usage:"          "$BIN" --help
check "-h lists commands"                 0     "run"             "$BIN" -h

check "new scaffolds a file"              0     "Created greet.hmx" "$BIN" new greet
[ -f greet.hmx ] && PASS=$((PASS+1)) && echo "PASS (CLI): greet.hmx created" || { echo "FAIL (CLI): greet.hmx created"; FAIL=$((FAIL+1)); }
check "new refuses to overwrite"          1     "already exists"  "$BIN" new greet
check "new with .hmx suffix"              0     "Created"         "$BIN" new sub.hmx

check "unknown option is rejected"        1     "unknown option"  "$BIN" hello.hmx --wat
check "missing file is an error"          1     "cannot open file" "$BIN" nope.hmx
check "non-hmx file is an error"          1     "expected .hmx"   "$BIN" hello.txt
check "no args prints usage"              1     "Usage:"          "$BIN"
check "run with no file errors"           1     "Usage:"          "$BIN" run
check "hmx new with no name errors"       1     "Usage: hmx new"  "$BIN" new
check "-o requires a path"                1     "requires a path" "$BIN" build hello.hmx -o

echo
echo "CLI Tests Passed: $PASS, Failed: $FAIL"
[ "$FAIL" -eq 0 ]