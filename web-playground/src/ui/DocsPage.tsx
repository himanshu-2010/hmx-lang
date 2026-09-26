import { useNavigate } from "react-router-dom";
import { DocsView } from "./docs/DocsView";
import { useRunner } from "./runner-context";

export function DocsPage() {
  const { dispatch } = useRunner();
  const navigate = useNavigate();

  return (
    <DocsView
      onRunExample={(code) => {
        // Load the example into the shared editor and land on the playground.
        dispatch({ type: "loadExample", source: code });
        navigate("/playground");
      }}
    />
  );
}