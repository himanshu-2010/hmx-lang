interface EditorProps {
  source: string;
  onChange: (source: string) => void;
}

/** M1: plain-textarea editor (Monaco is a deliberate, later-only upgrade). */
export function Editor({ source, onChange }: EditorProps) {
  return (
    <textarea
      className="editor"
      value={source}
      spellCheck={false}
      aria-label="HMX source code"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}