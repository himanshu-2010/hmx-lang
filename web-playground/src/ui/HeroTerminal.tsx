import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./ThemeToggle";
import { runCommand, type TerminalReply } from "./terminal-lib";

const DEMO_LINES = [
  "$ hmx run main.hmx",
  "→ 42 42",
  "",
  "live shell — type 'help' for commands",
];

function isAsync(reply: TerminalReply): reply is Promise<{ type: "lines"; lines: string[] }> {
  return typeof (reply as Promise<unknown>).then === "function";
}

/**
 * Interactive terminal in the hero card. Starts with the classic
 * `hmx run main.hmx → 42 42` demo, then accepts shell commands
 * (help / about / hmx / go / theme / ip / github / …).
 */
export function HeroTerminal() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [lines, setLines] = useState<string[]>(DEMO_LINES);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const outRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest output in view as lines accumulate.
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Focus once on load for desktop pointers (skip mobile so the soft
  // keyboard doesn't pop open uninvited).
  useEffect(() => {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      inputRef.current?.focus();
    }
  }, []);

  const append = (more: string[]) =>
    setLines((prev) => [...prev, ...more]);

  const submit = () => {
    const raw = input;
    const cmd = raw.trim();
    if (cmd) setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    setInput("");
    append([`$ ${raw}`]);
    if (!cmd) return;

    const reply = runCommand(cmd, {
      theme,
      setTheme,
      navigate: (path) => navigate(path),
    });
    if (isAsync(reply)) {
      reply.then(
        (r) => append(r.lines),
        () => append(["something went wrong — try again."]),
      );
    } else if (reply.type === "clear") {
      setLines([]);
    } else {
      append(reply.lines);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === -1) return;
      if (histIdx >= history.length - 1) {
        setHistIdx(-1);
        setInput("");
      } else {
        const idx = histIdx + 1;
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  };

  return (
    <div className="hero-terminal">
      <div className="hero-term-output" ref={outRef}>
        {lines.map((ln, i) => (
          <div className="hero-term-line" key={i}>
            {ln === "" ? "\u00A0" : ln}
          </div>
        ))}
      </div>
      <div className="hero-term-input-row">
        <span className="hero-term-prompt" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          className="hero-term-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="type a command — 'help' to start"
          aria-label="hmx terminal input"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}