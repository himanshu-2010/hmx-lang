import { useEffect } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { Nav } from "./ui/Nav";
import { RunnerProvider } from "./ui/runner-context";
import { HomePage } from "./ui/Home";
import { PlaygroundPage } from "./ui/PlaygroundPage";
import { DocsPage } from "./ui/DocsPage";

/** Reset the active scroller when the route changes (home scrolls, others are panes). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const scroller = document.querySelector<HTMLElement>(
      ".home-scroll, .docs, .workspace",
    );
    if (scroller) scroller.scrollTop = 0;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <RunnerProvider>
        <div className="app">
          <Nav />
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </div>
      </RunnerProvider>
    </HashRouter>
  );
}