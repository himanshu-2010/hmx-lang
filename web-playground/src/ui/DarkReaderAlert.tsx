import { useEffect, useState } from "react";
import { darkReaderActive } from "./theme";

const DISMISS_KEY = "hmx-darkreader-dismissed";

/**
 * When the Dark Reader extension is detected, gently ask the user to disable
 * it for this site (HMX ships its own tuned dark theme). Shown once per
 * session; never in the vitest/jsdom environment. Themed to match the brand.
 */
export function DarkReaderAlert() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    let cancelled = false;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* ignore */
    }
    const maybeShow = () => {
      if (cancelled || dismissed) return;
      if (darkReaderActive()) setVisible(true);
    };
    // Dark Reader injects its stylesheet a moment after first paint.
    const t1 = setTimeout(maybeShow, 600);
    const t2 = setTimeout(maybeShow, 2200);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <aside className="dr-alert" role="status" aria-live="polite">
      <h4>Dark Reader detected</h4>
      <p>
        HMX ships its own dark theme with carefully tuned contrast — an
        extension like Dark Reader overrides it. In the Dark Reader toolbar,
        open the site options for this page and switch{" "}
        <code>Invert</code> off, then reload.
      </p>
      <div className="dr-actions">
        <button className="dr-btn dr-btn-primary" onClick={dismiss}>
          Got it
        </button>
        <button className="dr-btn dr-btn-ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}