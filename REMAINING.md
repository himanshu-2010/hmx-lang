# REMAINING.md

Everything still open on `hmx-lang`, grouped by **what is actually blocking it**
rather than by subsystem. Written 2026-09-27 against `main` @ `c6d90df`,
release `v0.10.0` @ `501188f`.

Nothing in section A is a code problem. The manifests are written, pinned to
real digests, and validated — they need an account to push from. The AUR
manifest has been through a real `makepkg` build; the others have been checked
against their registries' own schemas but not installed from.

---

## Where things stand

| | |
|---|---|
| Release | `v0.10.0` published, 5 assets, all `HTTP 200` |
| CI | all 6 jobs green, including `packaging manifests` |
| Native tests | 478/478 (64 integration + 238 negative + 143 stress + 33 CLI) |
| Packaging gate | 104/104 |
| Valgrind | 69/69 |
| Web (vitest) | 455/455, `gen-data.mts` parity 0 failures |
| Container | `ghcr.io/himanshu-2010/hmx-lang:{0.10.0,latest}` verified, exit codes propagate |

### Name availability — all four are free (checked 2026-09-27)

| Registry | Name | Result |
|---|---|---|
| AUR | `hmx` | free — RPC `resultcount: 0` |
| winget | `HMX.HMX` | free — `api.winget.run` 404 |
| Scoop | `hmx` | free — absent from Main and Extras |
| Homebrew core | `hmx` | free — `Formulae/h/hmx.rb` 404 |

---

## A. Blocked on your accounts

### A1. AUR — build verified, only the push is left

`packaging/arch/PKGBUILD` is finished **and was verified by actually running
`makepkg`**, which caught three bugs that no amount of reading would have:

1. **The file was named `PKBUILD`, not `PKGBUILD`.** `makepkg` requires the
   exact name, so the submission could never have worked, and the docs' own
   `cp packaging/arch/PKGBUILD .` pointed at a path that did not exist. Nothing
   caught it, because every check in the packaging gate referenced the same
   wrong path — the gate agreed with the mistake.
2. **The pinned digest was for the wrong artifact.** GitHub's
   `/archive/refs/tags/v0.10.0.tar.gz` and `/tarball/v0.10.0` are *different
   tarballs* — different root directory (`hmx-lang-0.10.0` vs
   `himanshu-2010-hmx-lang-501188f`) and different bytes. The digest had been
   taken from the wrong endpoint, so `makepkg` failed at
   `hmx-0.10.0.tar.gz ... FAILED`.
3. **`package()` used `cmake --install build --destdir "$pkgdir"`.** There is no
   `--destdir` flag; `DESTDIR` is an environment variable. The manifest parses,
   the build links and `check()` passes *before* this bites, so it failed at the
   very last step, only on a real Arch machine.

Verified result: `hmx-0.10.0-1-x86_64.pkg.tar.zst` builds, installs
`usr/bin/hmx`, and that binary transpiles and runs a program.

To reproduce the build:

```bash
mkdir -p /tmp/hmx-pkg && cp packaging/arch/PKGBUILD /tmp/hmx-pkg/
cd /tmp/hmx-pkg && makepkg          # add -si to install it
```

Then submit (one-time setup: register at <https://aur.archlinux.org/register>,
add an SSH public key under Settings → SSH Public Keys):

```bash
git clone https://aur.archlinux.org/hmx.git && cd hmx
cp /path/to/hmx-lang/packaging/arch/PKGBUILD .
makepkg --printsrcinfo > .SRCINFO      # AUR requires this alongside PKGBUILD
git add PKGBUILD .SRCINFO
git commit -m 'hmx 0.10.0'
git push
```

`.SRCINFO` is a cache the AUR web interface regenerates, but it must be committed
or the package page is blank until something does. This is the real output of
`makepkg --printsrcinfo` on the current `PKGBUILD` — after your `cp`, diff yours
against it and they should be identical. If `sha256sums` is anything other than
`bafbf002…` you have picked up the wrong tarball (see C2).

```
pkgbase = hmx
	pkgdesc = HMX — a small statically typed systems language that transpiles to C
	pkgver = 0.10.0
	pkgrel = 1
	url = https://github.com/himanshu-2010/hmx-lang
	arch = x86_64
	license = MIT
	makedepends = cmake
	makedepends = ninja
	makedepends = flex
	makedepends = bison
	makedepends = git
	depends = gcc
	source = hmx-0.10.0.tar.gz::https://github.com/himanshu-2010/hmx-lang/archive/refs/tags/v0.10.0.tar.gz
	sha256sums = bafbf0023bbf6b72d4683c17bf5944af1e1e859fc75fe91ae1d6d8ff958bb12a

pkgname = hmx
```

After the push, `yay -S hmx` becomes the path `install.sh` takes instead of the
prebuilt tarball, and the "not in the AUR yet" warning on Arch goes away.

### A2. winget-pkgs — the manifest is now valid, it just needs a PR

The single-file manifest this repo used to carry was **schema-invalid**: it
declared `ManifestType: singleton` (that value belongs in the version manifest)
and put the locale fields inside the installer file. `winget validate` rejects
that with `'installer' was expected`. It is now the proper three-file tree, and
all three validate against the real `winget-manifest.*.1.6.0` schemas.

```bash
# 1. Fork microsoft/winget-pkgs, then:
git clone https://github.com/<you>/winget-pkgs.git && cd winget-pkgs
D=manifests/h/HMX/HMX/0.10.0
mkdir -p "$D"
cp /path/to/hmx-lang/packaging/winget/hmx.yaml             "$D/HMX.yaml"
cp /path/to/hmx-lang/packaging/winget/hmx.installer.yaml    "$D/HMX.installer.yaml"
cp /path/to/hmx-lang/packaging/winget/hmx.locale.en-US.yaml "$D/HMX.locale.en-US.yaml"
# 2. Validate before pushing — the linter is the gate, not review:
wingetcreate --help    # or: winget-cli validate --manifests manifests/h/HMX
# 3. PR the fork into microsoft/winget-pkgs
```

The identity is `HMX.HMX`, so the directory is `manifests/h/HMX/HMX/0.10.0/`
and all three files are named `HMX.*` — winget derives the filename from the
identifier and rejects a mismatch. That layout was reproduced locally and all
three files validate in place, but `winget validate` itself has not been run,
since it needs Windows.

### A3. `brew install` has never actually been run

`himanshu-2010/homebrew-hmx/Formula/hmx.rb` is published and **byte-identical** to
`packaging/brew/hmx.rb`. Nobody has ever installed from it:

```bash
brew tap himanshu-2010/homebrew-hmx
brew install hmx
hmx --version          # expect: hmx 0.10.0
```

`install.sh` reaches for this tap automatically on macOS, so an untested formula
is a live path today, not only a manual one.

Needs a Mac or Linuxbrew — not something I can do from here. The formula builds
from the git tag rather than a release tarball, because the release only ships a
macOS arm64 tarball and Homebrew must also install on Intel.

### A4. GPG signing

Unsigned release artifacts and installer scripts. If you want signed tags plus
`SHA256SUMS.sig`, that is your key to add.

---

## B. No credentials needed — say the word

Scoop is no longer in this section: it is fixed. `bucket/hmx.json` is where
scoop looks, `scoop bucket add` + `scoop install hmx` now work for real, and
`install.ps1` no longer reports success it did not achieve (see C4).

### B1. There is no REPL, and that is the honest answer to "how do I open a shell"

`hmx shell` and `hmx repl` **do not exist**. The complete CLI is:

```
hmx <file.hmx> [options]     Transpile, compile and execute
hmx run   <file.hmx> [opts]  Same as above (explicit)
hmx build <file.hmx> [opts]  Transpile and compile to a binary only
hmx new   <name>             Scaffold a new .hmx file
hmx -h | --help              Show this help
hmx -v | --version           Show the version

Options: -keep-c   Keep the intermediate .c file
         -o <path> Output binary path (with build)
```

A REPL is roadmap item **M24** — `hmx repl` via the JS parity runtime under Node
for instant eval — and **M25** is `hmx fmt` + `hmx lsp` + `hmx pkg add <url>`.
See `ROADMAP.md` §7 ("Batch E — Tooling").

It cannot be a thin wrapper over the native pipeline: `hmx` lexes, parses,
type-resolves, emits C and shells out to gcc. There is no incremental evaluation
to hang a loop on, which is exactly why M24 routes through the JS compiler.

The closest thing that works today is a program that reads stdin. This exact
program was extracted from this file and run:

```bash
cat > echo.hmx <<'EOF'
fn main() {
    loop (1000000) {
        let line = input()
        if (line == "") { break }
        print(">>", line)
    }
    print("bye")
}
EOF
hmx run echo.hmx
```

It echoes what you type, so it feels REPL-adjacent and isn't: it cannot evaluate
anything, because evaluating is the part the compiler cannot do incrementally.

---

## C. Sharp edges — please don't

### C1. Do not re-cut the `v0.10.0` tag

The three manifest digests live in `main` and describe the release **as
published**. Re-cutting the tag rebuilds the archives, which changes those
digests, which turns `packaging manifests` red and makes every manifest wrong
for the release people are actually downloading.

The tag's own copies of the manifests are one release behind `main` and that is
expected — the tag is the source of the binaries, the manifests live in `main`
and are what gets submitted:

```
PKGBUILD           tag=7555427a  main=bafbf002  (skewed, by design)
hmx.json           tag=91095fe4  main=659260db  (skewed, by design)
hmx.installer.yaml tag=91095fe4  main=659260db  (skewed, by design)
```

If you must re-cut: re-pin the three digests from the *new* release afterwards
and re-run `./tests/run_packaging_tests.sh`.

### C2. GitHub's two tarball endpoints are not the same bytes

This one cost a full `makepkg` round trip, so it is worth spelling out.

```
/archive/refs/tags/v0.10.0.tar.gz   root dir: hmx-lang-0.10.0/                sha256 bafbf002…  <- the one the PKGBUILD fetches
/tarball/v0.10.0                   root dir: himanshu-2010-hmx-lang-501188f/   sha256 50323ddb…  <- what `gh api` gives you
```

The `PKGBUILD` fetches `/archive/refs/tags/…`, so **that** is the URL whose
digest must be pinned — and it is not the one any obvious command hands you.
`gh api repos/…/tarball/v0.10.0` returns the `/tarball/` variant, a *different
artifact* despite pointing at the same commit. Taking a digest from there, or
from the release page, produces a manifest that fails `Validating source files
with sha256sums` — which is exactly what happened here: the pinned value was
`50323ddb`, the wrong endpoint, and `makepkg` rejected it.

(The third value you'll see quoted anywhere, `7555427a`, is neither. It is the
digest the **tag's own** copy of the PKGBUILD carries, left over from before the
tag was re-cut — see C1.)

The reliable procedure — fetch the exact URL the `PKGBUILD` itself declares,
expand its variables, hash the result. Verified end to end:

```bash
pkgver=$(sed -n "s/^pkgver=//p" packaging/arch/PKGBUILD)
url=$(sed -n "s|.*source=(.*https://\([^'\"]*\)['\"].*|\1|p" packaging/arch/PKGBUILD | head -1)
curl -sL "https://${url//\$\{pkgver\}/$pkgver}" -o /tmp/src.tar.gz
sha256sum /tmp/src.tar.gz
```

Two traps in that snippet, both of which cost a round trip. Anchor the `sed` on
`source=(` — otherwise it matches the `url=` line above it and you silently
download the repository homepage. And the URL contains `${pkgver}`, so it has to
be expanded before it will fetch anything.

Two further consequences: `_src()` must not guess the extracted directory name
(ours locates the tree containing `CMakeLists.txt`, so it is correct for either
root), and any digest you record must come from the file the consumer downloads,
not from a convenient API call.

### C3. `v0.10.0` was re-cut once, already

It was first published at `500dfa6` without a `.deb` — `cpack` wrote it into
`build/`, the upload glob was root-relative, and an unmatched glob is only a
warning, so the release went green missing a file `install.sh` requires on
Debian/Ubuntu. The tag now points at `501188f` and the release has all five
assets. It was re-cut within the hour and had zero external consumers, so
nothing observed the change. **Any further re-cut does have observers.**

### C4. Two installer bugs found by reading, not by running

`install.ps1` had two ways to report success it had not achieved. Both are now
fixed, and the general shape is worth remembering.

**A failed `winget install` or `scoop install` printed "installed!" and
`exit 0`.** The script sets `$ErrorActionPreference = "Stop"`, which escalates
*cmdlet* errors and does nothing whatsoever for a native command's exit code.
`winget` and `scoop` are native commands, so a failure only set `$? = $false`
and fell straight through to the success message. There is no preference
variable that saves you here: `$PSNativeCommandUseErrorActionPreference`
arrived in PowerShell 7.4, defaults to `$false`, and the invocation in this
file's own header is `powershell` — Windows PowerShell 5.1, which does not have
it at all. The fix is to test `$LASTEXITCODE` and `throw`, since a `throw` *is*
catchable.

**A release with no `SHA256SUMS` installed an unverified binary.** Both
installers warned and continued. `install.sh`'s own header said "an unverified
binary is never installed" three lines above a function that did exactly that.
Every release ships the sums — the release workflow asserts the asset exists — so
their absence is a fault, not a choice, and both installers now refuse.

Both were verified against a stub HTTP server serving the real asset with the
sums withheld, with the sums present but no matching entry, and with a tampered
asset: all three refuse, and the clean case still installs.

The pattern across all five bugs in this file — the misnamed `PKGBUILD`, the
wrong tarball endpoint, the nonexistent `--destdir` flag, the swallowed exit
codes, the skipped verification — is that **each was a locally plausible line
of code that no review question would have caught.** A manifest or installer is
read as text, and text that looks right is right as far as reading goes. Only
running the thing verifies it.

---

## D. Deliberately not doing

- **Custom pacman repo** — the AUR is the idiomatic answer, and an unsigned
  third-party repo is worse practice than the AUR.
- **RPM / Fedora** — `install.sh` already falls back to the verified tarball on
  `dnf` systems with an explicit "no RPM is published yet" warning.
- **Nix, Flatpak, Snap** — not started, no plan.

---

## E. Regression suites worth knowing about

Each is standalone; there is no single "test" command. All from `hmx-lang/`.

```bash
cmake --build build

./tests/run_integration.sh          # 64  .hmx fixture programs, exit 0 = pass
./tests/run_negative_tests.sh       # 238 compile-error cases
./tests/run_stress_tests.sh         # 143 exact-stdout + exit-code cases
./tests/run_cli_tests.sh           # 33 CLI behaviour cases
./tests/run_packaging_tests.sh      # 104 manifest / workflow / installer gates

./tests/run_valgrind_tests.sh --fixtures          # 69 ownership checks
HMX_ASAN=1 ./tests/run_stress_tests.sh             # ASan + LeakSanitizer

npx vite-node web-playground/tools/smoke/gen-data.mts   # re-snapshot + parity
npm run test        # 455 vitest
npm run lint        # oxlint
npx tsc --noEmit -p tsconfig.app.json
```

The valgrind runner executes the **generated binary**, never the compiler, so a
compiler leak cannot mask or fake a failure. It is the gate for any codegen or
runtime change.
