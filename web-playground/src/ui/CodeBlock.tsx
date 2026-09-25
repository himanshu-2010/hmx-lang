import { useState } from "react";

interface CodeBlockProps {
  /** Tab-strip label, e.g. "entry.hmx" or an example name. */
  label: string;
  code: string;
  /** Extra module files shown as read-only secondary blocks (use \"...\" examples). */
  moduleFiles?: Record<string, string>;
  /** When provided, a Run button loads + runs this code in the playground. */
  onRun?: (code: string) => void;
  /** Optional stdout line shown under the code, e.g. `= 42`. */
  expected?: string;
  /** Optional callout note under the example. */
  note?: string;
}

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="code-action"
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Block({
  label,
  code,
  onRun,
}: {
  label: string;
  code: string;
  onRun?: (code: string) => void;
}) {
  return (
    <div className="code-block">
      <div className="code-strip">
        <span className="code-label">{label}</span>
        <span className="code-actions">
          {onRun && (
            <button className="code-action code-run" onClick={() => onRun(code)}>
              Run ▸
            </button>
          )}
          <CopyButton text={code} />
        </span>
      </div>
      <pre className="code-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CodeBlock({
  label,
  code,
  moduleFiles,
  onRun,
  expected,
  note,
}: CodeBlockProps) {
  return (
    <div className="doc-example">
      <Block label={label} code={code} onRun={onRun} />
      {moduleFiles &&
        Object.entries(moduleFiles).map(([path, content]) => (
          <Block key={path} label={path} code={content} />
        ))}
      {expected !== undefined && (
        <div className="code-expected">
          {"▸ "}
          {expected.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < expected.split("\n").length - 1 ? "\n" : ""}
            </span>
          ))}
        </div>
      )}
      {note && <p className="code-note">{note}</p>}
    </div>
  );
}