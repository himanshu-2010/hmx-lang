import { useRunner } from "./ui/runner";
import { Editor } from "./ui/Editor";
import { Output } from "./ui/Output";
import { ErrorPanel } from "./ui/ErrorPanel";

export default function App() {
  const [state, dispatch] = useRunner();

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">HMX Playground</span>
        <button
          className="run-button"
          onClick={() => dispatch({ type: "run" })}
        >
          Run
        </button>
      </header>

      <main className="workspace">
        <Editor
          source={state.source}
          onChange={(source) => dispatch({ type: "setSource", source })}
        />
        <div className="results">
          {state.result && (
            <>
              <Output stdout={state.result.stdout} exit={state.result.exit} />
              <ErrorPanel stderr={state.result.stderr} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}