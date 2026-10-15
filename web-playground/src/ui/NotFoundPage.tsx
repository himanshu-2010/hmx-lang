import { Link, useLocation } from "react-router-dom";
import "./pages.css";

/**
 * This replaces a `*` route that rendered the home page.
 *
 * The old behaviour looked like working navigation: the URL bar changed, the page
 * rendered, nothing said anything was wrong. Someone who mistyped a link, or
 * followed a stale one, got the marketing page with no indication that the thing
 * they asked for does not exist — and no way to tell that from having landed
 * where they meant to. Showing the path back to them is what makes the difference
 * between "this site has no such page" and "this site's links are broken".
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <main className="page">
      <div className="page-inner">
        <p className="nf-code">404</p>
        <h1 className="page-title">No such page</h1>
        <code className="nf-path">{pathname}</code>
        <p className="page-lede">
          Nothing is published at that path. This site uses hash routes, so a link
          should look like <code>#/docs</code> — if a link went somewhere odd,
          everything after the <code>#</code> is the part that names the page.
        </p>

        <h2 className="page-h2">Where you were probably going</h2>
        <nav className="nf-links" aria-label="Suggested pages">
          <Link className="nf-link" to="/">
            Home
          </Link>
          <Link className="nf-link" to="/playground">
            Playground
          </Link>
          <Link className="nf-link" to="/docs">
            Docs
          </Link>
          <Link className="nf-link" to="/install">
            Install
          </Link>
          <Link className="nf-link" to="/license">
            License
          </Link>
          <Link className="nf-link" to="/story">
            Story
          </Link>
        </nav>

        <p className="page-note">
          Found a broken link on this site, or on the repository? Please{" "}
          <a href="https://github.com/himanshu-2010/hmx-lang/issues" target="_blank" rel="noreferrer">
            open an issue
          </a>
          . Dead ends are a bug, not a rite of passage.
        </p>
      </div>
    </main>
  );
}