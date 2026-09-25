import { useReducer } from "react";
import { runProgram, DEFAULT_SOURCE, type RunResult } from "../compiler/program";

export interface AppState {
  source: string;
  result: RunResult | null;
}

export type AppAction =
  | { type: "setSource"; source: string }
  | { type: "run" };

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "setSource":
      return { ...state, source: action.source };
    case "run":
      return { ...state, result: runProgram(state.source) };
  }
}

export const initialState: AppState = {
  source: DEFAULT_SOURCE,
  result: null,
};

export function useRunner() {
  return useReducer(reducer, initialState);
}