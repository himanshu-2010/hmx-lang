#!/usr/bin/env bash
# Packaging manifest consistency gate.
#
#   ./tests/run_packaging_tests.sh
#
# The release version and the download URLs are duplicated across nine files
# (CMakeLists, main.cpp, install.sh, install.ps1, PKGBUILD, the brew formula,
# the Scoop manifest, the winget manifest and the release workflow). Nothing
# used to check that they agreed, so a version bump silently left every
# installer pointing at an asset that does not exist — which is exactly how
# apt/pacman/AUR ended up 404ing with no visible cause.
#
# This gate is offline by design: it validates the manifests against each
# other and against CMakeLists, so it runs in CI without a network. It cannot
# prove a release was actually published; that is what the docs table and the
# `install.sh` checksum verification are for.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"

PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS (PKG): $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL (PKG): $1"; [ $# -gt 1 ] && echo "$2" | sed 's/^/   /'; }
check() { # check <name> <file> <pattern>  — pattern must occur in file
    local name="$1" file="$2" pat="$3"
    if [ ! -f "$REPO/$file" ]; then bad "$name" "missing file: $file"; return; fi
    if grep -qE "$pat" "$REPO/$file"; then ok "$name"
    else bad "$name" "no /$pat/ in $file"; fi
}
reject() { # reject <name> <file> <pattern> — pattern must NOT occur
    local name="$1" file="$2" pat="$3"
    if [ ! -f "$REPO/$file" ]; then bad "$name" "missing file: $file"; return; fi
    if grep -qE "$pat" "$REPO/$file"; then bad "$name" "/$pat/ found in $file"
    else ok "$name"; fi
}

# ── The single source of truth ───────────────────────────────
VERSION="$(sed -n 's/^project(hmx VERSION \([0-9][0-9.]*\).*/\1/p' CMakeLists.txt)"
if [ -n "$VERSION" ]; then ok "CMakeLists declares a project(VERSION)"
else bad "CMakeLists declares a project(VERSION)"; fi
# A major.minor.patch triple, nothing looser.
if printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    ok "version is a full semver triple ($VERSION)"
else
    bad "version is a full semver triple" "got '$VERSION'"
fi

V="$VERSION"   # shorthand for use inside double-quoted patterns

# ── 1) Every manifest agrees with that version ───────────────
check "main.cpp fallback matches"        src/main.cpp                 "#define HMX_VERSION \"$V\""
check "PKGBUILD pkgver matches"         packaging/arch/PKBUILD       "^pkgver=$V\$"
check "brew formula tag matches"        packaging/brew/hmx.rb        "tag: \"v$V\""
check "brew formula test matches"       packaging/brew/hmx.rb        "assert_match \"hmx $V\""
check "Scoop version matches"           packaging/scoop/hmx.json     "\"version\": \"$V\""
check "winget PackageVersion matches"   packaging/winget/hmx.installer.yaml "^PackageVersion: $V\$"

# No stale version literals anywhere in the packaging surface.
stale=""
for f in CMakeLists.txt src/main.cpp install/install.sh install/install.ps1 \
         packaging/arch/PKBUILD packaging/brew/hmx.rb \
         packaging/scoop/hmx.json packaging/winget/hmx.installer.yaml; do
    if grep -oE 'v?0\.[0-9]+\.[0-9]+' "$REPO/$f" | grep -vxE "v?$V" | grep -q .; then
        stale="$stale $f"
    fi
done
if [ -z "$stale" ]; then ok "no stale version literals in packaging files"
else bad "no stale version literals in packaging files" "offending:$stale"; fi

# ── 2) No placeholders survive ───────────────────────────────
# 'SKIP' is what AUR, Scoop and winget all reject: each needs a real digest
# (or, for a VCS source, a pinned tag) or the manifest is unusable. Match the
# assignment, not the word, so the explanatory comments can still say SKIP.
reject "PKGBUILD has no SKIP digest"        packaging/arch/PKBUILD            "sha256sums=\('SKIP'\)"
reject "Scoop has no SKIP digest"           packaging/scoop/hmx.json          '"hash": *"SKIP"'
reject "winget has no SKIP digest"          packaging/winget/hmx.installer.yaml '^ *InstallerSha256: *SKIP'

# The PKGBUILD digest must be a 64-hex sha256, not prose.
sha="$(sed -n "s/^sha256sums=('\([0-9a-f]*\)')$/\1/p" "$REPO/packaging/arch/PKBUILD" | head -1)"
if printf '%s' "$sha" | grep -qE '^[0-9a-f]{64}$'; then
    ok "PKGBUILD sha256sums is a real digest"
else
    bad "PKGBUILD sha256sums is a real digest" "got '$sha' — set it to the v$V source tarball's sha256"
fi

# ── 3) URLs point at assets the release actually produces ────
# The release workflow names its artifacts hmx-<ver>-<label>.<ext> with
# labels linux-x86_64 / macos-arm64 / windows-x86_64, plus
# hmx_<ver>_amd64.deb. A manifest that guesses a different shape resolves to
# a 404 no matter how well the build works.
check "Scoop URL matches the release asset"   packaging/scoop/hmx.json \
      "releases/download/v$V/hmx-$V-windows-x86_64\\.zip"
check "winget URL matches the release asset" packaging/winget/hmx.installer.yaml \
      "releases/download/v$V/hmx-$V-windows-x86_64\\.zip"
check "install.sh .deb name matches"          install/install.sh \
      "hmx_\\\$\{VERSION\}_amd64\\.deb|hmx_\\\$\{V\}_amd64\\.deb"
check "install.sh tarball name matches"       install/install.sh \
      "hmx-\\\$\{VERSION\}-\\\$\{platform\}\\.tar\\.gz"
check "install.ps1 zip name matches"          install/install.ps1 \
      "hmx-\\\$VERSION-windows-x86_64\\.zip"
check "PKGBUILD tag URL matches"              packaging/arch/PKBUILD \
      "refs/tags/v\\\$\{pkgver\}\\.tar\\.gz"

# ── 4) Asset names in the workflow match the manifests ───────
check "release workflow builds a Linux deb"   .github/workflows/release.yml \
      'hmx_?\$\{ver\}?_?amd64\.deb|cpack -G DEB'
check "release workflow publishes SHA256SUMS" .github/workflows/release.yml \
      'SHA256SUMS'
check "release workflow can be re-cut by hand" .github/workflows/release.yml \
      'workflow_dispatch'
check "release jobs have a timeout"           .github/workflows/release.yml \
      'timeout-minutes:'

# ── 5) Runtime dependencies are declared honestly ────────────
# hmx transpiles to C and shells out to the C compiler, so a package that
# does not depend on one is broken for its users.
for f in packaging/arch/PKBUILD; do
    check "$f depends on a C compiler" "$f" "depends=\(.*gcc"
    check "$f depends on flex/bison"    "$f" "depends=\(.*flex"
done
check "brew formula depends on gcc"  packaging/brew/hmx.rb 'depends_on "gcc"'
check "CPack deb depends on gcc"     CMakeLists.txt        'CPACK_DEBIAN_PACKAGE_DEPENDS "gcc"'

# ── 6) One contact address across the metadata ───────────────
EMAIL="himanshujsr462@gmail.com"
for f in CMakeLists.txt packaging/arch/PKBUILD; do
    check "$f uses the project contact address" "$f" "$EMAIL"
done
reject "no superseded contact address" CMakeLists.txt "himanshu2010\.dev@gmail\.com"
reject "no superseded contact address (PKGBUILD)" packaging/arch/PKBUILD "himanshu2010\.dev@gmail\.com"

# ── 7) Installers verify what they download ──────────────────
check "install.sh verifies checksums" install/install.sh   'SHA256SUMS'
check "install.sh refuses a bad digest" install/install.sh 'checksum mismatch'
check "install.ps1 verifies checksums" install/install.ps1 'SHA256SUMS'
check "install.ps1 refuses a bad digest" install/install.ps1 'checksum mismatch'
check "installers resolve the latest release" install/install.sh 'releases/latest'
check "install.ps1 resolves the latest release" install/install.ps1 'releases/latest'

# ── 8) CI covers the platforms the release ships ─────────────
check "CI builds on macOS"   .github/workflows/ci.yml "runs-on: macos-14"
check "CI builds on Windows" .github/workflows/ci.yml "runs-on: windows-latest"
check "CI runs the packaging gate" .github/workflows/ci.yml 'run_packaging_tests\.sh'

# ── 9) The container image is actually built, tagged and pushed ──
# The image job was broken for its whole life in a way that read like a Docker
# fault: `tags=` written three times to $GITHUB_OUTPUT keeps only the last, so
# the image was built and pushed as `:sha-<short>` alone — `:0.10.0` and
# `:latest` never existed — and the smoke test then read an empty tag and died
# on "invalid reference format". Both halves are checked statically below.
check "container image is multi-stage"      Dockerfile 'FROM .* AS build'
check "container image carries a C compiler" Dockerfile 'gcc'
check "container tags use the heredoc form" .github/workflows/container.yml 'tags<<HMX_TAGS_EOF'
reject "no repeated tags= output keys"     .github/workflows/container.yml 'echo "tags='
check "container smoke test names the image" .github/workflows/container.yml 'no image tag derived'
check "container smoke test checks the exit code" .github/workflows/container.yml 'exit code did not propagate'
# The tag list is multi-line, so it has to arrive via env: an expression spliced
# into a `run:` body is a script-injection hazard as well as unreadable.
check "container smoke test reads tags from env" .github/workflows/container.yml 'TAGS: \$\{\{ steps\.meta\.outputs\.tags \}\}'
check "container workflow watches v\* tags" .github/workflows/container.yml '\- "v\*"'
check "container workflow pushes the image" .github/workflows/container.yml 'push: true'

echo
if [ "$FAIL" -eq 0 ]; then
    echo "Packaging Tests Passed: $PASS, Failed: 0  (version $VERSION)"
    exit 0
fi
echo "Packaging Tests Passed: $PASS, Failed: $FAIL  (version ${VERSION:-?})"
exit 1
