import { CodeBlock } from "./CodeBlock";
import "./pages.css";

/**
 * Every command here is also in README.md's Install section, and the packaging
 * gate checks that each one appears in both files. That gate exists because this
 * page is the one a visitor is most likely to act on and the one most likely to
 * rot: a released installer URL or a changed package name is a broken page, and
 * nobody notices until someone is standing at a terminal following it.
 */
interface Channel {
  name: string;
  tag?: string;
  best?: boolean;
  code: string;
  note?: React.ReactNode;
}

const channels: Channel[] = [
  {
    name: "Linux, macOS",
    tag: "any",
    best: true,
    code: "curl -fsSL https://raw.githubusercontent.com/himanshu-2010/hmx-lang/main/install/install.sh | bash",
    note: (
      <>
        Picks the right path for your system: the <code>.deb</code> on
        Debian/Ubuntu, the AUR on Arch, Homebrew on macOS, and a checksum-verified
        prebuilt tarball everywhere else. Pin a release with{" "}
        <code>HMX_VERSION=0.10.0</code>.
      </>
    ),
  },
  {
    name: "Windows",
    tag: "PowerShell",
    best: true,
    code: "curl -fsSL https://raw.githubusercontent.com/himanshu-2010/hmx-lang/main/install/install.ps1 | powershell -Command -",
    note: "Tries winget, then Scoop, then a checksum-verified zip.",
  },
  {
    name: "Debian, Ubuntu",
    tag: "package",
    code: "sudo apt install ./hmx_0.10.0_amd64.deb",
    note: (
      <>
        Download the <code>.deb</code> from the{" "}
        <a href="https://github.com/himanshu-2010/hmx-lang/releases" target="_blank" rel="noreferrer">
          GitHub release
        </a>
        . The release also carries <code>SHA256SUMS</code> if you would rather
        check the download first.
      </>
    ),
  },
  {
    name: "Arch Linux",
    tag: "AUR",
    code: "paru -S hmx",
    note: (
      <>
        The pacman repository below is an alternative, opt-in, and says so itself.
        It exists because the AUR was unreachable at the time — not because it is
        better.
      </>
    ),
  },
  {
    name: "Arch, signed repository",
    tag: "pacman",
    code: `curl -fsSL https://himanshu-2010.github.io/hmx-pacman/hmx-signing-key.asc | gpg --import
sudo pacman-key --lsign 3D987F64DC5DE0F56A383805117A9800DEC4FCCC
echo "[hmx]
SigLevel = Required DatabaseRequired
Server = https://himanshu-2010.github.io/hmx-pacman/\\$arch" | sudo tee -a /etc/pacman.conf
sudo pacman -Sy hmx`,
    note: (
      <>
        Or let the installer wire it up:{" "}
        <code>HMX_PACMAN_REPO=1</code> in front of the Linux command above. It is
        opt-in because it edits <code>/etc/pacman.conf</code> and imports a key,
        and a <code>curl | bash</code> script should not do either uninvited.
      </>
    ),
  },
  {
    name: "macOS, Homebrew",
    tag: "brew",
    code: "brew tap himanshu-2010/homebrew-hmx && brew install hmx",
  },
  {
    name: "Docker",
    tag: "container",
    code: 'docker run --rm -v "$PWD:/src" ghcr.io/himanshu-2010/hmx run main.hmx',
    note: (
      <>
        Runs as uid 1000, so the mounted directory has to be writable by the
        container user. Elsewhere add{" "}
        <code>--user "$(id -u):$(id -g)"</code>.
      </>
    ),
  },
];

export function InstallPage() {
  return (
    <main className="page">
      <div className="page-inner">
        <span className="page-eyebrow">Get hmx</span>
        <h1 className="page-title">Install</h1>
        <p className="page-lede">
          The <code>hmx</code> compiler runs on Linux, macOS and Windows. Every
          option below installs the same compiler and verifies its download
          against the release's <code>SHA256SUMS</code>. All of them are free and
          open source.
        </p>

        <div className="page-note">
          <strong>You need a C compiler.</strong> <code>hmx</code> transpiles a{" "}
          <code>.hmx</code> program to C and compiles it, so <code>gcc</code>,{" "}
          <code>cc</code> or <code>clang</code> must be on your <code>PATH</code>.
          The Docker image bundles one. Every installer checks for this and tells
          you how to get it if it is missing, rather than reporting a successful
          install and failing on your first program.
        </div>

        <h2 className="page-h2">Installers</h2>

        {channels.map((c) => (
          <section className="channel" key={c.name}>
            <div className="channel-head">
              <span className="channel-name">{c.name}</span>
              {c.tag ? (
                <span className={c.best ? "channel-tag channel-tag-best" : "channel-tag"}>
                  {c.tag}
                </span>
              ) : null}
            </div>
            <CodeBlock label={c.tag ?? "shell"} code={c.code} />
            {c.note ? <p className="channel-note">{c.note}</p> : null}
          </section>
        ))}

        <h2 className="page-h2">From source</h2>
        <p className="page-p">
          You will need a C++17 compiler, <code>cmake</code> 3.16 or newer,{" "}
          <code>flex</code>, <code>bison</code>, and <code>bash</code> for the test
          scripts. On Debian or Ubuntu:{" "}
          <code>sudo apt install build-essential cmake flex bison</code>.
        </p>
        <CodeBlock
          label="shell"
          code={`git clone https://github.com/himanshu-2010/hmx-lang.git
cd hmx-lang
cmake -S . -B build
cmake --build build
./build/hmx run examples/hello.hmx`}
        />

        <h2 className="page-h2">Prebuilt binaries</h2>
        <p className="page-p">
          Published for <code>linux-x86_64</code>, <code>macos-arm64</code> and{" "}
          <code>windows-x86_64</code>. Any other combination — Linux on ARM, for
          instance — is told how to build from source rather than handed a 404.
        </p>

        <h2 className="page-h2">Verify what you downloaded</h2>
        <p className="page-p">
          Each release ships a <code>SHA256SUMS</code>. If you fetched a release
          archive or a binary tarball by hand, check it before running it:
        </p>
        <CodeBlock
          label="shell"
          code={`curl -fsSLO https://github.com/himanshu-2010/hmx-lang/releases/download/v0.10.0/SHA256SUMS
sha256sum -c SHA256SUMS`}
        />
        <p className="page-note">
          Prefer the installers above when there is one for your platform: they
          check the sum themselves, so there is no step to forget.
        </p>
      </div>
    </main>
  );
}