import { useEffect, useRef, useState } from "react";

/**
 * Desktop-only pointer glow: a hot dot that tracks 1:1 plus a soft halo that
 * lerps behind it. One requestAnimationFrame loop writes straight to
 * transform/scale via refs — zero React state per frame, so it stays smooth.
 *
 * Never shown on touch/coarse pointers, disabled under reduced-motion, hidden
 * until the first pointer move, and skipped entirely in vitest.
 */
export function CursorTrail() {
  const [enabled, setEnabled] = useState(false);
  const dotRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    const mm = typeof window.matchMedia === "function" ? window.matchMedia : null;
    const fine = mm?.("(pointer: fine) and (hover: hover)").matches ?? false;
    const reduced = mm?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setEnabled(fine && !reduced);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const dot = dotRef.current;
    const halo = haloRef.current;
    if (!dot || !halo) return;

    let raf = 0;
    let tx = -200;
    let ty = -200;
    let hx = -200;
    let hy = -200;
    let visible = false;
    let pressed = false;

    const show = (on: boolean) => {
      visible = on;
      dot.style.display = on ? "" : "none";
      halo.style.display = on ? "" : "none";
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!visible) show(true);
    };
    const onDown = () => {
      pressed = true;
    };
    const onUp = () => {
      pressed = false;
    };
    const onLeave = () => show(false);
    const onEnter = () => show(false);

    const tick = () => {
      if (visible) {
        dot.style.transform = `translate3d(${tx - 4}px, ${ty - 4}px, 0)`;
        dot.style.setProperty("scale", pressed ? "1.9" : "1");
        hx += (tx - hx) * 0.16;
        hy += (ty - hy) * 0.16;
        halo.style.transform = `translate3d(${hx - 95}px, ${hy - 95}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };

    show(false);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, [enabled, dotRef, haloRef]);

  if (!enabled) return null;

  return (
    <div className="cursor-trail" aria-hidden="true">
      <div className="cursor-halo" ref={haloRef} />
      <div className="cursor-dot" ref={dotRef} />
    </div>
  );
}