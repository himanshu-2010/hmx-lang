#!/usr/bin/env bash
# hmx — distro-aware installer for Linux & macOS.
#
# Detects the OS/package manager and installs the best available option:
#   apt ·.deb   → Debian/Ubuntu
#   pacman/AUR  → Arch Linux (via paru/yay, else binary fallback)
#   brew        → macOS Homebrew
#   dnf         → Fedora (no RPM yet; prebuilt binary fallback)
#   otherwise   → prebuilt binary tarball from the GitHub Release
#
# Windows: use install.ps1 instead (this script bails out with a hint).
set -euo pipefail

VERSION="${HMX_VERSION:-0.9.0}"
REPO="himanshu-2010/hmx-lang"
BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

info() { printf '\033[1;35mhmx\033[0m \033[1;97m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mhmx\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mhmx\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

install_binary() { # <asset-label> e.g. linux/x86_64
    local url="$1" label="$2" tmp
    tmp="$(mktemp -d)"
    info "Downloading ${url}"
    curl -fsSL "$url" -o "$tmp/pkg.tgz"
    tar -xzf "$tmp/pkg.tgz" -C "$tmp"
    local bin="$tmp/bin/hmx"
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

# ── Detect platform ──────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
    x86_64|amd64) barch="x86_64" ;;
    aarch64|arm64) barch="arm64" ;;
    *) die "unsupported architecture: ${arch}" ;;
esac

case "$os" in
    Linux)
        if have apt-get; then
            info "Debian/Ubuntu detected — installing the .deb package"
            curl -fsSL "$BASE/hmx_${VERSION}_amd64.deb" -o /tmp/hmx.deb
            if have sudo; then sudo apt-get install -y /tmp/hmx.deb
            else apt-get install -y /tmp/hmx.deb; fi
            info "Installed hmx v${VERSION}. Verify with: hmx --version"
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
            warn "Arch Linux detected but no AUR helper (paru/yay) found — using the prebuilt binary"
            install_binary "$BASE/hmx-${VERSION}-linux-${barch}.tar.gz" "linux/${barch}"
            exit 0
        fi
        if have dnf; then
            warn "Fedora: no RPM package yet — installing the prebuilt binary"
            install_binary "$BASE/hmx-${VERSION}-linux-${barch}.tar.gz" "linux/${barch}"
            exit 0
        fi
        install_binary "$BASE/hmx-${VERSION}-linux-${barch}.tar.gz" "linux/${barch}"
        ;;
    Darwin)
        if have brew; then
            info "macOS detected — installing via Homebrew"
            brew tap himanshu-2010/homebrew-hmx
            brew install hmx
            exit 0
        fi
        install_binary "$BASE/hmx-${VERSION}-macos-${barch}.tar.gz" "macos/${barch}"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        warn "Windows detected — use install.ps1 instead:"
        warn "  powershell -ExecutionPolicy Bypass -f install.ps1 -VERSION ${VERSION}"
        exit 1
        ;;
    *)
        die "unsupported operating system: ${os}"
        ;;
esac