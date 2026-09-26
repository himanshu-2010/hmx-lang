import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { reducer, initialState, type AppState, type AppAction } from "./runner";

interface RunnerCtx {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const RunnerContext = createContext<RunnerCtx | null>(null);

/** App-wide runner state, shared across the Playground, Docs and Home routes. */
export function RunnerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <RunnerContext.Provider value={{ state, dispatch }}>
      {children}
    </RunnerContext.Provider>
  );
}

export function useRunner(): RunnerCtx {
  const ctx = useContext(RunnerContext);
  if (!ctx) throw new Error("useRunner must be used inside <RunnerProvider>");
  return ctx;
}