import { useNavigate } from "react-router-dom";
import { DocsView } from "./docs/DocsView";
import { useRunner } from "./runner-context";
import { useDebouncedCallback } from "./useDebouncedCallback";

export function DocsPage() {
  const { dispatch } = useRunner();
  const navigate = useNavigate();

  // loading an example compiles it — debounce rapid double-clicks.
  const runExample = useDebouncedCallback((code: string) => {
    dispatch({ type: "loadExample", source: code });
    navigate("/playground");
  }, 250);

  return <DocsView onRunExample={runExample} />;
}