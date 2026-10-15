#!/usr/bin/env bash
#
# Front-end fuzzing: lexer -> parser -> type resolver.
#
#   ./tests/fuzz/run_fuzz.sh                 # 20000 inputs, fixed seed
#   ./tests/fuzz/run_fuzz.sh 100000          # more inputs
#   HMX_FUZZ_SEED=7 ./tests/fuzz/run_fuzz.sh # a different random stream
#   ./tests/fuzz/run_fuzz.sh --selftest      # prove the harness reports a crash
#
# Builds tests/fuzz/fuzz_frontend.cpp with Clang's libFuzzer into build-fuzz/ and
# runs a bounded number of inputs against a corpus seeded from the native
# fixtures, the examples, and a few deliberately malformed snippets. The run is
# seeded deterministically (-seed) so a crash reproduces; nothing here shells out
# to a C compiler, so it is quick and has no gcc dependency.
#
# Leak detection is off on purpose (ASAN_OPTIONS below): a syntax error does not
# reclaim the partial AST, which the real compiler sidesteps by exiting. The
# target hunts memory errors and crashes, not leaks -- valgrind covers those.
set -euo pipefail

cd "$(dirname "$0")/../.."
BUILD="build-fuzz"
CORPUS="$BUILD/corpus"
ARTIFACTS="$BUILD/artifacts"
RUNS="${HMX_FUZZ_RUNS:-20000}"
SEED="${HMX_FUZZ_SEED:-1}"

if [ "${1:-}" = "--selftest" ]; then
    SELFTEST=1
elif [ $# -ge 1 ]; then
    RUNS="$1"
    SELFTEST=0
else
    SELFTEST=0
fi

if ! command -v clang++ >/dev/null 2>&1; then
    echo "SKIP: clang++ not found; the fuzzer needs Clang's libFuzzer."
    echo "      (install clang, then re-run: ./tests/fuzz/run_fuzz.sh)"
    exit 0
fi

echo "building hmx_fuzz (clang++ libFuzzer, AddressSanitizer) ..."
cmake -S . -B "$BUILD" -DHMX_BUILD_FUZZER=ON -DCMAKE_CXX_COMPILER=clang++ >/dev/null
cmake --build "$BUILD" --target hmx_fuzz >/dev/null

mkdir -p "$CORPUS" "$ARTIFACTS"

# The self-test proves the *harness* can report a crashing input. Without it, a
# harness that never actually reached the front end would still look green.
if [ "$SELFTEST" = "1" ]; then
    printf 'FUZZ-selftest' > "$BUILD/selftest.bin"
    if HMX_FUZZ_SELFTEST=1 "$BUILD/hmx_fuzz" -runs=1 "$BUILD/selftest.bin" >/dev/null 2>&1; then
        echo "FAIL (fuzz): the self-test input did not crash; the harness reports nothing"
        exit 1
    fi
    echo "PASS (fuzz): the harness reports a crashing input (self-test)"
    exit 0
fi

# Seed the corpus. Valid programs (fixtures, examples) plus their truncations and
# a few malformed inputs give the fuzzer both the happy path and the error paths.
for f in tests/fixtures/*.hmx examples/*.hmx; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    cp "$f" "$CORPUS/$base"
    head -c 40 "$f" > "$CORPUS/trunc-$base" 2>/dev/null || true
done
: > "$CORPUS/empty.hmx"
printf 'let' > "$CORPUS/bare-let.hmx"
printf 'fn main() {' > "$CORPUS/unclosed-fn.hmx"
printf 'struct A { b: B }\nstruct B { a: A }\n' > "$CORPUS/value-cycle.hmx"
printf '/* unterminated' > "$CORPUS/block-comment.hmx"
# The fuzzer's first two finds: a raw NUL byte as the first byte of a string
# literal (negative memcpy size) and one in a char literal (1-byte overflow).
# Keeping them in the corpus means every run re-checks the fix.
printf 'fn main() { print("\000b") }\n' > "$CORPUS/raw-nul-string.hmx"
printf "fn main() { let c: char = '\000' }\n" > "$CORPUS/raw-nul-char.hmx"

export ASAN_OPTIONS="detect_leaks=0:abort_on_error=1"
echo "fuzzing $RUNS inputs (seed $SEED) over $(find "$CORPUS" -type f | wc -l) corpus seeds ..."
"$BUILD/hmx_fuzz" -seed="$SEED" -runs="$RUNS" -artifact_prefix="$ARTIFACTS/" "$CORPUS"
echo "fuzz: $RUNS inputs, seed $SEED, no crash"
