import { useEffect, useState } from "react";

/**
 * Boot splash: holds the branded frame until the webfonts are ready (or a
 * hard 2.8s cap so the site never hangs). Hidden after ~700ms minimum so the
 * logo/fonts never flash. Skipped entirely under vitest (jsdom).
 */
export function SplashLoader() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;

    let finished = false;
    let minTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (minTimer) clearTimeout(minTimer);
      if (maxTimer) clearTimeout(maxTimer);
      setHidden(true);
    };

    const minShown = new Promise<void>((resolve) => {
      minTimer = setTimeout(resolve, 700);
    });
    const maxWait = new Promise<void>((resolve) => {
      maxTimer = setTimeout(resolve, 2800);
    });
    const fontsReady =
      typeof document !== "undefined" && "fonts" in document
        ? document.fonts.ready.catch(() => undefined)
        : Promise.resolve();

    Promise.race([Promise.all([minShown, fontsReady]), maxWait]).then(finish);

    return () => {
      if (minTimer) clearTimeout(minTimer);
      if (maxTimer) clearTimeout(maxTimer);
    };
  }, []);

  return (
    <div
      className={`splash ${hidden ? "splash-hidden" : ""}`}
      style={hidden ? { visibility: "hidden" } : undefined}
      aria-hidden={hidden}
    >
      <img
        className="splash-logo"
        src="/favicon.png"
        alt=""
        width={84}
        height={84}
      />
      <div className="splash-word">HMX</div>
      <div className="splash-sub">compiler · web edition</div>
      <div className="splash-bar" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}