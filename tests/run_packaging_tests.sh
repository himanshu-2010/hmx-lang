#!/usr/bin/env bash
# Packaging manifest consistency gate.
#
#   ./tests/run_packaging_tests.sh
#
# The release version and the download URLs are duplicated across eleven files
# (CMakeLists, main.cpp, install.sh, install.ps1, PKGBUILD, the brew formula,
# the Scoop manifest, the three winget manifests and the release workflow).
# Nothing used to check that they agreed, so a version bump silently left every
# installer pointing at an asset that does not exist — which is exactly how
# apt/pacman/AUR ended up 404ing with no visible cause.
#
# Ten of those eleven are in the loop below. The release workflow is not, and
# cannot be: it deliberately mentions v0.9.0 in comments explaining the six-hour
# macOS stall and the keg-only PATH problem, so a literal scan flags history as
# staleness. Its one functional literal is the `e.g. v0.10.0` in the
# workflow_dispatch description, which is a help string, not a resolved version —
# the workflow takes the version from the tag. If that ever stops being true, the
# gate below will not notice; this comment is the warning.
#
# The count is not decoration. This list was "nine" until the winget manifest
# was split into its three required files, and the loop kept its old membership
# while the header kept its old number — so a bump updated the version
# manifest's siblings and left hmx.yaml and the locale manifest behind, and
# nothing noticed. Add a file that names the version to the loop, and update
# this sentence.
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
check "PKGBUILD pkgver matches"         packaging/arch/PKGBUILD       "^pkgver=$V\$"
check "brew formula tag matches"        packaging/brew/hmx.rb        "tag: \"v$V\""
check "brew formula test matches"       packaging/brew/hmx.rb        "assert_match \"hmx $V\""
check "Scoop version matches"           bucket/hmx.json     "\"version\": \"$V\""
check "winget PackageVersion matches"   packaging/winget/hmx.installer.yaml "^PackageVersion: $V\$"
check "winget version manifest matches" packaging/winget/hmx.yaml          "^PackageVersion: $V\$"

# No stale version literals anywhere in the packaging surface.
# Every file that names a version belongs in this list, and the winget tree is
# three files, not one: hmx.yaml and the locale manifest were missing here, so a
# version bump would have updated CMakeLists and the installer manifest and left
# the version behind in the other two. A manifest with a stale version submits
# cleanly and then resolves to nothing, which is worse than having no manifest.
stale=""
for f in CMakeLists.txt src/main.cpp install/install.sh install/install.ps1 \
         packaging/arch/PKGBUILD packaging/brew/hmx.rb \
         bucket/hmx.json \
         packaging/winget/hmx.yaml packaging/winget/hmx.installer.yaml \
         packaging/winget/hmx.locale.en-US.yaml; do
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
reject "PKGBUILD has no SKIP digest"        packaging/arch/PKGBUILD            "sha256sums=\('SKIP'\)"
reject "Scoop has no SKIP digest"           bucket/hmx.json          '"hash": *"SKIP"'
reject "winget has no SKIP digest"          packaging/winget/hmx.installer.yaml '^ *InstallerSha256: *SKIP'

# The PKGBUILD digest must be a 64-hex sha256, not prose.
sha="$(sed -n "s/^sha256sums=('\([0-9a-f]*\)')$/\1/p" "$REPO/packaging/arch/PKGBUILD" | head -1)"
if printf '%s' "$sha" | grep -qE '^[0-9a-f]{64}$'; then
    ok "PKGBUILD sha256sums is a real digest"
else
    bad "PKGBUILD sha256sums is a real digest" "got '$sha' — set it to the v$V source tarball's sha256"
fi

# The file itself must be named PKGBUILD. It was committed as `PKBUILD`, which
# is not a name makepkg accepts, and the docs' own `cp` command pointed at a
# path that did not exist. Nothing caught it: every check here referenced the
# same wrong path, so the gate agreed with the mistake.
if [ -f "$REPO/packaging/arch/$(printf 'PK%sBUILD' 'G')" ]; then
    ok "the AUR manifest file is named PKGBUILD"
else
    bad "the AUR manifest file is named PKGBUILD" "found: $(ls "$REPO/packaging/arch")"
fi

# DESTDIR is an environment variable; `cmake --install` has no --destdir flag
# and aborts with "Unknown argument". The manifest parses, the build succeeds
# and check() passes before this bites, so it only ever fails on a real Arch
# machine at the last step. Found by actually running makepkg.
reject "PKGBUILD does not pass a nonexistent --destdir flag" packaging/arch/PKGBUILD 'cmake --install[^|;]*--destdir'
check  "PKGBUILD sets DESTDIR in the environment"          packaging/arch/PKGBUILD 'DESTDIR="\$pkgdir" cmake --install'

# ── 3) URLs point at assets the release actually produces ────
# The release workflow names its artifacts hmx-<ver>-<label>.<ext> with
# labels linux-x86_64 / macos-arm64 / windows-x86_64, plus
# hmx_<ver>_amd64.deb. A manifest that guesses a different shape resolves to
# a 404 no matter how well the build works.
check "Scoop URL matches the release asset"   bucket/hmx.json \
      "releases/download/v$V/hmx-$V-windows-x86_64\\.zip"
check "winget URL matches the release asset" packaging/winget/hmx.installer.yaml \
      "releases/download/v$V/hmx-$V-windows-x86_64\\.zip"
check "install.sh .deb name matches"          install/install.sh \
      "hmx_\\\$\{VERSION\}_amd64\\.deb|hmx_\\\$\{V\}_amd64\\.deb"
check "install.sh tarball name matches"       install/install.sh \
      "hmx-\\\$\{VERSION\}-\\\$\{platform\}\\.tar\\.gz"
check "install.ps1 zip name matches"          install/install.ps1 \
      "hmx-\\\$VERSION-windows-x86_64\\.zip"
check "PKGBUILD tag URL matches"              packaging/arch/PKGBUILD \
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
# does not depend on one is broken for its users. The flip side matters just as
# much: flex, bison and cmake are needed to *build* hmx, never to run it, and
# Arch installs runtime deps on the user's machine for good.
#
# The `^depends=` anchor is load-bearing. Without it the pattern also matches
# "makedepends=(", because `.*` happily spans the intervening entries — so a
# check written that way passes for flex sitting in makedepends while claiming
# to assert the opposite.
check "PKGBUILD runtime-depends on a C compiler" packaging/arch/PKGBUILD '^depends=\(.+gcc'
for t in flex bison cmake; do
    check "PKGBUILD build-depends on $t" packaging/arch/PKGBUILD "^makedepends=\(.*$t"
    reject "PKGBUILD does not runtime-depend on $t" packaging/arch/PKGBUILD "^depends=\(.*$t"
done
check "brew formula depends on gcc"  packaging/brew/hmx.rb 'depends_on "gcc"'
# brew's gcc is keg-only, so `depends_on "gcc"` does NOT put a C compiler on
# PATH. The installed binary transpiles to C and shells out to gcc/cc/clang at
# runtime, so the caveat is the only thing telling the user to install one --
# drop it and the install "succeeds" into a hmx that cannot compile anything.
check "brew formula caveats about the runtime C compiler" packaging/brew/hmx.rb 'C compiler \(gcc, cc or clang\) must be on PATH'
# The formula deliberately has no `revision:`; the comment above it explains that
# a stale one makes brew fail with "revision is no longer part of the
# repository". Nothing stops someone adding one back with a value that has
# since been deleted, and the failure is famously unhelpful.
reject "brew formula has no revision: to pin a moved tag" packaging/brew/hmx.rb '^[[:space:]]*revision\b'
# The three system calls in `def install` were each executed against a clean
# clone of the tag (see REMAINING.md A3). `--prefix` is a real cmake --install
# flag, unlike the `--destdir` the PKGBUILD used to pass; this asserts the form
# that was actually run, so a later edit has to be a deliberate one.
check "brew formula installs with cmake --install --prefix" packaging/brew/hmx.rb '"cmake", "--install", "build", "--prefix", prefix'
reject "brew formula passes no nonexistent install flag" packaging/brew/hmx.rb '\-\-destdir'
check "CPack deb depends on gcc"     CMakeLists.txt        'CPACK_DEBIAN_PACKAGE_DEPENDS "gcc"'

# ── 6) One contact address across the metadata ───────────────
EMAIL="himanshujsr462@gmail.com"
for f in CMakeLists.txt packaging/arch/PKGBUILD; do
    check "$f uses the project contact address" "$f" "$EMAIL"
done
reject "no superseded contact address" CMakeLists.txt "himanshu2010\.dev@gmail\.com"
reject "no superseded contact address (PKGBUILD)" packaging/arch/PKGBUILD "himanshu2010\.dev@gmail\.com"

# ── 7) Installers verify what they download ──────────────────
check "install.sh verifies checksums" install/install.sh   'SHA256SUMS'
check "install.sh refuses a bad digest" install/install.sh 'checksum mismatch'
check "install.ps1 verifies checksums" install/install.ps1 'SHA256SUMS'
check "install.ps1 refuses a bad digest" install/install.ps1 'checksum mismatch'
# "Verifies" was the claim; the behaviour was "verifies if it can". A missing
# SHA256SUMS used to be a warning followed by an unverified install -- of a
# compiler -- in both installers, which contradicted install.sh's own header
# ("an unverified binary is never installed"). The sums are always published (the
# release workflow asserts the asset), so their absence is a fault, not a choice.
reject "install.sh does not skip verification on a missing SHA256SUMS"  install/install.sh  'skipping checksum verification'
reject "install.ps1 does not skip verification on a missing SHA256SUMS" install/install.ps1 'skipping checksum verification'
check  "install.sh refuses an unverified install"  install/install.sh  'refusing to install unverified'
check  "install.ps1 refuses an unverified install" install/install.ps1 'refusing to install unverified'

# hmx emits C and shells out to a compiler on every run, so "installed" and
# "usable" are different claims. install.ps1 mentioned the requirement in a
# static sentence nobody had to act on, and install.sh said nothing at all —
# so a machine with no C compiler got a working `hmx -v` and a failing first
# program with no hint why. Both now probe. The remedy is chosen per machine:
# a list that always leads with `xcode-select` is worse than none.
for f in install/install.sh install/install.ps1; do
    n=$(grep -cE 'cc.*gcc.*clang|gcc, cc, clang' "$REPO/$f")
    if [ "$n" -ge 1 ]; then ok "$f mentions a C compiler"
    else bad "$f mentions a C compiler" "no mention of cc/gcc/clang in $f"; fi
done
# Mentioning is not probing. A pattern over the tool names matches the warning
# text ("looked for gcc, cc, clang") on its own, so this first version passed
# with the probe deleted -- the same trap as the AUR hand-off check. Assert the
# lookup itself instead: PowerShell must call Get-Command, bash must call `have`.
check "install.ps1 actually probes for a C compiler" install/install.ps1 'Get-Command \$_ -ErrorAction SilentlyContinue'
check "install.sh actually probes for a C compiler"  install/install.sh  'for c in cc gcc clang; do'
check "install.sh names the remedy for this machine" install/install.sh 'apt install build-essential'
check "install.sh handles macOS"  install/install.sh 'xcode-select --install'
check "install.sh handles msys2"  install/install.sh 'MINGW\*\|MSYS\*\|CYGWIN\*'
# require_cc must run on the paths that report success, not merely exist.
n=$(grep -c 'require_cc' "$REPO/install/install.sh")
if [ "$n" -ge 4 ]; then ok "install.sh calls require_cc on every install path"
else bad "install.sh calls require_cc on every install path" "only $n reference(s); the two install functions and both brew paths need one"; fi
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
# The image runs as uid 1000 and `hmx run` writes into the working directory,
# so a bind mount owned by the runner (uid 1001) is unwritable for it. Without
# --user the smoke test failed on a permission error while the image itself was
# fine, which reads as a broken image.
check "container smoke test runs as the host uid" .github/workflows/container.yml 'docker run --rm --user "\$uid"'
check "container smoke test asserts the unwritable-cwd diagnostic" .github/workflows/container.yml 'cannot write build_temp\.c'

# ── 10) The release actually contains what installers resolve to ──
# v0.10.0 shipped with no .deb at all: cpack wrote it into build/, the upload
# pattern `hmx*.deb` is relative to the workspace root, and an artifact glob
# that matches nothing is a warning, not an error. Every consumer of that .deb
# — install.sh on Debian/Ubuntu, the README's .deb row — resolves to a 404.
# Two static guards, plus a runtime assertion in the workflow that names each
# expected asset so a future omission fails the release instead of the user.
check "release moves the .deb out of build/"      .github/workflows/release.yml 'mv "build/hmx-\$\{ver\}-Linux\.deb"'
check "release asserts the .deb exists"          .github/workflows/release.yml 'deb not produced'
check "release upload errors on no match"        .github/workflows/release.yml 'if-no-files-found: error'
check "release names every expected asset"       .github/workflows/release.yml 'missing release asset'
for l in linux-x86_64 macos-arm64 windows-x86_64; do
    check "release builds a $l archive" .github/workflows/release.yml "label: $l\$"
done
check "release archive names interpolate the tag" .github/workflows/release.yml 'hmx-\$\{ver\}-\$\{\{ matrix\.label \}\}\.tar\.gz'
check "release zip names interpolate the tag"  .github/workflows/release.yml 'hmx-\$ver-\$\{\{ matrix\.label \}\}\.zip'
# And the installers must point at a name the release actually produces, or
# they 404 — which is the whole reason this section exists.
check "install.sh references the .deb" install/install.sh 'hmx_.*_amd64\.deb'
check "install.ps1 references the windows zip" install/install.ps1 'windows-x86_64\.zip'

# ── 11) The installer must not hand off to a resolver that substitutes ──
# An AUR helper resolves `-S <name>` by fuzzy match, not exact name. With no hmx
# in the AUR, the documented one-liner ran `yay -S --noconfirm hmx` and installed
# honeymux-bin ("a new UX layer for the terminal, built on tmux") — unprompted,
# from our own README. The prebuilt tarball needs no AUR, so an unconfirmed name
# must never reach a helper.
check "install.sh asks the AUR before using a helper" install/install.sh 'aur\.archlinux\.org/rpc/v5/info/hmx'
check "install.sh distinguishes absent from unreachable" install/install.sh 'AUR_STATE=(absent|unknown|present)'
# The guard has to sit between the detection and the call. Asserting the guarded
# *form* rather than the presence of the word: `aur_has_hmx` also appears in its
# own definition, so a check for the bare name passes even with the guard removed
# from the call site -- which is exactly what the first version of this check did.
check "install.sh AUR hand-off is guarded" install/install.sh 'if \[ -n "\$aur_helper" \] && aur_has_hmx; then'
reject "install.sh does not hand off to a bare helper call" install/install.sh '^[[:space:]]*exec (yay|paru) -S'

# ── 12) The winget manifest is a three-file tree, and each file's type ──
# A winget "singleton" package is one version per directory and needs THREE
# files, each validated on its own. This repo had a single file that declared
# `ManifestType: singleton` -- that value belongs in the version manifest -- and
# carried the locale fields inside the installer file. `winget validate` rejects
# that with "'installer' was expected", so the submission was not merely
# unmerged, it was malformed. All three now validate against the real
# winget-manifest.*.1.12.0 schemas.
for f in hmx.yaml hmx.installer.yaml hmx.locale.en-US.yaml; do
    if [ -f "packaging/winget/$f" ]; then ok "winget manifest file $f exists"
    else bad "winget manifest file $f exists" "missing packaging/winget/$f"; fi
done
check "winget version manifest is typed 'version'"      packaging/winget/hmx.yaml '^ManifestType: version$'
check "winget installer manifest is typed 'installer'"  packaging/winget/hmx.installer.yaml '^ManifestType: installer$'
check "winget locale manifest is typed 'defaultLocale'" packaging/winget/hmx.locale.en-US.yaml '^ManifestType: defaultLocale$'
reject "winget installer manifest is not typed 'singleton'" packaging/winget/hmx.installer.yaml '^ManifestType: singleton$'
# The locale fields belong to the locale file; and a portable zip needs the
# nested-installer entry, or no shim is created and `hmx` is not a command
# afterwards even though the install "succeeded".
for fld in PackageLocale Publisher License ShortDescription; do
    reject "winget installer manifest has no $fld" packaging/winget/hmx.installer.yaml "^$fld:"
    check  "winget locale manifest has $fld"        packaging/winget/hmx.locale.en-US.yaml "^$fld:"
done
check "winget portable zip declares a nested installer" packaging/winget/hmx.installer.yaml '^NestedInstallerType: portable$'
check "winget portable zip names the executable"        packaging/winget/hmx.installer.yaml '^- RelativeFilePath: hmx\.exe$'
# Bare 2026-09-27 is a YAML date; the schema wants a string.
check "winget ReleaseDate is a quoted string" packaging/winget/hmx.installer.yaml '^ReleaseDate: "[0-9]{4}-[0-9]{2}-[0-9]{2}"$'

# ── 12b) The submission *layout*, derived rather than assumed ──
# Both of these were found by reading microsoft/winget-pkgs' own
# doc/ValidationFailureGuide.md, after PR microsoft/winget-pkgs#442621 came back
# red on step "02. Manifest Validation". Neither failure had ever been seen here
# before, and neither is visible from the manifest's own contents.
#
# (a) Manifest-Version-Deprecated. The repository accepts 1.12.0 and 1.10.0.
#     The first submission said 1.6.0 -- correct when written, quietly wrong
#     later, because "the newest version anyone remembers" is not a constant.
# (b) Manifest-Path-Error. The three filenames are prefixed with the *whole*
#     PackageIdentifier, not the application name. The first submission used
#     HMX.yaml where the tree needs HMX.HMX.yaml, and got the folders right,
#     which is what made it look correct.
#
# So (b) is derived from PackageIdentifier and PackageVersion and compared with
# the paths hmx.yaml documents. Hardcoding the expected strings would have left
# the same trap in place for the next version bump: the names change with the
# identifier, and a stale hand-written comment fails silently until a CI run.
WINGET_SCHEMA_VERSION="1.12.0"
WINGET_ID="$(sed -n 's/^PackageIdentifier:[[:space:]]*//p' packaging/winget/hmx.yaml | head -1 | tr -d '\r')"
WINGET_VER="$(sed -n 's/^PackageVersion:[[:space:]]*//p'     packaging/winget/hmx.yaml | head -1 | tr -d '\r')"

# (a) the accepted schema version, in the field and in the editor hint. A field
#     bump without the comment bump passes a grep for the field alone, and the
#     comment is what an editor uses to validate as you type.
for f in hmx.yaml hmx.installer.yaml hmx.locale.en-US.yaml; do
    check "winget $f declares ManifestVersion $WINGET_SCHEMA_VERSION" \
        "packaging/winget/$f" "^ManifestVersion: $WINGET_SCHEMA_VERSION\$"
    check "winget $f \$schema hint matches ManifestVersion" \
        "packaging/winget/$f" "^# yaml-language-server: \\\$schema=https://aka\.ms/winget-manifest\.[a-zA-Z]+\.$WINGET_SCHEMA_VERSION\.schema\.json\$"
done
# And nothing anywhere still names a schema version the repository has dropped.
if grep -rhoE 'winget-manifest\.[a-zA-Z]+\.[0-9]+\.[0-9]+\.[0-9]+\.schema\.json' packaging/winget \
   | grep -vE "\.$WINGET_SCHEMA_VERSION\.schema\.json$" | grep -q .; then
    bad "no winget schema hint is older than $WINGET_SCHEMA_VERSION" \
        "$(grep -rhoE 'winget-manifest\.[a-zA-Z]+\.[0-9]+\.[0-9]+\.[0-9]+\.schema\.json' packaging/winget | sort -u | sed 's/^/   also present: /')"
else
    ok "no winget schema hint is older than $WINGET_SCHEMA_VERSION"
fi

# (b) the layout. First the identifier has to be shaped so the derivation means
#     anything: exactly one dot, both parts non-empty.
if printf '%s' "$WINGET_ID" | grep -qE '^[^.]+\.[^.]+$'; then
    ok "winget identifier has one dot and two non-empty parts ($WINGET_ID)"
else
    bad "winget identifier has one dot and two non-empty parts" \
        "got '$WINGET_ID' — the path derivation below assumes <Publisher>.<Package>"
fi
WINGET_PUB="${WINGET_ID%%.*}"
WINGET_PKG="${WINGET_ID#*.}"
WINGET_DIR="manifests/$(printf '%s' "$WINGET_PUB" | cut -c1 | tr 'A-Z' 'a-z')/$WINGET_PUB/$WINGET_PKG/$WINGET_VER"
if [ -n "$WINGET_VER" ]; then
    ok "winget submission directory derives to $WINGET_DIR"
else
    bad "winget submission directory derives" "no PackageVersion in packaging/winget/hmx.yaml"
fi
# ...and the documented paths must be exactly those, all three.
for suffix in "" ".installer" ".locale.en-US"; do
    want="$WINGET_DIR/$WINGET_ID$suffix.yaml"
    if grep -qF "$want" packaging/winget/hmx.yaml; then
        ok "winget hmx.yaml documents $want"
    else
        bad "winget hmx.yaml documents $want" \
            "the copy step in hmx.yaml does not name this path; winget-pkgs wants <PackageIdentifier>$suffix.yaml inside $WINGET_DIR"
    fi
done
# The old, wrong filenames must not linger anywhere as if they were the plan.
reject "winget hmx.yaml does not document the pre-fix HMX.yaml path" \
    packaging/winget/hmx.yaml 'manifests/h/HMX/HMX/[0-9.]+/HMX\.(installer|locale\.en-US)?\.yaml'

# ── 13) This repo has to BE a scoop bucket, and install.ps1 has to notice ──
# `scoop bucket add <repo>` registers the repo as a bucket; scoop then looks for
# <repo>/bucket/<app>.json. The manifest used to live at packaging/scoop/hmx.json,
# so the bucket add pointed at a repo with no bucket/ directory: on a machine that
# had scoop, `bucket add` recorded a bucket and then `scoop install hmx` could
# never resolve — a broken bucket left behind on the user's system. The manifest
# is now at bucket/hmx.json, which is the only location that works.
if [ -f "$REPO/bucket/hmx.json" ]; then ok "the scoop manifest is at bucket/hmx.json"
else bad "the scoop manifest is at bucket/hmx.json" "missing bucket/hmx.json — 'scoop bucket add' would register a broken bucket"; fi
if [ -d "$REPO/packaging/scoop" ]; then bad "there is no second copy of the scoop manifest" "packaging/scoop/ still exists; two copies will drift"
else ok "there is no second copy of the scoop manifest"; fi
check "install.ps1 adds the repo as a bucket" install/install.ps1 'scoop bucket add hmx "https://github.com/\$Repo"'

# ── 14) install.ps1 must not report success it did not achieve ────────────
# $ErrorActionPreference = "Stop" escalates *cmdlet* errors and does nothing for
# a native command's exit code. winget and scoop are native commands, so a failed
# install fell through to "installed via winget!" and `exit 0`: the installer
# claiming success with nothing installed, and the user never finding out why.
# The header's own invocation is `powershell` (Windows PowerShell 5.1), which has
# no $PSNativeCommandUseErrorActionPreference to fall back on -- so the exit code
# has to be tested explicitly and turned into a throw, which is catchable.
guards=$(grep -cE 'if \(\$LASTEXITCODE -ne 0\) \{ throw' "$REPO/install/install.ps1")
if [ "$guards" -ge 2 ]; then ok "install.ps1 checks \$LASTEXITCODE after both winget and scoop"
else bad "install.ps1 checks \$LASTEXITCODE after both winget and scoop" "found $guards exit-code guard(s); winget and scoop both need one"; fi
# And neither of them may reach its success message unguarded -- assert the guard
# sits on the line *after* the call, since `check` for the bare pattern would
# pass even if the guard were deleted.
for tool in winget scoop; do
    if grep -A1 -E "^[[:space:]]+(& )?${tool} (install|bucket add)" "$REPO/install/install.ps1" | grep -qE 'if \(\$LASTEXITCODE -ne 0\)'; then
        ok "install.ps1 guards the $tool call itself"
    else
        bad "install.ps1 guards the $tool call itself" "no \$LASTEXITCODE check on the line after the $tool invocation"
    fi
done
check "install.sh tolerates the AUR's compact JSON" install/install.sh '"resultcount":\[\[:space:\]\]\*'
reject "install.sh never fuzzy-installs an unverified name" install/install.sh '^[[:space:]]*exec (yay|paru) -S'

# --- 12c. The repository signing key is defined once, and shown from there ---
#
# install.sh tells the reader which key signs the pacman repository so that they
# can check it against what they actually imported. That makes the string
# load-bearing rather than decorative: a rotated key that left a stale literal in
# the help message would not be merely untidy, it would have the reader compare
# against the wrong fingerprint and trust the wrong key. So the value lives in
# one constant, quoted wherever it is displayed, and these gates keep it that way
# across a rotation -- which is exactly the moment a hardcoded string is most
# likely to be forgotten.
#
# The counts below are over *shape*, not over a value the checker has seen. A
# gate that knows the current fingerprint would happily pass the day a second,
# stale copy of a *different* one was pasted in; counting every 40-hex-uppercase
# run catches a new one the checker has never heard of.
fpr_defs=$(grep -cE '^HMX_SIGNING_FPR="[0-9A-F]{40}"$' install/install.sh || true)
if [ "$fpr_defs" = "1" ]; then
  ok "install.sh defines the signing fingerprint exactly once, as a constant"
else
  bad "install.sh defines the signing fingerprint exactly once, as a constant" \
      "found $fpr_defs matching definition lines, expected exactly 1"
fi

fpr_total=$(grep -oE '[0-9A-F]{40}' install/install.sh | wc -l | tr -d ' ')
if [ "$fpr_total" = "1" ]; then
  ok "no second fingerprint literal is baked into install.sh"
else
  bad "no second fingerprint literal is baked into install.sh" \
      "$fpr_total bare 40-hex literals present; all but the definition are copies waiting to go stale"
fi

# The help text must interpolate the constant rather than re-spell it.
if grep -E "printf .*the signing key is %s" install/install.sh | grep -q 'HMX_SIGNING_FPR'; then
  ok "the pacman help text prints the fingerprint from the constant"
else
  bad "the pacman help text prints the fingerprint from the constant" \
      "no printf using \$HMX_SIGNING_FPR; the help text is spelling the key out again"
fi

# A typo here is invisible: the value is printed to a user who has no way to know
# it is wrong, and a placeholder would be printed just as confidently as a real
# key. Shape is all that is checkable from here -- correctness is the keyring's.
if grep -qE '^HMX_SIGNING_FPR="[0-9A-F]{40}"$' install/install.sh \
 && ! grep -qE '^HMX_SIGNING_FPR="([0-9A-F])\1{39}"$' install/install.sh; then
  ok "the signing fingerprint is 40 hex characters and not a placeholder"
else
  bad "the signing fingerprint is 40 hex characters and not a placeholder" \
      "missing, wrong length, or a single repeated character"
fi

# --- 12f. The site's own pages cannot drift from the repo they describe -----
#
# Five standalone pages now exist: install, license, 404, story, and the nav that
# reaches them. Each one is a copy of something that already has an authoritative
# version in the repository, and each one can drift from it silently -- nothing
# fails when the licence page paraphrases the licence, or when the install page
# publishes a URL that has moved, or when the story page restates a version the
# compiler no longer ships. A licence page is the worst case: a reader has no way
# to tell which of the two documents governs, and "the website says MIT" is a
# perfectly good reason to skip reading the file that actually does.
IP=web-playground/src/ui

# 1. The licence text is a byte-for-byte copy of LICENSE.
#
# Compared by extracting the template literal out of the component rather than
# duplicating the expected text here. A gate that restates what it is checking has
# to be updated in two places, and the second place is the one that gets missed --
# which would leave this gate green while the page said something else entirely.
if [ -f LICENSE ] && [ -f "$IP/LicensePage.tsx" ]; then
  # Process substitution rather than a temp file: the harness runs under `set -u`
  # and defines no TMP, so a stray $TMP would abort the whole run instead of
  # failing one gate.
  # Strip the wrapper, do not delete the lines. The first and last lines of the
  # extracted range are the ones carrying `const LICENSE_TEXT = \`MIT License` and
  # `SOFTWARE.\`;` -- dropping them silently discarded the licence title and its
  # final sentence, and the comparison failed for a reason that had nothing to do
  # with drift. Substituting the affixes is what keeps every line of the licence.
  lic_page() {
    sed -n '/const LICENSE_TEXT = `/,/`;$/p' "$IP/LicensePage.tsx" \
      | sed -e '1s/^const LICENSE_TEXT = `//' -e '$s/`;[[:space:]]*$//' \
            -e 's/[[:space:]]*$//'
  }
  # Trailing whitespace is normalised on both sides: a stray space in a
  # hand-edited file is not a licence divergence, and a gate that reports those
  # trains people to ignore it.
  if diff -q <(sed -e 's/[[:space:]]*$//' LICENSE) <(lic_page) >/dev/null; then
    ok "the license page reproduces LICENSE exactly"
  else
    bad "the license page reproduces LICENSE exactly" \
        "diff LICENSE against the LICENSE_TEXT block in $IP/LicensePage.tsx; the page must be a copy, not a summary"
  fi

  # The comparison above cannot distinguish "identical" from "both empty", and an
  # extraction pattern that silently stops matching is the expected way this gate
  # dies. So its own precondition is asserted too.
  if [ -n "$(lic_page)" ]; then
    ok "the license page extraction still matches the component"
  else
    bad "the license page extraction still matches the component" \
        "LICENSE_TEXT extracted empty, so the byte comparison above passed vacuously"
  fi
else
  bad "the license page and LICENSE both exist" "missing LICENSE or $IP/LicensePage.tsx"
fi

# 2. The version the install page tells people to fetch is this repo's version.
#
# An install page naming a released version is useful; one naming a *previous*
# released version is an instruction to install something superseded, and it keeps
# working, so nothing reports it broken. Deriving the expected value from the
# canonical source means a release bump can never leave the page behind.
# From CMakeLists.txt, which is what section 12 already treats as canonical. The
# first attempt of this gate reached for package.json, whose 0.1.0 is the web
# deploy wrapper's version rather than the compiler's, and so flagged the correct
# 0.10.0 on the install page as stale. Two manifests in this repo legitimately
# carry unrelated version numbers, which makes "ask a package.json" a guess.
repo_version="$VERSION"
if [ -n "$repo_version" ] && [ -f "$IP/InstallPage.tsx" ]; then
  stale=$(grep -oE 'v?0\.[0-9]+\.[0-9]+' "$IP/InstallPage.tsx" \
    | tr -d 'v' | sort -u | grep -v "^$repo_version\$" || true)
  if [ -z "$stale" ]; then
    ok "the install page names only the current version ($repo_version)"
  else
    bad "the install page names only the current version ($repo_version)" \
        "also names: $(printf '%s' "$stale" | tr '\n' ' ')"
  fi
else
  bad "the install page names only the current version" \
      "could not derive the repo version, or $IP/InstallPage.tsx is missing"
fi

# 3. Every nav tab points at a route that exists, and the catch-all is a 404.
#
# The catch-all check is the interesting half. It used to render the home page,
# which looked like working navigation: the URL changed, a page rendered, nothing
# said anything was wrong. A dead nav tab and a working one are indistinguishable
# from the outside in that state.
for tab in $(grep -oE '\{ to: "[^"]+"' "$IP/Nav.tsx" 2>/dev/null | grep -oE '/[^"]+' || true); do
  if grep -qE 'path="'"$tab"'"' web-playground/src/App.tsx; then
    ok "nav tab $tab has a matching route"
  else
    bad "nav tab $tab has a matching route" "no <Route path=\"$tab\"> in App.tsx; the tab would render the 404"
  fi
done

if grep -qE 'path="\*" element=\{<NotFoundPage' web-playground/src/App.tsx; then
  ok "an unknown route renders the 404 page"
elif grep -qE 'path="\*" element=\{<HomePage' web-playground/src/App.tsx; then
  bad "an unknown route renders the 404 page" \
      "the catch-all still renders <HomePage>, so a bad URL silently lands on the home page with no indication anything is wrong"
else
  bad "an unknown route renders the 404 page" "no recognisable catch-all route in App.tsx"
fi

# 4. Every install command the page publishes is also in the repo's docs.
#
# Not a style gate. The install page is the one a visitor is most likely to act on
# and the one most likely to rot: a moved installer URL is a dead page and nothing
# in CI notices, because nothing here executes a shell command.
#
# The extractor is a tiny state machine, not a line grep. Its first version was
# `grep -oE '^\s+(curl|...)'`, which matched nothing at all: every line of the
# component starts with `code:` or `code={\``, so the pattern found zero commands
# and this gate passed by finding zero things to check. It also could not see the
# multi-line template literals that carry the pacman repository block. So the
# extraction now understands all three forms the page uses and -- because a gate
# whose extractor silently stops matching is exactly how this one died -- its own
# output is asserted non-empty below.
extract_install_cmds() {
  awk '
    {
      line = $0
      if (match(line, /code[[:space:]]*:[[:space:]]*"/)) {
        s = substr(line, RSTART + RLENGTH); sub(/".*$/, "", s); print s; next
      }
      if (match(line, /code[[:space:]]*:[[:space:]]*`/) ||
          match(line, /code[[:space:]]*=[[:space:]]*\{[[:space:]]*`/)) {
        s = substr(line, RSTART + RLENGTH)
        if (index(s, "`") > 0) { sub(/`.*$/, "", s); print s } else { intpl = 1; print s }
        next
      }
      if (intpl) {
        if (index(line, "`") > 0) { intpl = 0; sub(/`.*$/, "", line); print line; next }
        print line; next
      }
    }
  ' "$1" \
    | grep -E '^[[:space:]]*(curl|brew|paru|sudo|docker|git clone)([[:space:]]|$)' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/\\\$arch/$arch/' \
    | sort -u
}

if [ -f "$IP/InstallPage.tsx" ]; then
  cmds="$(extract_install_cmds "$IP/InstallPage.tsx" || true)"
  n_cmds=$(printf '%s\n' "$cmds" | grep -c . || true)
  if [ "$n_cmds" -gt 0 ]; then
    ok "the install-command extractor finds the page's commands ($n_cmds)"
  else
    bad "the install-command extractor finds the page's commands" \
        "extracted 0 commands from $IP/InstallPage.tsx; every command would pass vacuously, which is how the first version of this gate died"
  fi

  # README escapes the table pipes as `\|`, so a plain -F match on a command that
  # contains a pipe never hits the README copy. Normalise the escape on the way in.
  missing_cmds=0
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    if ! grep -qF "$cmd" <(sed 's/\\|/|/g' README.md) && ! grep -qF "$cmd" REMAINING.md; then
      missing_cmds=$((missing_cmds + 1))
      echo "      $cmd"
    fi
  done <<EOF
$cmds
EOF
  if [ "$missing_cmds" -eq 0 ]; then
    ok "every install command on the page is also in the repo docs"
  else
    bad "every install command on the page is also in the repo docs" \
        "$missing_cmds command(s) appear only on the website; README.md or REMAINING.md is where they are reviewable"
  fi
fi

# 5. The story page is data-driven from story.json, and that JSON is well-formed.
#
# The page is meant to grow by appending to one file, so the file is the contract:
# a malformed entry, a duplicate chapter id, or a stale version string is a broken
# page, and none of them are visible from the component. The version in particular
# has a single canonical source (CMakeLists), the same one section 12 and the
# install page are gated against, so a release bump can never leave the story
# behind. The numeric test counts are deliberately not gated -- they have no single
# source of truth yet, and gating them would create the drift this file is fixing.
STORY=web-playground/src/data/story.json
if [ -f "$STORY" ]; then
  # JSON is parsed with node, which the repo already requires (root package.json /
  # npm scripts) and the packaging CI runner has preinstalled. Detect its absence
  # explicitly so a missing runtime reads as a missing runtime, not as malformed
  # JSON -- a distinction that matters when the gate goes red on a bare machine.
  if command -v node >/dev/null 2>&1; then
  story_err="$(node -e '
    const fs = require("fs");
    let s;
    try { s = JSON.parse(fs.readFileSync("web-playground/src/data/story.json", "utf8")); }
    catch (e) { process.stdout.write("invalid JSON: " + e.message); process.exit(0); }
    const errs = [];
    if (!s.title) errs.push("missing title");
    if (!s.intro) errs.push("missing intro");
    if (!Array.isArray(s.chapters) || s.chapters.length === 0) errs.push("no chapters");
    const ids = new Set();
    for (const c of s.chapters || []) {
      if (!c.id) errs.push("a chapter has no id");
      else if (ids.has(c.id)) errs.push("duplicate chapter id: " + c.id);
      else ids.add(c.id);
      if (!c.title) errs.push("chapter " + c.id + " has no title");
      if (!Array.isArray(c.entries) || c.entries.length === 0)
        errs.push("chapter " + c.id + " has no entries");
      for (const e of c.entries || []) {
        if (!e.title) errs.push("an entry in " + c.id + " has no title");
        if (!e.date) errs.push("an entry in " + c.id + " has no date");
      }
    }
    process.stdout.write(errs.join("; "));
  ' 2>&1 || true)"
  else
    story_err="the 'node' executable is required to validate story.json and was not found in PATH"
  fi
  if [ -z "$story_err" ]; then
    ok "story.json is well-formed and every chapter/entry is complete"
  else
    bad "story.json is well-formed and every chapter/entry is complete" "$story_err"
  fi

  # The page must render from the data, not from a hard-coded copy of it.
  if grep -qE 'from "\.\./data/story"' "$IP/StoryPage.tsx" 2>/dev/null; then
    ok "StoryPage renders from the story data module"
  else
    bad "StoryPage renders from the story data module" \
        "$IP/StoryPage.tsx does not import ../data/story; a page that restates the data will drift from story.json"
  fi

  story_ver=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$STORY" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  if [ "$story_ver" = "$repo_version" ]; then
    ok "story.json names the current version ($repo_version)"
  else
    bad "story.json names the current version ($repo_version)" \
        "story.json says '${story_ver:-nothing}'; it must stay on the canonical CMakeLists version"
  fi
else
  bad "story.json exists" "missing $STORY"
fi
# --- 12e. The signing key appears in docs in two spellings, and only in one ---
#
# Found the hard way. Rotating to 3D987F64 was done with a `sed` matching the
# bare 40-hex form, and it looked like a complete job: the gate in 12c went green
# and no live fingerprint was left stale in the unspaced spelling. But the pacman
# README also printed the key in the spaced human form --
#   E203 38C6 BEB6 BBE9 78F9 13DB E6AE D9C6 13DD CF5E
# -- which no `[0-9A-F]{40}` pattern can match. Two lines below it, the same file
# had been updated to the new key. So the document told a reader to check their
# fingerprint against the *orphaned* one, one line above telling them to trust the
# new one. Every gate was green because every gate was looking at a spelling that
# happened to be correct.
#
# The fix is not a better sed. It is that the spaced form is now checked too, and
# that a fingerprint which is not the live one has to be accounted for by name
# rather than waved through.
LIVE_FPR=$(grep -oE '^HMX_SIGNING_FPR="[0-9A-F]{40}"' install/install.sh | grep -oE '[0-9A-F]{40}' || true)

# Every spaced fingerprint anywhere in the docs or installer must un-space to
# either the live key or an explicitly retired one. Spacing groups are 4 hex
# chars, so the assembled value is unambiguous to normalise back.
spaced_bad=0
for f in *.md install/install.sh install/install.ps1 packaging/*/*.yaml packaging/*/PKGBUILD packaging/brew/hmx.rb; do
[ -f "$f" ] || continue
while read -r sp; do
  [ -z "$sp" ] && continue
  flat=$(printf '%s' "$sp" | tr -d ' ')
  case "$flat" in
    "$LIVE_FPR"|"3D987F64DC5DE0F56A383805117A9800DEC4FCCC") ;;
    *) spaced_bad=$((spaced_bad + 1))
       echo "      $f: $(printf '%s' "$sp" | cut -c1-30)..." ;;
  esac
done <<EOF
$(grep -ohE '[0-9A-F]{4}( [0-9A-F]{4}){9}' "$f" || true)
EOF
done
if [ "$spaced_bad" -eq 0 ]; then
ok "every spaced fingerprint in the docs is a known key"
else
bad "every spaced fingerprint in the docs is a known key" \
    "$spaced_bad spaced fingerprint(s) match neither the live key nor the retired list; a spaced form is invisible to a 40-hex grep, so a rotation leaves it behind silently"
fi

# The bare form, same rule -- but scoped like the gate below it. Counting a
# retired key anywhere as stale makes the gate permanently red, because
# REMAINING.md deliberately records the orphaned fingerprint as history. A gate
# that cannot go green gets ignored, so the historical mention has to be
# excluded here rather than special-cased in the failure message.
bare_stale=0
for f in *.md; do
  [ "$f" = "REMAINING.md" ] && continue
  while read -r h; do
    [ -z "$h" ] && continue
    if [ "$h" != "$LIVE_FPR" ]; then
      bare_stale=$((bare_stale + 1))
      echo "      $f: $h"
    fi
  done <<EOF
$(grep -ohE '[0-9A-F]{40}' "$f" 2>/dev/null || true)
EOF
done
if [ "$bare_stale" -eq 0 ]; then
  ok "no doc outside REMAINING.md quotes a retired fingerprint"
else
  bad "no doc outside REMAINING.md quotes a retired fingerprint" \
      "$bare_stale mention(es); only REMAINING.md may name a retired key, and only to say it is gone"
fi

# A retired key is legitimate exactly once: as history, in the file that says the
# key is gone. Anywhere else it is an instruction someone might follow.
orphan_in_others=0
for f in *.md; do
[ "$f" = "REMAINING.md" ] && continue
n=$(grep -ohE '[0-9A-F]{40}' "$f" 2>/dev/null | grep -cvE "^$LIVE_FPR\$" || true)
[ "$n" != "0" ] && { orphan_in_others=$((orphan_in_others + n)); echo "      $f: $n"; }
done
if [ "$orphan_in_others" -eq 0 ]; then
ok "the retired key appears only in the file that explains it"
else
bad "the retired key appears only in the file that explains it" \
    "$orphan_in_others retired-key mention(s) outside REMAINING.md"
fi

# The pacman README lives in another repo, so it cannot be checked from here.
# What can be checked is that this repo documents the trust step at all, because
# the first version of that text asserted a mechanism that measurement then
# contradicted -- see the note in REMAINING.md.
# Anchored to the start of a line, so it has to be a command somebody would run.
# The first version of this gate was an unanchored substring match, and it passed
# with the command line itself rewritten -- because the surrounding prose happened
# to contain the same words. A gate that reads its own justification instead of
# the instruction it guards is checking that the docs discuss the topic at all.
if grep -qE '^[[:space:]]*(sudo[[:space:]]+)?pacman-key --lsign [0-9A-F]{40}' REMAINING.md; then
  ok "REMAINING.md gives the pacman trust step as a runnable command"
else
  bad "REMAINING.md gives the pacman trust step as a runnable command" \
      "no line is the command 'pacman-key --lsign <40-hex fingerprint>'; prose that mentions it does not tell a user what to type"
fi

if grep -q 'Key not changed so no update needed' REMAINING.md; then
ok "REMAINING.md records that a no-op lsign reports success"
else
bad "REMAINING.md records that a no-op lsign reports success" \
    "the silent-success case is the one that cost time; without it the next reader assumes lsign works and moves on"
fi
# --- 12d. Commit signing is configured, and checked the canonical way ---------
#
# Two separate things went wrong here, and they are worth separate gates because
# they fail in opposite directions.
#
# First: commit.gpgsign was unset while tag.gpgsign was true. git commit then
# produced ordinary unsigned commits and exited 0, with no warning -- and
# `git config --get user.signingkey` answered with the correct fingerprint a
# moment earlier, which is a convincing lie. A gate that only reads the config
# would also have passed, because tag.gpgsign genuinely was set.
#
# Second: the signature was then "verified" by pulling the gpgsig header out of
# the commit object and handing it to gpg, which reports BAD SIGNATURE on a
# commit git itself calls good. The continuation lines of that header are each
# prefixed with a space, and forgetting to strip that verifies mangled bytes. It
# fails by making a good signature look bad, which is the direction that sends
# you hunting for a problem that is not there.
if [ -x tools/verify-signing.sh ]; then
  ok "tools/verify-signing.sh exists and is executable"
else
  bad "tools/verify-signing.sh exists and is executable" "missing or not chmod +x"
fi

if grep -q 'git verify-commit' tools/verify-signing.sh 2>/dev/null; then
  ok "the signing checker verifies with git verify-commit"
else
  bad "the signing checker verifies with git verify-commit" "no 'git verify-commit' found; signatures are being checked some other, less reliable way"
fi

# The anti-pattern, stated as a prohibition rather than as a pattern to match.
# The first version of this gate tried to recognise the bad shape with a regex
# over two lines at once and matched nothing at all, including the bad shape
# itself -- a green gate that had never failed. "Never call gpg --verify here" is
# both simpler and impossible to match by accident: git verify-commit is the only
# way this script has any business checking a signature, so any direct gpg call
# is either the bug or a worse version of it. Mentions in comments do not count.
if grep -vE '^\s*#' tools/verify-signing.sh 2>/dev/null | grep -q 'gpg --verify'; then
  bad "the signing checker never calls gpg --verify directly" \
      "it pipes something to gpg --verify; if that something is a gpgsig header it is mangled, and it reports a good signature as bad"
else
  ok "the signing checker never calls gpg --verify directly"
fi

# The settings themselves. commit.gpgsign is the one that was missing and the
# only one of the four whose absence produces no diagnostic at all -- so it is
# checked on its own, rather than as part of a group that passes if any member
# is present.
# Three settings have an exact required value and one does not, so they are
# checked as separate literal patterns rather than by splitting a "key=value"
# string -- that split cannot express "the value is a fingerprint, so require
# only the key", and the version that tried went red on user.signingkey while
# every other gate was fine.
#
# The value has to be a whole value. A bare prefix match happily accepts
# "commit.gpgsign true-ish", which git does not, so a typo would satisfy the
# gate that exists to catch exactly that kind of typo.
for setting in "gpg.format openpgp" "commit.gpgsign true" "tag.gpgsign true"; do
  set_key=${setting%% *}
  set_val=${setting#* }
  if grep -qE "git config (--global )?${set_key} ${set_val}([[:space:]]|$)" REMAINING.md; then
      ok "REMAINING.md documents git config ${set_key} ${set_val}"
  else
      bad "REMAINING.md documents git config ${set_key} ${set_val}" \
          "not found; a setting that is only ever typed into a terminal is a setting that gets lost"
  fi
done

# user.signingkey carries a fingerprint, so require the key and let the value be
# whatever the current one is. A stale fingerprint in the docs is a real risk and
# is handled by the install.sh constant gates instead, which is the place the
# value actually has to be right.
if grep -qE 'git config (--global )?user.signingkey [0-9A-F]{40}' REMAINING.md; then
    ok "REMAINING.md documents git config user.signingkey <fingerprint>"
else
    bad "REMAINING.md documents git config user.signingkey <fingerprint>" \
        "not found; a signing key that is only ever set interactively is lost with the shell history"
fi

# And the trap, in prose. Matched against a dedicated sentence rather than a
# phrase that happens to appear in a code comment: an earlier version of this
# gate matched a comment on the commit.gpgsign line, which meant it went red
# whenever the very setting it was meant to protect was edited. A gate coupled
# to the thing it guards is worse than no gate, because the fix looks like the
# bug.
if grep -q 'HMX_SIGNING_TRAP' REMAINING.md; then
  ok "REMAINING.md carries the tag.gpgsign trap marker"
else
  bad "REMAINING.md carries the tag.gpgsign trap marker" \
      "the HMX_SIGNING_TRAP marker is missing; see the note in section 12d"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "Packaging Tests Passed: $PASS, Failed: 0  (version $VERSION)"
    exit 0
fi
echo "Packaging Tests Passed: $PASS, Failed: $FAIL  (version ${VERSION:-?})"
exit 1
