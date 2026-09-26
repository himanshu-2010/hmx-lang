interface EditorProps {
  source: string;
  onChange: (source: string) => void;
  onRun?: () => void;
}

/** M1: plain-textarea editor (Monaco is a deliberate, later-only upgrade). */
export function Editor({ source, onChange, onRun }: EditorProps) {
  return (
    <div className="editor-wrap">
      <div className="editor-strip">
        <span className="editor-label">main.hmx</span>
        <span className="editor-dot" aria-hidden="true" />
      </div>
      <textarea
        className="editor"
        id="hmx-editor"
        data-guide="editor"
        value={source}
        spellCheck={false}
        aria-label="HMX source code"
        onKeyDown={(e) => {
          if (onRun && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onRun();
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}