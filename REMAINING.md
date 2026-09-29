# REMAINING.md

Everything still open on `hmx-lang`, grouped by **what is actually blocking it**
rather than by subsystem. Last updated 2026-09-29 against `main` @ `566c380`,
release `v0.10.0` @ `501188f`.

**Two of the four section-A items are now done.** A2 (winget) is merged-ready
with all ten upstream validation steps green, including the one that installs
the package on a real Windows runner. A3 (Homebrew) is resolved a different way
— see A3. A1 (AUR) is blocked, and the reason is worth knowing: registration
is behind an **Anubis anti-bot proof-of-work challenge**, so the sign-up form is
unreachable, not merely closed. A signed pacman repository now covers Arch in
the meantime (A5).

Nothing left here is a code problem. What remains is three things only you can
do: sign the Microsoft CLA, push to the AUR when registration reopens, and
confirm the GPG key is added to your GitHub account.

---

## Where things stand

| | |
|---|---|
| Release | `v0.10.0` published, 5 assets, all `HTTP 200` |
| CI | all 6 jobs green, including `packaging manifests` |
| Native tests | 478/478 (64 integration + 238 negative + 143 stress + 33 CLI) |
| Packaging gate | 130/130 |
| Valgrind | 69/69 |
| Web (vitest) | 455/455, `gen-data.mts` parity 0 failures |
| Container | `ghcr.io/himanshu-2010/hmx-lang:{0.10.0,latest}` verified, exit codes propagate |
| Arch users | signed pacman repo live at `himanshu-2010/hmx-pacman`, installed and tamper-tested |
| winget | PR [#442621](https://github.com/microsoft/winget-pkgs/pull/442621) — steps 01–10 all pass, waiting only on the CLA |

### Name availability — all four are free (re-checked 2026-09-28)

| Registry | Name | Result |
|---|---|---|
| AUR | `hmx` | free — RPC `{"resultcount":0}` |
| winget | `HMX.HMX` | free — `api.winget.run` 404 |
| Scoop | `hmx` | free — 404 in both Main and Extras |
| Homebrew core | `hmx` | free — `Formula/h/hmx.rb` 404 |

Worth re-checking immediately before each submission: these are the kind of name
someone else can take between writing a manifest and opening a PR.

---

## A. Blocked on your accounts

### A1. AUR — build verified; the block is Anubis, not a missing account

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

#### Why it is actually blocked (checked 2026-09-28, and it is not "registration is off")

`https://aur.archlinux.org/register` returns **HTTP 200** — the site is up, not
closed. What comes back is an **Anubis anti-bot page**: a proof-of-work challenge
that runs in JavaScript, and the real form is never delivered. `curl` sees
`"Anubis could not load its JavaScript"` and no `name="password"` field at all.

So this is not a policy decision to wait out, and there is no account to create
from here. A human with a real browser may well be able to register, because
Anubis's proof-of-work is solvable by a browser by design. The RPC endpoint
(`aur.archlinux.org/rpc/v5`) is *not* behind Anubis, which is why the installer
can still ask whether `hmx` is there and correctly gets `{"resultcount":0}`.

Until then, **A5 covers Arch users** with a signed repository built from this
same `PKGBUILD`.

### A2. winget-pkgs — the PR is open and all ten checks pass; only the CLA is left

**Status: submitted.** [microsoft/winget-pkgs#442621](https://github.com/microsoft/winget-pkgs/pull/442621)
is open with the three-file tree and every upstream validation step green.

```
01. Pull Request Validation         pass    23s
02. Manifest Validation            pass    25s   <- failed on the first attempt
03. URLs Validation               pass    38s
04. URL Domain Validation         pass    33s
05. Manifest Policy Validation    pass    16s
06. Catalog Content Verification  pass    39s
07. Installers Scan               pass   4m55s
08. Installation Validation       pass  32m32s  <- downloaded and installed on Windows
09. Installer Metadata Validation pass   1m3s
10. Validation Completed          pass    26s
```

Step 08 is the one that carries the weight: winget fetched the zip, checked the
sha256 against the manifest, installed it and verified the portable shim on a
real Windows runner. The digest still matches the release's `SHA256SUMS`. That
is stronger evidence than any local check, because it is the actual product
doing the actual thing.

**One thing left, and it is a legal agreement only you can accept.** The
`Needs-CLA` label blocks the merge. Post this as a comment on the PR:

```bash
# If hmx-lang is your own work and you are not submitting it for an employer:
gh pr comment 442621 --repo microsoft/winget-pkgs --body "@microsoft-github-policy-service agree"

# If you are submitting for a company, name it instead:
gh pr comment 442621 --repo microsoft/winget-pkgs --body '@microsoft-github-policy-service agree company="Company Name"'
```

#### The first submission failed, and the two reasons were not visible locally

Worth recording, because both would have been easy to walk past again. They came
from `doc/ValidationFailureGuide.md` in winget-pkgs, not from the schema — every
local validation said the manifest was fine.

1. **`Manifest-Version-Deprecated`.** The manifests declared `1.6.0`, which had
   been correct when written and stopped being correct on its own. The
   repository accepts **1.12.0** (and 1.10.0); anything older is rejected. Now
   1.12.0 in all three files *and* in their `# yaml-language-server` hints — the
   hint is what an editor validates against as you type, so bumping the field
   alone is the same bug in different clothes.

2. **`Manifest-Path-Error`.** The files were named `HMX.yaml`,
   `HMX.installer.yaml`, `HMX.locale.en-US.yaml`. winget-pkgs prefixes the
   filenames with the **whole `PackageIdentifier`**, so with `PackageIdentifier:
   HMX.HMX` the tree wants `HMX.HMX.yaml`, `HMX.HMX.installer.yaml` and
   `HMX.HMX.locale.en-US.yaml`. The *folders* were already right, which is
   exactly what made the layout look correct on inspection.

The copy step this replaces, with the naming bug fixed:

```bash
D=manifests/h/HMX/HMX/0.10.0
mkdir -p "$D"
cp packaging/winget/hmx.yaml             "$D/HMX.HMX.yaml"
cp packaging/winget/hmx.installer.yaml    "$D/HMX.HMX.installer.yaml"
cp packaging/winget/hmx.locale.en-US.yaml "$D/HMX.HMX.locale.en-US.yaml"
```

Because bug 2 was a *naming* bug, the packaging gate now **derives** the layout
instead of hardcoding it: it reads `PackageIdentifier` and `PackageVersion` out
of `packaging/winget/hmx.yaml`, builds the expected directory and filenames from
them, and checks that the copy step in that file's header names exactly those
paths. All six strings change together on a version bump, so hardcoding them
would have left the same trap armed until a CI run caught it. The gate also
asserts the identifier has one dot and two non-empty parts, since the derivation
only means anything for that shape.

Each new gate was confirmed by reintroducing its own bug — field back to 1.6.0,
hint moved only, pre-fix path documented again, identifier made dot-less — and
watching the suite go red on the expected check.

#### What is still not verified

`winget validate` itself has never been run, because it needs Windows. The
upstream pipeline covers the same ground and more, so this is now a formality
rather than a gap.

### A3. The brew formula: build verified, and macOS no longer needs brew

`himanshu-2010/homebrew-hmx/Formula/hmx.rb` is published and **byte-identical** to
`packaging/brew/hmx.rb`. Everything the formula *does* has been run. There is no
brew or ruby on this box, so instead of reading it I replicated it:
`git clone --branch v0.10.0` (what `url ..., tag:` makes brew do), then the three
`system` calls from `def install`, then the `test do` assertion.

```
$ git clone --depth 1 --branch v0.10.0 …   → 501188f, matching tag: "v0.10.0"
$ cmake -S . -B build -DCMAKE_BUILD_TYPE=Release   ok
$ cmake --build build                            [100%] Built target hmx
$ cmake --install build --prefix <prefix>        installs bin/hmx + share/doc/hmx/LICENSE
$ hmx --version                                  hmx 0.10.0    ← the test block passes
```

And the thing the formula's `test` block does *not* check — that the installed
binary compiles and runs something — also passes: a `for` loop over an array
prints `sum of squares: 14`.

#### macOS installs through `install.sh` now, with or without Homebrew

Since there is no Mac to test the brew wrapper on, the question became: does a Mac
*need* Homebrew? It no longer does. `install.sh` has a real
`build_from_source`, so a Mac with no brew is a supported machine rather than a
dead end:

- **Intel Mac** — no prebuilt binary exists (the release job runs on arm64 only).
  Previously this hit a wall of text ending in `exit 1`. It now builds from the
  release tag and installs.
- **arm64 Mac, brew present** — unchanged, the tap is used.
- **arm64 Mac, brew absent or the tap fails** — the prebuilt `macos-arm64`
  tarball, checksum-verified, as before.

`build_from_source` clones the **tag**, not `main`, so what lands is the same
source the release binaries came from. It checks for `git` and `cmake` up front
and names the remedy when they are missing (`xcode-select --install`, then
`brew install cmake`), because "cmake: command not found" after a successful
clone is not a useful thing to hand someone on a Mac. A failed build prints the
tail of the log instead of exiting silently. Installation goes to
`/usr/local/bin` if that is writable, else via `sudo`, else `~/.local/bin` with
the `PATH` line to add.

Verified by running the actual function on Linux: it cloned `v0.10.0`, built, and
the resulting binary printed `built from source, 2*3*4 = 24`. The macOS-specific
branch *around* it is the only part still argued on paper.

#### What is still unverified, and needs five minutes on a Mac

Homebrew's own wrapper, the `/opt/homebrew` prefix, the missing bottle, and
`install.sh`'s behaviour on a real Darwin machine. One of these is a genuine trap
worth restating: brew's `gcc` is **keg-only**, so `depends_on "gcc"` does *not*
put a compiler on `PATH`, and the formula's `caveats` block is the only place
that says so. `install.sh` does not paper over it — it probes for
`cc`/`gcc`/`clang` after installing and prints the remedy for the machine it is
on, but it cannot install a compiler for you.

```bash
brew tap himanshu-2010/homebrew-hmx
brew install hmx
hmx --version          # expect: hmx 0.10.0
which cc gcc clang     # one of the three must exist before `hmx run` works
```

### A4. GPG signing — working locally, one scope grant left

A key exists and works. `ed25519`, sign-only, no expiry, fingerprint
`E20338C6BEB6BBE978F913DBE6AED9C613DDCF5E`. Git is configured to sign both
commits and tags with it, and a signed commit and a signed tag were both created
and verified locally.

GitHub reports `verification.reason = unknown_key` for them, which is the
expected state until the public half is on the account: GitHub can see the
signature is valid GPG but cannot attribute it to you. Adding the key needs a
token scope the current one lacks, and `gh auth refresh` is interactive:

```bash
gh auth refresh -h github.com -s admin:gpg_key
gh api -X POST user/gpg_keys --field armored_public_key="$(cat hmx-signing-key.asc)"
```

**The key was generated with no passphrase and lives in `/tmp`, which does not
survive a reboot.** Do it properly on your own machine rather than adopting this
one — generate a key with a passphrase you remember, add that, and discard this
one:

```bash
gpg --full-generate-key          # ed25519, sign only, with a passphrase
gpg --armor --export <fpr> | tee hmx-signing-key.asc
gh auth refresh -h github.com -s admin:gpg_key
gh api -X POST user/gpg_keys --field armored_public_key="$(cat hmx-signing-key.asc)"
git config gpg.format openpgp
git config user.signingkey <fpr>
git config tag.gpgsign true
```

Until that happens, **the pacman repository below is signed with the `/tmp`
key**, and that fingerprint is the one `hmx-pacman` publishes. Replacing it means
re-signing the repo — `build-repo.sh` takes the fingerprint as an argument
precisely so that is a one-line change.

A4 also unblocked the pacman work: a third-party repository is only worth having
if it is signed.

### A5. Arch users are covered by a signed pacman repository (new, live)

**This is a stopgap, and its own README says so in those words.** A third-party
pacman repository is real infrastructure with real obligations: somebody is
promising that the bytes at that URL stay unchanged and stay signed. It exists
only because A1 is blocked, and it is strictly worse practice than the AUR for
anyone who can get an AUR account.

- Repository `github.com/himanshu-2010/hmx-pacman`, served over GitHub Pages at
  `https://himanshu-2010.github.io/hmx-pacman/`
- `SigLevel = Required DatabaseRequired` — pacman refuses both the database and
  the package without a trusted signature
- `build-repo.sh` fetches the `PKGBUILD` from **upstream**, not from a local
  checkout, so this cannot drift from the manifest the AUR submission will use

```bash
curl -fsSL https://himanshu-2010.github.io/hmx-pacman/hmx-signing-key.asc | gpg --import
gpg --lsign-key E20338C6BEB6BBE978F913DBE6AED9C613DDCF5E
echo -e "[hmx]\nSigLevel = Required DatabaseRequired\nServer = https://himanshu-2010.github.io/hmx-pacman/\$arch" \
  | sudo tee -a /etc/pacman.conf
sudo pacman -Sy hmx
```

Or the same thing plus the trust steps:

```bash
HMX_PACMAN_REPO=1 curl -fsSL https://raw.githubusercontent.com/himanshu-2010/hmx-lang/main/install/install.sh | bash
```

It is opt-in rather than the default because it edits `/etc/pacman.conf` and
imports a key; a `curl | bash` script should not do either uninvited. The default
Arch path is still the checksum-verified prebuilt tarball, and the AUR RPC is
still checked **first** on every run — the moment `hmx` appears there, install.sh
hands off and never reaches any of this.

#### How it was verified, including the control that nearly lied

Run against the published URL on an EndeavourOS box with a throwaway root and
keyring: `pacman -Sy` verified the database signature, resolved the dependency,
downloaded the package, installed it, and the installed `hmx` transpiled and ran a
program. All seven published files are byte-identical to what was built locally.

The control that matters is that a tampered package is **rejected**. Worth
recording how nearly that test proved nothing: the test config set
`SigLevel = Never` globally, and `pacman -U` reads the *global* level rather than
the repository's, so a package with one flipped byte sailed through signature
checking and only failed later, at zstd, with an error naming the wrong problem.
Under a global `Required` the same tampered package is rejected with `invalid or
corrupted package (PGP signature)`, and the untampered one installs.

`hmx.db` and `hmx.files` are committed as **real files, not symlinks**, even
though `repo-add` creates them as symlinks. Git stores a symlink as a small file
containing its target path, so committing them as-is makes pacman fetch the
literal text `hmx.db.tar.gz` and fail with a gzip error that points at entirely
the wrong thing. `build-repo.sh` dereferences them and then asserts none
survived.

**When A1 unblocks**, the intended order is: submit the AUR package, then point
`build-repo.sh` at the AUR tarball, or retire this repo and let `install.sh`
prefer the AUR. Do not let two channels disagree for long.

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

Read the tag column at the paths the tag actually uses, which are the
*pre-rename* ones — the tag predates both `PKGBUILD` and the scoop move:

```bash
git show v0.10.0:packaging/arch/PKBUILD     | grep -oiE '\b[0-9a-f]{64}\b' | head -1
git show v0.10.0:packaging/scoop/hmx.json   | grep -oiE '\b[0-9a-f]{64}\b' | head -1
grep -oiE '\b[0-9a-f]{64}\b' bucket/hmx.json | head -1
```

`main`'s column reads from the current paths. Note `hmx.installer.yaml` carries
its digest uppercase, which is what winget wants and what a lowercase-only grep
silently misses — a check written that way reports "no digest" on a file that has
one.

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

### C4. Three installer bugs found by reading, not by running

`install.ps1` and `install.sh` each had a way of reporting success they had not
achieved. All are fixed, and the general shape is worth remembering.

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

**"Installed" was claimed; "usable" never was.** `hmx` does not carry a C
compiler — it emits C and shells out to one on *every run*. So an install that
succeeds on a machine with no `cc`, `gcc` or `clang` gives a working `hmx -v` and
a first program that will not build. `install.ps1` mentioned the requirement in a
static sentence; `install.sh` did not mention it at all. Both now probe, and
`install.sh` prints the remedy *for the machine it is on* — `apt`, `dnf`,
`pacman`, `apk`, `xcode-select`, or the WinLibs UCRT under msys2 — because a list
that always leads with macOS advice is worse than no list.

This one is the cheapest of the three to get wrong and the easiest to miss,
because the install genuinely succeeded: `hmx` is on disk, `hmx --version` prints
`hmx 0.10.0`, and the user has no reason to suspect anything until a program
fails. It is worth separating the two claims in your head — *did it install?* is
answered by the file existing; *can it run anything?* is a different question
that nothing in the installer was asking.

The pattern across all six bugs in this file — the misnamed `PKGBUILD`, the
wrong tarball endpoint, the nonexistent `--destdir` flag, the swallowed exit
codes, the skipped verification, the unprobed toolchain — is that **each was a
locally plausible line of code that no review question would have caught.** A
manifest or installer is read as text, and text that looks right is right as far
as reading goes. Only running the thing verifies it — which is why the AUR
manifest, the brew formula and `require_cc` were all executed rather than
inspected, and why every gate added here was checked by reintroducing the bug it
covers. A gate that has never been seen to fail is not known to work.

Two of those six controls did not bite on the first attempt, which is the
argument for insisting on it. A pattern matching the tool names passed with the
probe deleted, because the *warning text* also contains the names — the same
trap as the AUR hand-off check earlier. And the brew `revision:` check required
a quote, so it passed against the unquoted form. Both were only caught because
the control was run rather than assumed.

---

## D. Deliberately not doing

- **Custom pacman repo** — **this was the decision, and it has been reversed.**
  The original reasoning was that the AUR is the idiomatic answer and a
  third-party repo is worse practice, which is true. What was wrong with the
  reasoning is that it assumed an AUR account was available. It is not right now
  (A1), so "the idiomatic channel is closed" became "Arch users get nothing",
  and a signed repository (A5) turned out to be the lesser evil — *because* it
  is signed, opt-in, and built from the same `PKGBUILD`. The reasoning was not
  wrong about the trade-off; it was wrong about the world. Worth recording,
  because the failure mode here is a principle outliving the fact that produced
  it.
- **RPM / Fedora** — `install.sh` already falls back to the verified tarball on
  `dnf` systems with an explicit "no RPM is published yet" warning. Unchanged:
  there is no blocked channel here, so there is no argument for the workaround.
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
./tests/run_packaging_tests.sh      # 130 manifest / workflow / installer gates

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
