import { useMemo, useState } from "react";
import { docsData, type DocItem, type DocSection } from "../../docs";
import { CodeBlock } from "../CodeBlock";

interface DocsViewProps {
  onRunExample: (code: string) => void;
}

function Item({ item, onRunExample }: { item: DocItem; onRunExample: (code: string) => void }) {
  return (
    <article className="doc-item" id={`doc-${item.id}`}>
      <h3 className="doc-item-title">{item.title}</h3>
      <div className="doc-syntax" title="Syntax">
        {item.syntax.split("\n").map((line, i) => (
          <code key={i}>
            {line}
            {i < item.syntax.split("\n").length - 1 ? <br /> : null}
          </code>
        ))}
      </div>
      <p className="doc-intro">{item.intro}</p>
      {item.examples.map((ex, i) => (
        <CodeBlock
          key={i}
          label={ex.name}
          code={ex.code}
          moduleFiles={ex.moduleFiles}
          onRun={onRunExample}
          expected={ex.expected}
          note={ex.note}
        />
      ))}
    </article>
  );
}

export function DocsView({ onRunExample }: DocsViewProps) {
  const [activeId, setActiveId] = useState(docsData[0].id);
  const section = useMemo(
    () => docsData.find((s) => s.id === activeId) ?? docsData[0],
    [activeId],
  );

  const handleSelect = (id: string) => {
    setActiveId(id);
    const main = document.getElementById("docs-main");
    if (main) main.scrollTop = 0;
  };

  return (
    <main className="docs">
      <aside className="docs-sidebar">
        <h2 className="docs-sidebar-title">Documentation</h2>
        <p className="docs-sidebar-sub">
          {docsData.length} sections ·{" "}
          {docsData.reduce((n, s) => n + s.items.length, 0)} topics · every
          example verified against the compiler
        </p>
        <nav className="docs-nav" aria-label="Docs sections">
          {docsData.map((s: DocSection) => (
            <button
              key={s.id}
              className={`doc-section-link ${s.id === section.id ? "doc-section-active" : ""}`}
              onClick={() => handleSelect(s.id)}
            >
              <span className="doc-section-title">{s.title}</span>
              <span className="doc-section-count">{s.items.length}</span>
            </button>
          ))}
        </nav>
        <p className="docs-sidebar-foot">
          <a
            href="https://github.com/himanshu-2010/hmx-lang/blob/main/SYNTAX.md"
            target="_blank"
            rel="noreferrer noopener"
          >
            Full SYNTAX.md ↗
          </a>
        </p>
      </aside>

      <section className="docs-main" id="docs-main" aria-live="polite">
        <header className="docs-section-header">
          <span className="docs-section-index">{section.id}</span>
          <h2>{section.title}</h2>
          {section.intro && <p>{section.intro}</p>}
        </header>
        {section.items.map((item) => (
          <Item key={item.id} item={item} onRunExample={onRunExample} />
        ))}
      </section>
    </main>
  );
}