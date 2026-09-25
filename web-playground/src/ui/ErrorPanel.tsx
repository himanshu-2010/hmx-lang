interface ErrorPanelProps {
  stderr: string;
}

export function ErrorPanel({ stderr }: ErrorPanelProps) {
  if (!stderr) return null;
  return (
    <section className="pane errors">
      <header className="pane-title">Errors</header>
      <pre className="errors-body">{stderr}</pre>
    </section>
  );
}