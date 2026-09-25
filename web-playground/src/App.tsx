import { useRunner } from "./ui/runner";
import { Editor } from "./ui/Editor";
import { Output } from "./ui/Output";
import { ErrorPanel } from "./ui/ErrorPanel";
import { Nav } from "./ui/Nav";
import { DocsView } from "./ui/docs/DocsView";

export default function App() {
  const [state, dispatch] = useRunner();

  return (
    <div className="app">
      <Nav tab={state.tab} onNavigate={(tab) => dispatch({ type: "setTab", tab })} />

      {state.tab === "playground" ? (
        <main className="workspace">
          <Editor
            source={state.source}
            onChange={(source) => dispatch({ type: "setSource", source })}
            onRun={() => dispatch({ type: "run" })}
          />
          <div className="results">
            <div className="results-toolbar">
              <button
                className="run-button"
                onClick={() => dispatch({ type: "run" })}
              >
                Run ▸
              </button>
              <span className="results-hint">
                Ctrl/⌘ + Enter to run
              </span>
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
                  <span className="key">Run</span>. The in-browser compiler lands
                  in M2–M4 — until then it validates the build pipeline.
                </p>
              </div>
            )}
          </div>
        </main>
      ) : (
        <DocsView onRunExample={(source) => dispatch({ type: "loadExample", source })} />
      )}
    </div>
  );
}