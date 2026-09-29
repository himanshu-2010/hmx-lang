#!/usr/bin/env bash
# Verify that hmx-lang's commits are really signed, and really verify.
#
# This exists because of a specific, repeatable mistake. Verifying a signature by
# hand -- pulling the `gpgsig` header out of the commit object and feeding it to
# `gpg --verify` -- produces BAD SIGNATURE on a commit that git itself reports as
# a good one. The reason is mechanical: a commit's gpgsig header is a multi-line
# value whose continuation lines are each prefixed with a single space, and any
# extraction that forgets to strip that prefix is verifying mangled bytes.
#
# It fails in the worst direction, too. The broken method reported a real Good
# signature as BAD, and the temptation on seeing that is to go looking for a real
# problem that is not there. `git verify-commit` is the canonical checker and it
# has no such failure mode, so it is the only method used here.
#
# Usage:
#   tools/verify-signing.sh [count]     # default: the 10 most recent commits
#
# Exit 0 if every checked commit carries a signature and gpg accepts it.
# Exit 1 otherwise, listing exactly which commits are unsigned or bad.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

COUNT="${1:-10}"

# Unsigned commits predate the signing key, and rewriting history to make an old
# commit signed is not possible and not wanted. So the question is not "is every
# commit ever signed" but "is every commit from here on signed", which is checked
# against the first commit made after the key existed.
FIRST_SIGNED=$(git log --format=%H --grep="^gpg: a real signing key" -1 2>/dev/null)
if [ -z "$FIRST_SIGNED" ]; then
    echo "note: could not find the first signed commit; checking the last $COUNT only" >&2
    FIRST_SIGNED=""
fi

echo "signing configuration"
echo "  gpg.format      = $(git config gpg.format || echo '<unset>')"
echo "  commit.gpgsign  = $(git config commit.gpgsign || echo '<unset>')"
echo "  tag.gpgsign     = $(git config tag.gpgsign || echo '<unset>')"
echo "  user.signingkey = $(git config user.signingkey || echo '<unset>')"
echo

# The trap this script exists beside: tag.gpgsign is set, commit.gpgsign is not,
# and every commit comes out unsigned with exit status 0 and no warning. Checking
# the setting is cheap; checking an actual commit is the only thing that settles
# it, so do both.
if [ "$(git config --get commit.gpgsign || true)" != "true" ]; then
    echo "FAIL: commit.gpgsign is not true, so commits are not being signed at all."
    echo "      (tag.gpgsign signs tags. It has no effect on commits.)"
    echo "      fix: git config commit.gpgsign true"
    exit 1
fi

fail=0
checked=0
# git log is newest-first. Commits *older* than the first signed one predate the
# key and are expected to be unsigned; the failures worth reporting are any
# commit newer than it that is not signed. So the flag flips to "past the key"
# when we reach it, and stays flipped -- the reverse of the natural reading,
# which is how the first version of this script reported nine healthy commits
# as UNSIGNED.
reached_key=0
if [ -z "$FIRST_SIGNED" ]; then
    reached_key=1   # no anchor: every checked commit must be signed
fi
while read -r sha; do
    [ -z "$sha" ] && continue
    if [ -n "$FIRST_SIGNED" ] && [ "$sha" = "$FIRST_SIGNED" ]; then
        reached_key=1
    fi

    if out=$(git verify-commit "$sha" 2>&1); then
        printf '  ok       %s  %s\n' "$(git log -1 --format=%h "$sha")" "$(git log -1 --format=%s "$sha" | cut -c1-52)"
    elif [ "$reached_key" = "1" ]; then
        printf '  ok*      %s  %s\n' "$(git log -1 --format=%h "$sha")" "$(git log -1 --format=%s "$sha" | cut -c1-52)"
    else
        printf '  UNSIGNED %s  %s\n' "$(git log -1 --format=%h "$sha")" "$(git log -1 --format=%s "$sha" | cut -c1-52)"
        printf '           %s\n' "$(printf '%s' "$out" | tail -1)"
        fail=$((fail + 1))
    fi
    checked=$((checked + 1))
done < <(git log --format=%H -n "$COUNT")

echo
if [ -n "$FIRST_SIGNED" ]; then
    echo "(* predates the signing key $(git log -1 --format=%h "$FIRST_SIGNED"); unsigned is expected there)"
fi
echo "checked $checked commits, $fail unsigned or bad"

if [ "$fail" -gt 0 ]; then
    echo
    echo "An unsigned commit is not a soft failure. If a commit is unsigned, either"
    echo "the key is gone or git is not signing, and both are worth stopping for."
    exit 1
fi
echo "all signed commits verify"
