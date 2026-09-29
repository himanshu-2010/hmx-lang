#!/usr/bin/env bash
# hmx — distro-aware installer for Linux & macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/himanshu-2010/hmx-lang/main/install/install.sh | sh
#
# Detects the OS/package manager and installs the best available option:
#   apt     .deb                     → Debian / Ubuntu / Mint
#   pacman  AUR via paru/yay         → Arch Linux & derivatives
#   brew    homebrew-hmx tap         → macOS
#   dnf     prebuilt binary          → Fedora / RHEL (no RPM published)
#   other   prebuilt binary tarball
#
# The version defaults to the newest published release (resolved from the
# GitHub API) and can be pinned with HMX_VERSION=0.10.0. Every download is
# verified against the release's SHA256SUMS file; an unverified binary is
# never installed.
#
# Windows: use install.ps1 instead (this script bails out with a hint).
set -euo pipefail

REPO="himanshu-2010/hmx-lang"
API="https://api.github.com/repos/${REPO}"
VERSION="${HMX_VERSION:-}"

info() { printf '\033[1;35mhmx\033[0m \033[1;97m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mhmx\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mhmx\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# hmx does not contain a C compiler: it emits C and shells out to one, on every
# run. So "installed" and "usable" are different claims, and only the first was
# ever made. Every install path here ends in a success message, which is fine --
# the binary is genuinely there -- but on a machine with no cc the user gets a
# working `hmx -v` and nothing else, with no hint why their first program fails.
# The brew formula has the same gap: brew's gcc is keg-only, so
# `depends_on "gcc"` does not put one on PATH, and the formula's `caveats` block
# is the only thing that says so.
# ── pacman repository (a stopgap for an AUR that will not accept packages) ──
#
# The AUR is the right answer for Arch and this is not a replacement for it. It
# exists only because AUR registration is currently closed behind an anti-bot
# challenge, and the maintainers' own PKGBUILD -- already verified with makepkg
# -- has nowhere to be submitted. The package is built from that same PKGBUILD,
# so the two cannot drift, and the AUR is checked first on every run: the moment
# `hmx` appears there, install.sh hands off and never reaches this code.
#
# It is opt-in and not the default, because setting it up means appending to
# /etc/pacman.conf and importing a GPG key. A `curl | bash` script should not do
# either to a machine that did not ask for it. The prebuilt binary, checksum-
# verified, remains the default path and is a perfectly good install.
PACMAN_REPO_NAME="hmx"
PACMAN_REPO_URL="https://himanshu-2010.github.io/hmx-pacman"

pacman_repo_known() { grep -qs "^\[$PACMAN_REPO_NAME\]" /etc/pacman.conf; }

install_from_pacman_repo() {
    have gpg || { warn "gpg is not installed; cannot verify the repository key"; return 1; }
    have sudo || { warn "sudo is not available; cannot edit /etc/pacman.conf"; return 1; }

    info "Importing the hmx repository signing key"
    # Additive and non-destructive: --import adds a keyring entry, it does not
    # replace one. The key is also what makes SigLevel=Required work, so this is
    # the step that actually establishes trust rather than a formality.
    if ! curl -fsSL "$PACMAN_REPO_URL/hmx-signing-key.asc" | gpg --import; then
        warn "could not import the repository key -- not touching /etc/pacman.conf"
        return 1
    fi

    # pacman will still ask whether to trust a key it has not seen before. That
    # prompt is the correct place to check the fingerprint, so do not suppress
    # it and do not try to pre-empt it with --noconfirm on the sync.
    if ! pacman_repo_known; then
        info "Adding [$PACMAN_REPO_NAME] to /etc/pacman.conf"
        printf '\n[%s]\nSigLevel = Required DatabaseRequired\nServer = %s/$arch\n' \
            "$PACMAN_REPO_NAME" "$PACMAN_REPO_URL" \
            | sudo tee -a /etc/pacman.conf >/dev/null
    else
        info "Repository already present in /etc/pacman.conf"
    fi

    info "Installing hmx from the signed repository"
    # No --noconfirm on the sync: that is where pacman asks about the key, and
    # answering it blind is exactly what a signature is supposed to prevent.
    sudo pacman -Sy --needed
    sudo pacman -S --noconfirm --needed "$PACMAN_REPO_NAME"
    return $?
}

offer_pacman_repo() {
    # A quoted heredoc, so the fingerprint line has to be literal: an unquoted
    # one would also expand $arch and anything else a future edit adds.
    cat <<'EOF'

  A signed pacman repository is also available, built from the same PKGBUILD:

    HMX_PACMAN_REPO=1 curl -fsSL https://raw.githubusercontent.com/himanshu-2010/hmx-lang/main/install/install.sh | bash

  It adds one stanza to /etc/pacman.conf and imports a signing key, so it is
  opt-in rather than the default. Signatures are enforced, not decorative --
  the signing key is E20338C6BEB6BBE978F913DBE6AED9C613DDCF5E.
EOF
    if [ "${HMX_PACMAN_REPO:-0}" = "1" ]; then
        echo
        if install_from_pacman_repo; then
            info "Installed hmx from $PACMAN_REPO_URL. Verify with: hmx --version"
            require_cc
            exit 0
        fi
        warn "the pacman repository could not be set up — falling back to the prebuilt binary"
    fi
    cat <<'EOF'

  Continuing with the prebuilt binary: that is a complete, verified install
  too, and it is what most people want.
EOF
}

require_cc() {
    local c
    for c in cc gcc clang; do
        if have "$c"; then return 0; fi
    done
    # Name the remedy for *this* machine. A list that leads with macOS advice is
    # worse than none, because the reader has to work out which line is theirs.
    warn "no C compiler found (looked for cc, gcc, clang)."
    warn "hmx compiles to C, so it needs one at runtime -- every hmx program"
    warn "will fail until you install it:"
    case "$(uname -s)" in
        Darwin)  warn "  xcode-select --install" ;;
        MINGW*|MSYS*|CYGWIN*)
                  warn "  winget install --id BrechtSanders.WinLibs.POSIX.UCRT" ;;
        *)
            if have apt-get;    then warn "  sudo apt install build-essential"
            elif have dnf;      then warn "  sudo dnf install gcc"
            elif have pacman;   then warn "  sudo pacman -S base-devel"
            elif have apk;      then warn "  sudo apk add build-base"
            else                     warn "  install a C compiler with your package manager"
            fi ;;
    esac
}

# ── Resolve the release ─────────────────────────────────────
# HMX_VERSION pins a version; otherwise the newest published release wins.
# `releases/latest` is the public endpoint — no token needed — and is what
# makes the one-liner install stay current without editing this file.
resolve_version() {
    [ -n "$VERSION" ] && return 0
    have curl || die "curl is required to resolve the latest hmx version (or set HMX_VERSION=...)"
    local body tag
    body="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API/releases/latest" 2>/dev/null)" \
        || die "could not reach the GitHub API; pass a version explicitly, e.g. HMX_VERSION=0.10.0"
    # `tag_name` is the only field quoted with "v" on its own value; grep the
    # line rather than pattern-matching arbitrary JSON so this stays
    # dependency-free (no jq requirement on a machine that is being bootstrapped).
    tag="$(printf '%s' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)"
    [ -n "$tag" ] || die "no published release found at $API/releases/latest"
    VERSION="$tag"
}

# ── Download + verify ────────────────────────────────────────
# verify <file> <name>: the release ships SHA256SUMS next to the artifacts.
# A missing or non-matching entry is fatal — an unverified compiler is worse
# than no compiler.
verify() {
    local file="$1" name="$2" sums want got
    sums="$(fetch "$BASE/SHA256SUMS" 2>/dev/null || true)"
    if [ -z "$sums" ]; then
        # A missing SHA256SUMS used to be a warning followed by an unverified
        # install, which contradicted this file's own header. Without the sums
        # there is no way to tell a good download from a tampered one, and a
        # compiler is the worst thing to install blind. Every release ships the
        # file — the release workflow asserts it — so its absence means something
        # is wrong, not that verification is optional.
        die "release has no SHA256SUMS (refusing to install unverified)"
    fi
    want="$(printf '%s\n' "$sums" | awk -v n="$name" '$2 == n {print $1; exit}')"
    if [ -z "$want" ]; then
        die "SHA256SUMS has no entry for $name (refusing to install unverified)"
    fi
    got="$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$file" | cut -d' ' -f1)"
    [ "$want" = "$got" ] || die "checksum mismatch for $name
  expected $want
  got      $got"
    info "checksum verified"
}

fetch() { # <url> -> stdout
    curl -fsSL "$1"
}

# ── Is hmx actually in the AUR? ──────────────────────────────
# An AUR helper resolves `-S <name>` by *fuzzy* match, not by exact name. With
# no hmx in the AUR, `yay -S --noconfirm hmx` cheerfully built and installed
# honeymux-bin — "a new UX layer for the terminal, built on tmux" — with no
# prompt, straight from our own documented one-liner. The prebuilt tarball is
# right there and needs no AUR at all, so the only correct thing to do when the
# AUR cannot confirm the name is not to ask a helper to install it.
#
# Sets AUR_STATE to present | absent | unknown. Only `present` may hand off.
AUR_STATE=unknown
aur_has_hmx() {
    local body
    AUR_STATE=unknown
    have curl || return 1
    body="$(curl -fsSL --max-time 20 \
        'https://aur.archlinux.org/rpc/v5/info/hmx' 2>/dev/null)" || return 1
    # resultcount is the authoritative answer, and it needs no JSON parser --
    # same reasoning as resolve_version above. The whitespace after the colon is
    # optional on purpose: the AUR emits `"resultcount":0`, and a pattern
    # written to match the space that `python -m json.tool` inserts matches
    # nothing at all, which is indistinguishable from the AUR being down.
    if printf '%s' "$body" | grep -q '"resultcount":[[:space:]]*1'; then
        AUR_STATE=present; return 0
    fi
    if printf '%s' "$body" | grep -q '"resultcount":[[:space:]]*0'; then
        AUR_STATE=absent; return 1
    fi
    return 1
}

install_binary() { # <asset> <label>
    local asset="$1" label="$2" tmp bin
    tmp="$(mktemp -d)"
    info "Downloading hmx ${VERSION} (${label})"
    curl -fsSL "$BASE/$asset" -o "$tmp/pkg.tgz"
    verify "$tmp/pkg.tgz" "$asset"
    tar -xzf "$tmp/pkg.tgz" -C "$tmp"
    bin="$tmp/bin/hmx"
    [ -x "$bin" ] || die "archive did not contain bin/hmx"
    if [ -w /usr/local/bin ]; then
        install -m 0755 "$bin" /usr/local/bin/hmx
    elif have sudo; then
        sudo install -m 0755 "$bin" /usr/local/bin/hmx
    else
        mkdir -p "$HOME/.local/bin"
        install -m 0755 "$bin" "$HOME/.local/bin/hmx"
        warn 'installed to ~/.local/bin — add it to your PATH:'
        warn '  echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.bashrc && source ~/.bashrc'
    fi
    rm -rf "$tmp"
    info "Installed hmx v${VERSION} (${label}). Verify with: hmx --version"
    require_cc
}

install_deb() {
    local asset="hmx_${VERSION}_amd64.deb" tmp
    tmp="$(mktemp -d)"
    info "Downloading ${asset}"
    curl -fsSL "$BASE/$asset" -o "$tmp/hmx.deb"
    verify "$tmp/hmx.deb" "$asset"
    if have sudo; then sudo apt-get install -y "$tmp/hmx.deb"
    else                apt-get install -y "$tmp/hmx.deb"; fi
    rm -rf "$tmp"
    info "Installed hmx v${VERSION}. Verify with: hmx --version"
    require_cc
}

# ── Detect platform ──────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
    x86_64|amd64) barch="x86_64" ;;
    aarch64|arm64) barch="arm64" ;;
    *) die "unsupported architecture: ${arch}" ;;
esac

case "$os" in
    Linux)    platform="linux-${barch}" ;;
    Darwin)   platform="macos-${barch}" ;;
    MINGW*|MSYS*|CYGWIN*)
        warn "Windows detected — use install.ps1 instead:"
        warn "  powershell -ExecutionPolicy Bypass -f https://raw.githubusercontent.com/${REPO}/main/install/install.ps1"
        exit 1
        ;;
    *) die "unsupported operating system: ${os}" ;;
esac

# Releases publish one binary per runner architecture, so refuse up front
# rather than downloading a 404 — a wrong arch used to surface as a bare
# "curl: (22) The requested URL returned error: 404".
build_from_source_hint() {
    cat >&2 <<EOF

  hmx is built from source with:
    git clone --depth 1 https://github.com/${REPO} && cd hmx-lang
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
    sudo cmake --install build --prefix /usr/local
EOF
}

# Actually do it, rather than printing the recipe and exiting.
#
# This exists because "no prebuilt binary for your platform" is a much worse
# answer than "here is a compiler, hold on". The release publishes one macOS
# binary, for arm64, because that is the only macOS runner it has — so every
# Intel Mac, and any Mac where the tarball 404s, previously dead-ended on a
# wall of text. That is a fine answer for a README and a poor one for an
# installer whose whole job is to install something.
#
# Built from the release tag, not main, so what gets installed is the same source
# the release binaries came from. The toolchain is checked first and named,
# because "cmake: command not found" after a successful clone is not a useful
# error to hand someone on a Mac.
build_from_source() {
    local tmp
    tmp="$(mktemp -d)"
    info "No prebuilt hmx for ${platform} — building from source (v${VERSION})"
    for t in git cmake; do
        if ! have "$t"; then
            die "building from source needs '$t', which is not on PATH.
      On macOS:  xcode-select --install   (then: brew install cmake)"
        fi
    done
    info "Fetching the v${VERSION} source"
    if ! git clone -q --depth 1 --branch "v${VERSION}" "https://github.com/${REPO}.git" "$tmp/hmx-lang"; then
        rm -rf "$tmp"
        die "could not fetch the v${VERSION} source from GitHub"
    fi
    info "Compiling (this takes a couple of minutes)"
    (
        cd "$tmp/hmx-lang" &&
        cmake -S . -B build -DCMAKE_BUILD_TYPE=Release &&
        cmake --build build
    ) >"$tmp/build.log" 2>&1 || {
        warn "the build failed; last lines of the log:"
        tail -20 "$tmp/build.log" >&2
        rm -rf "$tmp"
        exit 1
    }
    install_built "$tmp/hmx-lang/build/hmx"
    rm -rf "$tmp"
    info "Built hmx v${VERSION} from source. Verify with: hmx --version"
    require_cc
}

# Put a binary somewhere on PATH, with the same three-way fallback as
# install_binary: /usr/local/bin if writable, else sudo, else ~/.local/bin.
install_built() {
    local bin="$1"
    [ -x "$bin" ] || die "the build produced no executable at $bin"
    if [ -w /usr/local/bin ]; then
        install -m 0755 "$bin" /usr/local/bin/hmx
    elif have sudo; then
        sudo install -m 0755 "$bin" /usr/local/bin/hmx
    else
        mkdir -p "$HOME/.local/bin"
        install -m 0755 "$bin" "$HOME/.local/bin/hmx"
        warn 'installed to ~/.local/bin — add it to your PATH:'
        warn '  echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.bashrc && source ~/.bashrc'
    fi
}

case "$platform" in
    linux-x86_64|macos-arm64) ;;
    macos-x86_64)
        # No Intel macOS binary is published (the release job runs on arm64).
        # Homebrew is preferred when present because it manages the install;
        # without it, build from source rather than dead-ending.
        if have brew; then
            info "Intel Mac detected — installing via Homebrew (builds from source)"
            if brew tap himanshu-2010/homebrew-hmx 2>/dev/null && brew install hmx; then
                info "Installed hmx."; require_cc; exit 0
            fi
            warn "Homebrew could not install hmx — building from source instead"
        fi
        build_from_source
        exit 0
        ;;
    *)
        die "unsupported platform: ${platform}
      Published binaries: linux-x86_64, macos-arm64."
        build_from_source_hint
        ;;
esac

resolve_version
BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

case "$os" in
    Linux)
        if have apt-get && [ "$barch" = "x86_64" ]; then
            info "Debian/Ubuntu detected — installing the .deb package"
            install_deb
            exit 0
        fi
        if have pacman; then
            aur_helper=""
            if have paru; then
                aur_helper=paru
            elif have yay; then
                aur_helper=yay
            fi
            if [ -n "$aur_helper" ] && aur_has_hmx; then
                info "Arch Linux detected — building from the AUR via $aur_helper"
                exec "$aur_helper" -S --noconfirm hmx
            fi
            case "$aur_helper:${AUR_STATE}" in
                :*)            warn "Arch Linux detected but no AUR helper (paru/yay) found — installing the prebuilt binary" ;;
                *:present)     die "internal error: AUR confirmed but the hand-off was skipped" ;;
                *:absent)      warn "hmx is not in the AUR yet (registration is disabled behind an anti-bot gate)"
                              offer_pacman_repo
                              install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
                              exit 0 ;;
                *)             warn "could not confirm hmx is in the AUR (RPC unreachable) — installing the prebuilt binary" ;;
            esac
            install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
            exit 0
        fi
        if have dnf; then
            warn "Fedora/RHEL: no RPM is published yet — installing the prebuilt binary"
            install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
            exit 0
        fi
        install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
        ;;
    Darwin)
        if have brew; then
            info "macOS detected — installing via Homebrew"
            if brew tap himanshu-2010/homebrew-hmx 2>/dev/null; then
                brew install hmx && { info "Installed hmx. Verify with: hmx --version"; require_cc; exit 0; }
                warn "brew install failed — falling back to the release tarball"
            else
                warn "homebrew-hmx tap unavailable — falling back to the release tarball"
            fi
        fi
        install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
        ;;
esac
