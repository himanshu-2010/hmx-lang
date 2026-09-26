/**
 * Pure command engine for the interactive hero terminal.
 * No React here — just strings in, strings out — so the command set is
 * unit-testable and the component stays a thin shell around it.
 */

export type Theme = "dark" | "light";

export interface TerminalContext {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** React Router path push, e.g. "/playground". */
  navigate: (path: string) => void;
}

export type LinesReply = { type: "lines"; lines: string[] };
export type ClearReply = { type: "clear" };
/** Async replies (fetch-backed: ip / github) resolve to a lines reply. */
export type TerminalReply = LinesReply | ClearReply | Promise<LinesReply>;

export const HMX_VERSION = "0.9.0";

const GITHUB_URL = "https://github.com/himanshu-2010";
const GITHUB_REPO = `${GITHUB_URL}/hmx-lang`;

const HELP: string[] = [
  "hmx in-browser shell · v" + HMX_VERSION,
  "───────────────────────────────────────",
  "  help                show this list",
  "  about               who built this site",
  "  hmx                 what is the hmx language",
  "  go <page>           open playground, docs or home",
  "  theme [light|dark]  switch site theme (no arg toggles)",
  "  ip                  show your public IP address",
  "  github              live stats for my hmx repo",
  "  whoami              who you are to this terminal",
  "  echo <text>         print text back",
  "  date                current date and time",
  "  clear               clear the screen",
];

const ABOUT: string[] = [
  "Himanshu Kumar",
  "──────────────────────────────",
  "Class 10 student · electronics & programming/AI enthusiast.",
  "I love building amazing things with programming and AI —",
  "hmx is one of them.",
  GITHUB_URL,
];

const HMX_PITCH: string[] = [
  "HMX — a small, statically-typed systems language.",
  "  • int, decimal, text, bool, char, byte — local inference",
  "  • first-class fn values, closures, tuples, destructuring",
  "  • modules via use \"...\", Unicode-ready identifiers",
  "  • native C++ toolchain + a full in-browser twin (no server)",
  "Try it → go playground · read the spec → go docs",
];

const WHOAMI: string[] = [
  "you're a visitor on Himanshu's corner of the internet,",
  "typing inside this in-browser hmx shell.",
  "this terminal asks nothing and stores nothing about you.",
];

const line = (l: string[]): LinesReply => ({ type: "lines", lines: l });

const PAGES: Record<string, string> = {
  home: "/",
  "/": "/",
  playground: "/playground",
  play: "/playground",
  docs: "/docs",
  doc: "/docs",
};

function goCmd(arg: string, navigate: (path: string) => void): LinesReply {
  const path = PAGES[arg.trim().toLowerCase()];
  if (!path) return line(["usage: go <playground|docs|home>"]);
  navigate(path);
  return line([`opening ${path} …`]);
}

function themeCmd(arg: string, ctx: TerminalContext): LinesReply {
  const value = arg.trim().toLowerCase();
  if (value === "" || value === "toggle") {
    const next: Theme = ctx.theme === "dark" ? "light" : "dark";
    ctx.setTheme(next);
    return line([`theme → ${next}`]);
  }
  if (value === "light" || value === "dark") {
    if (ctx.theme === value) return line([`already in ${value} mode`]);
    ctx.setTheme(value);
    return line([`theme → ${value}`]);
  }
  return line(["usage: theme [light|dark] — no argument toggles"]);
}

async function fetchIP(): Promise<LinesReply> {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    if (!res.ok) throw new Error("bad status");
    const data = (await res.json()) as { ip?: string };
    if (!data.ip) throw new Error("no ip");
    return line([
      `your public IP → ${data.ip}`,
      "looked up live via ipify.org — nothing is stored.",
    ]);
  } catch {
    return line([
      "couldn't reach ipify.org — offline or blocked?",
      "try again in a moment, or check your connection.",
    ]);
  }
}

async function fetchGitHub(): Promise<LinesReply> {
  try {
    const [repoRes, userRes] = await Promise.all([
      fetch(`https://api.github.com/repos/himanshu-2010/hmx-lang`),
      fetch(`https://api.github.com/users/himanshu-2010`),
    ]);
    const repo = repoRes.ok ? ((await repoRes.json()) as {
      stargazers_count?: number;
      forks_count?: number;
      open_issues_count?: number;
      pushed_at?: string;
      language?: string;
    }) : null;
    const user = userRes.ok ? ((await userRes.json()) as {
      name?: string;
      bio?: string | null;
      public_repos?: number;
      followers?: number;
    }) : null;

    const out: string[] = [];
    out.push(user?.name ? `${GITHUB_URL} — ${user.name}` : GITHUB_URL);
    if (user) {
      out.push(`bio: ${user.bio ?? "n/a"}`);
      out.push(`${user.public_repos} public repos · ${user.followers} followers`);
    }
    if (repo) {
      out.push("hmx-lang · by the numbers:");
      out.push(
        `  ★ ${repo.stargazers_count} · ${repo.forks_count} forks · ${repo.open_issues_count} open issues`,
      );
      out.push(
        `  last push ${new Date(repo.pushed_at ?? 0).toLocaleDateString()} · ${repo.language ?? "C++"}`,
      );
    } else {
      out.push("repo stats unavailable — open it directly:");
      out.push(GITHUB_REPO);
    }
    return line(out);
  } catch {
    return line([
      "github API unreachable — open it directly:",
      GITHUB_REPO,
    ]);
  }
}

/**
 * Run one submitted command line against the terminal context and return the
 * lines to print. `clear` is handled by the caller (returns `{type:"clear"}`),
 * and `ip` / `github` resolve asynchronously.
 */
export function runCommand(input: string, ctx: TerminalContext): TerminalReply {
  const trimmed = input.trim();
  if (!trimmed) return line([]);
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(" ");

  switch (cmd) {
    case "help":
      return line(HELP);
    case "about":
      return line(ABOUT);
    case "hmx":
      return line(HMX_PITCH);
    case "version":
      return line([`hmx ${HMX_VERSION} — in-browser shell`]);
    case "go":
      return goCmd(arg, ctx.navigate);
    case "theme":
      return themeCmd(arg, ctx);
    case "ip":
      return fetchIP();
    case "github":
      return fetchGitHub();
    case "whoami":
      return line(WHOAMI);
    case "echo":
      return line(arg ? [arg] : ["usage: echo <text>"]);
    case "date":
      return line([new Date().toString()]);
    case "clear":
      return { type: "clear" };
    default:
      return line([
        `hmx: command not found: ${cmd}`,
        "type 'help' for available commands",
      ]);
  }
}