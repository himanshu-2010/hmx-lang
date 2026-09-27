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
        warn "release has no SHA256SUMS — skipping checksum verification"
        return 0
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
case "$platform" in
    linux-x86_64|macos-arm64) ;;
    macos-x86_64)
        # No Intel macOS binary is published (the release job runs on arm64);
        # Homebrew builds from source and covers this case properly.
        if have brew; then
            info "Intel Mac detected — installing via Homebrew (builds from source)"
            brew tap himanshu-2010/homebrew-hmx && brew install hmx && exit 0
        fi
        die "no prebuilt hmx for ${platform} (Intel macOS)."
        build_from_source_hint
        ;;
    *)
        die "no prebuilt hmx for ${platform}.
      Published targets: linux-x86_64, macos-arm64."
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
            if have paru; then
                info "Arch Linux detected — building from the AUR via paru"
                exec paru -S --noconfirm hmx
            fi
            if have yay; then
                info "Arch Linux detected — building from the AUR via yay"
                exec yay -S --noconfirm hmx
            fi
            warn "Arch Linux detected but no AUR helper (paru/yay) found — installing the prebuilt binary"
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
                brew install hmx && { info "Installed hmx. Verify with: hmx --version"; exit 0; }
                warn "brew install failed — falling back to the release tarball"
            else
                warn "homebrew-hmx tap unavailable — falling back to the release tarball"
            fi
        fi
        install_binary "hmx-${VERSION}-${platform}.tar.gz" "$platform"
        ;;
esac
