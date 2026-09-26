import { runProgram, DEFAULT_SOURCE, type RunResult } from "../compiler/program";

export interface AppState {
  source: string;
  result: RunResult | null;
}

export type AppAction =
  | { type: "setSource"; source: string }
  | { type: "run" }
  | {
      /** Load a code snippet into the editor and run it (caller navigates to /playground). */
      type: "loadExample";
      source: string;
    };

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setSource":
      return { ...state, source: action.source };
    case "run":
      return { ...state, result: runProgram(state.source) };
    case "loadExample":
      return {
        ...state,
        source: action.source,
        result: runProgram(action.source),
      };
  }
}

export const initialState: AppState = {
  source: DEFAULT_SOURCE,
  result: null,
};