import story from "../data/story";
import "./pages.css";

const STATUS_LABEL: Record<string, string> = {
  done: "done",
  current: "in progress",
  planned: "planned",
};

function badgeClass(status?: string): string {
  switch (status) {
    case "done":
      return "story-badge story-badge-done";
    case "current":
      return "story-badge story-badge-current";
    case "planned":
      return "story-badge story-badge-planned";
    default:
      return "story-badge";
  }
}

function badgeLabel(status?: string): string {
  return (status && STATUS_LABEL[status]) || "note";
}

/**
 * The project's story, rendered entirely from `src/data/story.json`.
 *
 * Nothing here is hard-coded: the chapters, entries and statistics all come from
 * the data module, so the page grows by editing one JSON file. The chapter nav is
 * a row of buttons rather than `#id` anchors on purpose — this app uses HashRouter,
 * and a bare `href="#origin"` would rewrite the route hash and land on the 404.
 */
export function StoryPage() {
  return (
    <main className="page">
      <div className="page-inner">
        <span className="page-eyebrow">The project</span>
        <h1 className="page-title">{story.title}</h1>
        <p className="page-lede">{story.intro}</p>

        <div className="story-stats" aria-label="Project status">
          {[
            { num: story.stats.version, label: "version" },
            { num: String(story.stats.nativeTests), label: "native tests" },
            { num: String(story.stats.packagingTests), label: "packaging gates" },
            { num: String(story.stats.vitest), label: "vitest" },
            { num: String(story.stats.valgrind), label: "valgrind checks" },
          ].map((s) => (
            <div className="story-stat" key={s.label}>
              <span className="story-stat-num">{s.num}</span>
              <span className="story-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="story-updated">Last updated {story.updatedAt}.</p>

        <nav className="story-nav" aria-label="Chapters">
          {story.chapters.map((c) => (
            <button
              key={c.id}
              type="button"
              className="story-nav-link"
              onClick={() =>
                document
                  .getElementById(c.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {c.title}
            </button>
          ))}
        </nav>

        {story.chapters.map((c) => (
          <section className="story-chapter" key={c.id} id={c.id}>
            <h2 className="page-h2">{c.title}</h2>
            {c.body ? <p className="page-p">{c.body}</p> : null}
            <ol className="story-timeline">
              {c.entries.map((e, i) => (
                <li className="story-entry" key={`${c.id}-${i}`}>
                  <div className="story-entry-head">
                    <span className="story-date">{e.date}</span>
                    <span className={badgeClass(e.status)}>{badgeLabel(e.status)}</span>
                  </div>
                  <h3 className="story-entry-title">{e.title}</h3>
                  {e.detail ? <p className="story-entry-detail">{e.detail}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        ))}

        <p className="page-note">
          This page is generated from{" "}
          <code>web-playground/src/data/story.json</code> — add an entry there and it
          appears here. The milestone roadmap lives in{" "}
          <a
            href="https://github.com/himanshu-2010/hmx-lang/blob/main/ROADMAP.md"
            target="_blank"
            rel="noreferrer"
          >
            ROADMAP.md
          </a>{" "}
          and the production gap list in{" "}
          <a
            href="https://github.com/himanshu-2010/hmx-lang/blob/main/PRODUCTION.md"
            target="_blank"
            rel="noreferrer"
          >
            PRODUCTION.md
          </a>
          .
        </p>
      </div>
    </main>
  );
}
