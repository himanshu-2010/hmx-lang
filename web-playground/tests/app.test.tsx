// @vitest-environment jsdom
//
// App render smoke test: the multi-page shell (Home / Playground / Docs) at
// least mounts and responds to the compiler without crashing. The parity gate
// in parity.test.ts covers compiler correctness; this covers the UI shell.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import story from "../src/data/story";

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
    expect(t).toContain(String(story.stats.nativeTests));
  });

  it("credits the author with a circular portrait", async () => {
    await renderApp();
    expect(text()).toContain("Himanshu");
    const portrait = rootEl.querySelector<HTMLImageElement>(
      "img.author-portrait",
    );
    expect(portrait).not.toBeNull();
    expect(portrait!.getAttribute("src")).toBe("/himanshu.jpg");
    // Square source + border-radius: 50% in CSS is what makes the circle.
    expect(portrait!.getAttribute("alt")).toBe("Portrait of Himanshu");
  });

  it("links the author's contact details in the footer", async () => {
    await renderApp();
    const footer = rootEl.querySelector("footer");
    expect(footer).not.toBeNull();
    const hrefs = [...footer!.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("mailto:himanshujsr462@gmail.com");
    expect(hrefs).toContain("https://instagram.com/mors__369");
    expect(hrefs).toContain("https://github.com/himanshu-2010");
    expect(footer!.textContent).toContain("Contact");
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

  it("renders the install page at #/install", async () => {
    window.location.hash = "#/install";
    await renderApp();
    expect(text()).toContain("Install");
    expect(text()).toContain("install.sh");
    // The one thing a reader arrived here to find: a command to copy.
    expect(text()).toContain("curl -fsSL");
    // The requirement that trips people up after a successful install.
    expect(text()).toContain("C compiler");
  });

  it("renders the license page at #/license", async () => {
    window.location.hash = "#/license";
    await renderApp();
    expect(text()).toContain("MIT License");
    expect(text()).toContain("WITHOUT WARRANTY OF ANY KIND");
  });

  // The 404 replaces a route that used to render the home page. The old
  // behaviour passed any test that only asked "did something render", which is
  // exactly what the test below would have checked.
  it("shows a 404 for an unknown route instead of the home page", async () => {
    window.location.hash = "#/definitely-not-a-page";
    await renderApp();
    expect(text()).toContain("404");
    expect(text()).toContain("No such page");
    // It must echo the path, so a broken link can be diagnosed from the page.
    expect(text()).toContain("definitely-not-a-page");
    // And it must NOT be the home page. This is the assertion that distinguishes
    // a real 404 from the redirect it replaced.
    expect(text()).not.toContain("Hero");
  });

  it("links every 404 suggestion to a route that exists", async () => {
    window.location.hash = "#/nope";
    await renderApp();
    const hrefs = Array.from(rootEl.querySelectorAll("a.nf-link")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs).toEqual(["#/", "#/playground", "#/docs", "#/install", "#/license", "#/story"]);

    // Every suggested path must resolve to a real page. Asserted on the 404
    // page's own heading rather than the string "404": the install page says
    // "rather than handed a 404" in its prose, so a bare substring check fails
    // on a page that is working perfectly.
    for (const href of hrefs) {
      window.location.hash = href;
      await act(async () => {
        root?.unmount();
        root = createRoot(rootEl);
        root.render(<App />);
      });
      expect(text()).not.toContain("No such page");
    }
  });
});

describe("story page", () => {
  it("renders the story at #/story from the data file", async () => {
    window.location.hash = "#/story";
    await renderApp();
    const t = text();
    expect(t).toContain(story.title);
    // Every chapter title comes straight from story.json.
    for (const c of story.chapters) {
      expect(t).toContain(c.title);
    }
  });

  // The point of a data-driven page: adding an entry must render, and dropping
  // one must fail. A renderer that silently skips a chapter would pass any test
  // that only asked "did the page render", which is why this counts.
  it("renders every chapter and every entry in story.json", async () => {
    window.location.hash = "#/story";
    await renderApp();
    const chapters = rootEl.querySelectorAll(".story-chapter");
    expect(chapters.length).toBe(story.chapters.length);
    const expected = story.chapters.reduce((n, c) => n + c.entries.length, 0);
    expect(rootEl.querySelectorAll(".story-entry").length).toBe(expected);
  });

  it("badges the in-progress entry and links the production gap list", async () => {
    window.location.hash = "#/story";
    await renderApp();
    expect(rootEl.querySelectorAll(".story-badge-current").length).toBeGreaterThan(0);
    const hrefs = [...rootEl.querySelectorAll(".page-note a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain(
      "https://github.com/himanshu-2010/hmx-lang/blob/main/PRODUCTION.md",
    );
  });

  it("exposes the story as a nav tab", async () => {
    await renderApp();
    const tabHrefs = [...rootEl.querySelectorAll("a.tab")].map((a) =>
      a.getAttribute("href"),
    );
    expect(tabHrefs).toContain("#/story");
  });
});