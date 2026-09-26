export type Theme = "dark" | "light";

const THEME_KEY = "hmx-theme";

/**
 * Theme is resolved: (1) saved preference, else (2) the system's
 * `prefers-color-scheme` on first visit, else (3) dark (brand default).
 */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable — fall through to system */
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

/** Apply a theme to <html data-theme> and persist it. */
export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — ignore */
  }
}

/**
 * Detect the Dark Reader browser extension. It marks <html> with a
 * data-darkreader-scheme attribute / darkreader class and injects <style>
 * elements whose id or data attribute contains "darkreader".
 */
export function darkReaderActive(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.dataset.darkreaderScheme) return true;
  for (const cls of root.classList) {
    if (cls.toLowerCase().includes("darkreader")) return true;
  }
  const styles = document.head?.querySelectorAll("style");
  if (styles) {
    for (const s of styles) {
      if ((s.id || "").toLowerCase().includes("darkreader")) return true;
      if (s.getAttribute("data-darkreader-scheme")) return true;
    }
  }
  return false;
}