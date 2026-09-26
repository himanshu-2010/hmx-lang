import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRunner } from "./runner-context";
import { useDebouncedCallback } from "./useDebouncedCallback";
import { Highlight } from "./Highlight";
import { HeroTerminal } from "./HeroTerminal";
import "./home.css";

const GITHUB_URL = "https://github.com/himanshu-2010/hmx-lang";

const stats = [
  { value: "358", label: "native regression cases, all green" },
  { value: "358", label: "web vs native — byte-identical" },
  { value: "134", label: "runnable examples in the docs" },
  { value: "0", label: "backend — it compiles in your tab" },
];

const marqueeWords = [
  "closures", "tuples", "destructuring", "modules", "lambdas", "currying",
  "static types", "unicode", "arrays", "loops", "use imports", "first-class fn",
];

interface Feature {
  num: string;
  icon: ReactNode;
  title: string;
  body: string;
  code: string;
}

const iconPath = (d: string) => <path d={d} />;

const features: Feature[] = [
  {
    num: "01",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        {iconPath("M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1")}
      </svg>
    ),
    title: "Static & inferred types",
    body: "int, decimal, text, bool, char, byte — plus arrays, tuples, and first-class fn types. Local types are inferred, function signatures are checked.",
    code: "let x: int = 21 * 2",
  },
  {
    num: "02",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {iconPath("M5 4l14 6-6 2-2 6zM19 19l-4-4")}
      </svg>
    ),
    title: "Functions & closures",
    body: "Functions are values. Capture scoped state by value, build lambdas, curry with '...', and compose with higher-order helpers.",
    code: "return x + base",
  },
  {
    num: "03",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        {iconPath("M3 6h18M3 12h13M3 18h9")}
      </svg>
    ),
    title: "Tuples & destructuring",
    body: "Return multiple values, swap in place, index into a group, or destructure any tuple with a pattern — down to nested levels.",
    code: "let (lo, hi) = bounds",
  },
  {
    num: "04",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {iconPath("M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5")}
      </svg>
    ),
    title: "Modules & Unicode",
    body: "import another .hmx file with use \"...\", share state across files, and write identifiers in any language — Unicode is welcome.",
    code: 'use "lib/math.hmx"',
  },
  {
    num: "05",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {iconPath("M21 12a9 9 0 1 1-9-9M21 3v6h-6")}
      </svg>
    ),
    title: "The full loop family",
    body: "while, for (init; cond; update), loop (n) for counted reps, and foreach over arrays — with break, continue, and non-local exits.",
    code: "loop (n) { total += 1 }",
  },
  {
    num: "06",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {iconPath("M4 6h16M4 10h16M4 14h10M4 18h7M7 6V4M12 6V4")}
      </svg>
    ),
    title: "Runs in this browser",
    body: "The full pipeline — lexer, LALR parser, type resolver, codegen — ships as JS and executes a tiny runtime right here. No server.",
    code: 'print("hello, world")',
  },
];

const samples = [
  {
    tab: "closures",
    caption:
      "Functions are values. make_adder captures base by value and hands back a closure — each call builds its own state.",
    code: `fn make_adder(base: int) -> fn(int) -> int {
    fn add(x: int) -> int {
        return x + base
    }
    return add
}

fn main() {
    let plus5 = make_adder(5)
    let plus7 = make_adder(7)
    print(plus5(37))
    print(plus7(35))
}`,
    output: "42\n42",
  },
  {
    tab: "tuples",
    caption:
      "Tuples and destructuring: return multiple values from one call and pull them apart — or index straight into the group.",
    code: `fn stats(nums: [int]) -> (int, int) {
    return (nums[0] + nums[1], nums[2])
}

fn main() {
    let (lo, hi) = stats([1, 2, 3])
    print("lo:", lo, "hi:", hi)
}`,
    output: "lo: 3 hi: 3",
  },
  {
    tab: "loops",
    caption:
      "A counted loop, an early break, then a header-controlled for loop. Every construct compiles straight to efficient native code.",
    code: `fn main() {
    let total = 0
    loop (10) {
        total = total + 1
        if (total == 42) {
            break
        }
    }
    for (let i = 0; i < 3; i++) {
        print(i)
    }
    print("total:", total)
}`,
    output: "0\n1\n2\ntotal: 10",
  },
];

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("revealed");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("revealed");
            io.disconnect();
          }
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function SpotlightCard({ feature }: { feature: Feature }) {
  return (
    <article
      className="feature-card"
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <span className="feature-num">{feature.num}</span>
      <span className="feature-icon">{feature.icon}</span>
      <h3>{feature.title}</h3>
      <p>{feature.body}</p>
      <code className="feature-code">
        <Highlight code={feature.code} />
      </code>
    </article>
  );
}

export function HomePage() {
  const { dispatch } = useRunner();
  const navigate = useNavigate();
  const [activeSample, setActiveSample] = useState(0);

  // loading an example compiles it — debounce rapid double-clicks.
  const openInPlayground = useDebouncedCallback((code: string) => {
    dispatch({ type: "loadExample", source: code });
    navigate("/playground");
  }, 250);

  return (
    <div className="home-scroll">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <div className="hero-grid" />
          <div className="hero-vignette" />
        </div>

        <div className="hero-inner">
          <Reveal>
            <span className="hero-eyebrow">
              <span className="script-word">HMX</span> — compiler · web edition
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1>
              Think in types.
              <br />
              <span className="grad">Compile in your tab.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="hero-sub">
              HMX is a small, statically typed systems language with a native
              C++ toolchain — and a full twin that compiles and runs{" "}
              <em>right here in your browser</em>. No server, no install.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="hero-cta">
              <Link className="btn-primary" to="/playground">
                Try the compiler →
              </Link>
              <Link className="btn-ghost" to="/docs">
                Read the docs
              </Link>
              <a
                className="btn-ghost"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </div>
          </Reveal>

          <Reveal delay={320} className="hero-card-wrap">
            <div className="hero-card">
              <div className="hero-card-head">
                <span className="hero-card-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="hero-card-file">main.hmx</span>
                <span className="hero-card-status">exit {0} · compiled in-tab</span>
              </div>
              <pre>
                <code>
                  <Highlight code={samples[0].code} />
                </code>
              </pre>
              <HeroTerminal />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────── */}
      <section className="stats" aria-label="HMX by the numbers">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* ── Marquee ───────────────────────────────────────── */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <span key={dup}>
              {marqueeWords.map((w) => (
                <b key={w}>
                  {w} <em>✦</em>
                </b>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────── */}
      <section className="section">
        <Reveal>
          <span className="section-eyebrow">The language</span>
          <h2 className="section-title">Small by design. Fast by construction.</h2>
          <p className="section-lede">
            HMX walks a tight pipeline from source to native code: Flex lex the
            tokens, LALR parse the grammar, resolve every type, then emit C and
            hand it to gcc -O2. The browser build runs the exact same stages
            with a byte-identical output contract.
          </p>
        </Reveal>

        <div className="about-grid">
          <Reveal delay={80}>
            <div className="pipeline-card">
              <div className="pipeline-label">Compiler pipeline</div>
              <div className="pipeline-flow">
                <span className="node">lexer</span>
                <span className="arrow">→</span>
                <span className="node">parser</span>
                <span className="arrow">→</span>
                <span className="node">resolver</span>
                <span className="arrow">→</span>
                <span className="node">codegen</span>
                <span className="arrow">→</span>
                <span className="node">gcc -O2</span>
              </div>
              <p className="pipeline-foot">
                The same grammar drives both backends. Native emits C; the web
                one emits JS and runs a tiny runtime — no WASM, no backend,
                no bundle surprises.
              </p>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="fact-sheet">
              <div className="fact-row">
                <span className="k">Toolchain</span>
                <span className="v">Flex · Bison · C++</span>
              </div>
              <div className="fact-row">
                <span className="k">Pipeline</span>
                <span className="v">lexer → parser → resolver → codegen</span>
              </div>
              <div className="fact-row">
                <span className="k">Runtime</span>
                <span className="v">tiny, no GC, no VM</span>
              </div>
              <div className="fact-row">
                <span className="k">Browser twin</span>
                <span className="v">
                  <em>358/358</em> byte-identical cases
                </span>
              </div>
              <div className="fact-row">
                <span className="k">Docs</span>
                <span className="v">
                  <em>134</em> runnable examples
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────── */}
      <section className="section">
        <Reveal>
          <span className="section-eyebrow">What&apos;s inside</span>
          <h2 className="section-title">A tight set of ideas, done properly.</h2>
          <p className="section-lede">
            No kitchen sink. Every feature earns its place and composes — hover
            a card to see how it looks in HMX.
          </p>
        </Reveal>
        <div className="features-grid">
          {features.map((f, i) => (
            <Reveal key={f.num} delay={Math.min(i * 60, 300)}>
              <SpotlightCard feature={f} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Samples ───────────────────────────────────────── */}
      <section className="section">
        <Reveal>
          <span className="section-eyebrow">A taste of HMX</span>
          <h2 className="section-title">Read it. Run it.</h2>
          <p className="section-lede">
            Each snippet below is compiled and verified by the native toolchain
            — the shown output is the exact stdout. Open any one straight into
            the playground.
          </p>
        </Reveal>

        <div className="samples-tabs" role="tablist" aria-label="HMX samples">
          {samples.map((s, i) => (
            <button
              key={s.tab}
              role="tab"
              aria-selected={i === activeSample}
              className={`sample-tab ${i === activeSample ? "sample-active" : ""}`}
              onClick={() => setActiveSample(i)}
            >
              {s.tab}
            </button>
          ))}
        </div>

        <Reveal>
          <p className="sample-caption">{samples[activeSample].caption}</p>
          <div className="sample-stage">
            <div className="sample-code-box">
              <div className="sample-code-bar">
                <span>{samples[activeSample].tab}.hmx</span>
              </div>
              <pre className="sample-code-body">
                <code>
                  <Highlight code={samples[activeSample].code} />
                </code>
              </pre>
            </div>
            <div className="sample-side">
              <div className="sample-output-box">
                <div className="sample-output-bar">stdout</div>
                <pre className="sample-output">{samples[activeSample].output}</pre>
              </div>
              <div className="sample-run">
                <button
                  className="btn-primary"
                  onClick={() => openInPlayground(samples[activeSample].code)}
                >
                  Open in playground →
                </button>
                <span className="sample-run-hint">
                  then press Ctrl/⌘ + Enter to run
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Parity ────────────────────────────────────────── */}
      <section className="section">
        <Reveal>
          <span className="section-eyebrow">Why it matters</span>
          <h2 className="section-title">Two toolchains, one contract.</h2>
          <p className="section-lede">
            The browser build is not a toy: every regression, error case, and
            output test from the native suite is asserted byte-for-byte.
          </p>
        </Reveal>
        <div className="parity-grid">
          <Reveal delay={60}>
            <div className="parity-card">
              <span className="tag">Native</span>
              <h3>build/hmx — a real compiler</h3>
              <p>
                Flex, Bison and C++ turn .hmx into C, then gcc -O2 into a native
                binary. Exit codes, stdin, Unicode, modules — all there.
              </p>
              <div className="parity-metric">
                358 regression cases · <b>52</b> module integrations
              </div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="parity-card">
              <span className="tag">Web</span>
              <h3>The same language, in JS</h3>
              <p>
                The lexer, LALR tables, resolver and emitter are reimplemented
                in TypeScript and run a tiny runtime inside your tab.
              </p>
              <div className="parity-metric">
                <b>358/358</b> byte-identical vs native · <b>0</b> backend
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="section">
        <Reveal>
          <div className="cta-banner">
            <h2>Stop reading. Start compiling.</h2>
            <p>
              Open the playground, write HMX, and hit Run — the whole toolchain
              is already in this tab.
            </p>
            <div className="hero-cta">
              <Link className="btn-primary" to="/playground">
                Open the playground →
              </Link>
              <Link className="btn-ghost" to="/docs">
                Browse the docs
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <span className="brand-mark" aria-hidden="true">
              &gt;_
            </span>{" "}
            <span className="brand-name">HMX</span>
            <p className="footer-blurb">
              A small systems language with a native compiler and a
              byte-identical in-browser twin. Built with Flex, Bison, C++ and
              React.
            </p>
          </div>
          <div className="footer-col">
            <h4>Learn</h4>
            <Link to="/playground">Playground</Link>
            <Link to="/docs">Docs</Link>
          </div>
          <div className="footer-col">
            <h4>Source</h4>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              GitHub repository
            </a>
          </div>
          <div className="footer-col">
            <h4>Native toolchain</h4>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              cmake -S . -B build
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} HMX — compiled in your browser tab.
          </span>
          <span className="footer-palette">
            Palette
            <span className="palette-dots" aria-hidden="true">
              <i style={{ background: "#0A0A0A", border: "1px solid #2a2322" }} />
              <i style={{ background: "#1A0505" }} />
              <i style={{ background: "#8B0000" }} />
              <i style={{ background: "#C41E3A" }} />
              <i style={{ background: "#E63946" }} />
              <i style={{ background: "#FF6B6B" }} />
              <i style={{ background: "#4A2C2C" }} />
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}