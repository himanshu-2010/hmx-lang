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
# winget-manifest.*.1.6.0 schemas.
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

echo
if [ "$FAIL" -eq 0 ]; then
    echo "Packaging Tests Passed: $PASS, Failed: 0  (version $VERSION)"
    exit 0
fi
echo "Packaging Tests Passed: $PASS, Failed: $FAIL  (version ${VERSION:-?})"
exit 1
