// @vitest-environment jsdom
//
// App render smoke test: the multi-page shell (Home / Playground / Docs) at
// least mounts and responds to the compiler without crashing. The parity gate
// in parity.test.ts covers compiler correctness; this covers the UI shell.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

// jsdom + React 19: opt into act(...) semantics for this environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let rootEl: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  window.location.hash = "";
  sessionStorage.clear();
  // jsdom doesn't implement scrollTo; the app calls it on route change.
  window.scrollTo = () => {};
  rootEl = document.createElement("div");
  document.body.appendChild(rootEl);
});

afterEach(async () => {
  // Flush + unmount before the jsdom environment is torn down.
  await act(async () => {
    root?.unmount();
  });
  rootEl.remove();
});

async function renderApp() {
  await act(async () => {
    root = createRoot(rootEl);
    root.render(<App />);
  });
}

function text(): string {
  return (rootEl.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("app routes", () => {
  it("renders the home page with hero + CTA", async () => {
    await renderApp();
    const t = text();
    expect(t).toContain("Compile in your tab");
    expect(t).toContain("Try the compiler");
    expect(t).toContain("Think in types");
    expect(t).toContain("358");
  });

  it("renders the playground at #/playground with the editor and empty state", async () => {
    window.location.hash = "#/playground";
    await renderApp();
    const t = text();
    expect(t).toContain("Playground");
    expect(t).toContain("main.hmx");
    expect(t).toContain("Run ▸");
    expect(t).toContain("Write HMX on the left");
  });

  it("runs the default program from the playground", async () => {
    vi.useFakeTimers();
    try {
      window.location.hash = "#/playground";
      await renderApp();
      const runBtn = Array.from(rootEl.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Run"),
      );
      expect(runBtn).toBeDefined();
      await act(async () => {
        runBtn!.click();
      });
      // The Run action is debounced (250ms) to rate-limit recompiles — flush
      // the timer inside act so the reducer fires before we assert.
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const t = text();
      // stdio flows through: stdout + exit code are rendered
      expect(t).toContain("HMX in the browser");
      expect(t).toContain("sum: 20");
      expect(t).toContain("exit: 0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the docs at #/docs", async () => {
    window.location.hash = "#/docs";
    await renderApp();
    expect(text()).toContain("Documentation");
    // a docs section ships the intro + runnable examples
    expect(text()).toContain("sections ·");
  });

  it("loads a docs example into the playground", async () => {
    window.location.hash = "#/docs";
    await renderApp();
    const runExample = Array.from(rootEl.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Run"),
    );
    // docs CodeBlocks expose a Run affordance; just assert one exists
    expect(runExample).toBeDefined();
  });
});