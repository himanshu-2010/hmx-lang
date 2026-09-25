interface OutputProps {
  stdout: string;
  exit: number;
}

export function Output({ stdout, exit }: OutputProps) {
  return (
    <section className="pane output">
      <header className="pane-title">
        Output <span className="exit-code">exit: {exit}</span>
      </header>
      <pre className="output-body">{stdout || "(no output)"}</pre>
    </section>
  );
}