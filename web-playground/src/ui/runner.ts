import { useReducer } from "react";
import { runProgram, DEFAULT_SOURCE, type RunResult } from "../compiler/program";

export type AppTab = "playground" | "docs";

export interface AppState {
  source: string;
  result: RunResult | null;
  tab: AppTab;
}

export type AppAction =
  | { type: "setSource"; source: string }
  | { type: "run" }
  | { type: "setTab"; tab: AppTab }
  | {
      /** Load a docs example into the editor and run it (switches to playground). */
      type: "loadExample";
      source: string;
    };

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setSource":
      return { ...state, source: action.source };
    case "run":
      return { ...state, result: runProgram(state.source) };
    case "setTab":
      return { ...state, tab: action.tab };
    case "loadExample":
      return {
        ...state,
        source: action.source,
        tab: "playground",
        result: runProgram(action.source),
      };
  }
}

export const initialState: AppState = {
  source: DEFAULT_SOURCE,
  result: null,
  tab: "playground",
};

export function useRunner() {
  return useReducer(reducer, initialState);
}