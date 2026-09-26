import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./guide.css";

interface GuideStep {
  selector: string;
  title: string;
  body: string;
  placement: "right" | "left" | "below" | "above";
}

const STEPS: GuideStep[] = [
  {
    selector: "#hmx-editor",
    title: "Write HMX here",
    body: "This is main.hmx — the whole language lives in the editor: types, closures, tuples, modules, loops. Type and it compiles on the spot.",
    placement: "right",
  },
  {
    selector: ".run-button",
    title: "Compile & run",
    body: "Hit Run to compile and execute in this tab — no server involved. Ctrl/⌘ + Enter does the same from the editor.",
    placement: "above",
  },
  {
    selector: "#hmx-output",
    title: "Read the output",
    body: "stdout lands here with the exit code. Compile errors and runtime failures show up below it in the Errors pane.",
    placement: "left",
  },
  {
    selector: "[data-guide='docs-link']",
    title: "134 runnable examples",
    body: "The docs aren't dry text — every example runs. Open one and it's loaded straight into this editor with a result ready.",
    placement: "below",
  },
];

const SEEN_KEY = "hmx-guide-seen-v1";

/** Guided tour is only for first-time desktop users (fine pointer + wide screen). */
export function isDesktopTour(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine) and (min-width: 1024px)").matches;
}

export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode — ignore */
  }
}

interface SpotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CardPos {
  left: number;
  top: number;
}

interface PlaygroundGuideProps {
  open: boolean;
  onDone: () => void;
}

export function PlaygroundGuide({ open, onDone }: PlaygroundGuideProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [spot, setSpot] = useState<SpotRect | null>(null);
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setStepIdx(0);
  }, [open]);

  const finish = useCallback(() => {
    markGuideSeen();
    onDone();
  }, [onDone]);

  const advance = useCallback(() => {
    if (stepIdx >= STEPS.length - 1) {
      finish();
    } else {
      setStepIdx(stepIdx + 1);
    }
  }, [stepIdx, finish]);

  // Position the spotlight + card on each step, and re-place on resize/scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const step = STEPS[Math.min(stepIdx, STEPS.length - 1)];
      const el = document.querySelector(step.selector);
      const card = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSpot({ left: r.left, top: r.top, width: r.width, height: r.height });
      if (!card) return;
      const cs = card.getBoundingClientRect();
      const gap = 14;
      let left = 0;
      let top = 0;
      switch (step.placement) {
        case "right":
          left = r.right + gap;
          top = r.top + r.height / 2 - cs.height / 2;
          break;
        case "left":
          left = r.left - gap - cs.width;
          top = r.top + r.height / 2 - cs.height / 2;
          break;
        case "below":
          left = r.left;
          top = r.bottom + gap;
          break;
        case "above":
          left = r.left;
          top = r.top - gap - cs.height;
          break;
      }
      const pad = 10;
      left = Math.max(pad, Math.min(left, window.innerWidth - cs.width - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - cs.height - pad));
      setCardPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    // Capture phase so it fires for inner scrollers (topbar, editor panes).
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, stepIdx]);

  // Keyboard: Esc closes (marks seen), arrows navigate, Enter/space advance.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        finish();
      } else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        setStepIdx((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, advance, finish]);

  if (!open) return null;
  const step = STEPS[Math.min(stepIdx, STEPS.length - 1)];

  return (
    <>
      <div className="guide-veil" aria-hidden="true" />
      {spot && (
        <div
          className="guide-spot"
          aria-hidden="true"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
          }}
        />
      )}
      <div
        ref={cardRef}
        className="guide-card"
        role="dialog"
        aria-label={`Tour step ${stepIdx + 1} of ${STEPS.length}`}
        data-edge={cardPos ? step.placement : "right"}
        style={
          cardPos
            ? { left: cardPos.left, top: cardPos.top }
            : { left: -2000, top: -2000 }
        }
      >
        <div className="guide-kicker">Guided tour</div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="guide-progress">
          step {stepIdx + 1} of {STEPS.length}
        </div>
        <div className="guide-actions">
          <span className="guide-dots" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`guide-dot ${i === stepIdx ? "guide-dot-on" : ""}`}
              />
            ))}
          </span>
          <button className="guide-btn guide-btn-skip" onClick={finish}>
            Skip
          </button>
          <button className="guide-btn guide-btn-next" onClick={advance}>
            {stepIdx === STEPS.length - 1 ? "Done" : "Next →"}
          </button>
        </div>
      </div>
    </>
  );
}