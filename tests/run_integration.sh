#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="build/stardance"
PASS=0
FAIL=0

for f in tests/fixtures/*.hmx; do
    name=$(basename "$f" .hmx)
    "$BIN" run "$f" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "PASS: $name"
        PASS=$((PASS+1))
    else
        echo "FAIL: $name"
        FAIL=$((FAIL+1))
    fi
done

echo ""
echo "Passed: $PASS, Failed: $FAIL"
[ $FAIL -eq 0 ]
