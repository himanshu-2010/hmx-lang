import { Link, NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

const GITHUB_URL = "https://github.com/himanshu-2010/hmx-lang";

const tabs = [
  { to: "/", label: "Home", end: true, guide: "home-link" },
  { to: "/playground", label: "Playground", end: false, guide: "playground-link" },
  { to: "/docs", label: "Docs", end: false, guide: "docs-link" },
];

/** Red/black top bar: brand, route links, and the GitHub source link. */
export function Nav() {
  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label="HMX — home">
        <span className="brand-mark" aria-hidden="true">
          &gt;_
        </span>
        <span className="brand-name">HMX</span>
        <span className="brand-tag">compiler playground</span>
      </Link>

      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            data-guide={t.guide}
            className={({ isActive }) => `tab ${isActive ? "tab-active" : ""}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <a
        className="github-link"
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer noopener"
        title="HMX source on GitHub"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.56.67-1.66 1.22.02.08.296.84-1.12.43 0 0 1.7-.36 2.71-1.28.22-.2.4-.64.51-1.14-2.21.06-3.95-1.52-3.95-3.72 0-.83.37-1.58.97-2.12-.1-.2-.42-.99.09-2.07 0 0 .64-.21 2.1.8.58.32 1.57.49 2.38.49.81 0 1.8-.17 2.38-.49 1.46-1.01 2.1-.8 2.1-.8.51 1.08.19 1.87.09 2.07.6.54.97 1.29.97 2.12 0 2.2-1.75 3.78-3.96 3.72.21.18.39.53.39 1.14 0 .82 0 1.48 0 1.68 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span className="github-label">Source</span>
      </a>

      <ThemeToggle />
    </header>
  );
}