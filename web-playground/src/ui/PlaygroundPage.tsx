import { useEffect, useState } from "react";
import { Editor } from "./Editor";
import { Output } from "./Output";
import { ErrorPanel } from "./ErrorPanel";
import { useRunner } from "./runner-context";
import { useDebouncedCallback } from "./useDebouncedCallback";
import {
  PlaygroundGuide,
  isDesktopTour,
  hasSeenGuide,
} from "./PlaygroundGuide";

export function PlaygroundPage() {
  const { state, dispatch } = useRunner();
  const [guideOpen, setGuideOpen] = useState(false);

  // First-time desktop visitors get the guided tour (localStorage-gated).
  useEffect(() => {
    if (isDesktopTour() && !hasSeenGuide()) setGuideOpen(true);
  }, []);

  // Run is the only heavy action — debounce it so double-clicks and Ctrl/⌘+Enter
  // spam collapse into a single compile instead of stampeding the pipeline.
  const run = useDebouncedCallback(() => dispatch({ type: "run" }), 250);

  return (
    <main className="workspace">
      <Editor
        source={state.source}
        onChange={(source) => dispatch({ type: "setSource", source })}
        onRun={run}
      />
      <div className="results">
        <div className="results-toolbar">
          <button className="run-button" onClick={run}>
            Run ▸
          </button>
          <button
            className="tour-button"
            onClick={() => setGuideOpen(true)}
            title="Replay the guided tour"
            aria-label="Replay the guided tour"
          >
            ?
          </button>
          <span className="results-hint">Ctrl/⌘ + Enter to run</span>
        </div>
        {state.result && (
          <>
            <Output stdout={state.result.stdout} exit={state.result.exit} />
            <ErrorPanel stderr={state.result.stderr} />
          </>
        )}
        {!state.result && (
          <div className="results-empty">
            <p>
              Write HMX on the left, then hit{" "}
              <span className="key">Run</span>. The full pipeline — lexer, LALR
              parser, type resolver, codegen — executes right here in your
              browser tab.
            </p>
          </div>
        )}
      </div>
      <PlaygroundGuide open={guideOpen} onDone={() => setGuideOpen(false)} />
    </main>
  );
}