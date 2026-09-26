#!/usr/bin/env bash
# CLI behaviour tests for the hmx command (M9 hardening):
#   default-run, run/build, -o, -keep-c, -h/--help, --version,
#   `hmx new`, unknown options, wrong-arg handling and exit codes.
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="$(pwd)/build/hmx"
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
check "build produces binary"             0     "Built: hello"    "$BIN" build hello.hmx -o hello_app
[ -x hello_app ] && PASS=$((PASS+1)) && echo "PASS (CLI): build binary exists & executable" || { echo "FAIL (CLI): build binary exists"; FAIL=$((FAIL+1)); }
[ "$(./hello_app)" = "hello" ] && PASS=$((PASS+1)) && echo "PASS (CLI): built binary runs" || { echo "FAIL (CLI): built binary runs"; FAIL=$((FAIL+1)); }

check "--version prints semver"           0     "hmx 0.9.0"       "$BIN" --version
check "-v prints semver"                  0     "hmx 0.9.0"       "$BIN" -v
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