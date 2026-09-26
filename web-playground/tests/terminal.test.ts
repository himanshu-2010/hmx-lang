// Pure-logic tests for the hero terminal command engine (terminal-lib.ts).
// No DOM needed — strings in, strings out. fetch-backed commands are tested
// on the failure path with a mocked global fetch.
import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  type TerminalContext,
  type LinesReply,
} from "../src/ui/terminal-lib";

function ctx(over?: Partial<TerminalContext>): TerminalContext {
  return { theme: "dark", setTheme: vi.fn(), navigate: vi.fn(), ...over };
}

const text = (r: LinesReply): string => r.lines.join("\n");
const run = (cmd: string, c: TerminalContext = ctx()): LinesReply =>
  runCommand(cmd, c) as LinesReply;

describe("terminal-lib", () => {
  it("lists every command in help", () => {
    const t = text(run("help"));
    for (const c of ["about", "hmx", "go", "theme", "ip", "github", "echo", "date", "clear"]) {
      expect(t).toContain(c);
    }
  });

  it("about introduces Himanshu Kumar with his GitHub", () => {
    const t = text(run("about"));
    expect(t).toContain("Himanshu Kumar");
    expect(t).toContain("github.com/himanshu-2010");
    expect(t).toContain("Class 10 student");
  });

  it("hmx explains the language", () => {
    const t = text(run("hmx"));
    expect(t).toContain("statically-typed");
    expect(t).toContain("closures");
  });

  it("version reports the shell version", () => {
    expect(text(run("version"))).toContain("hmx 0.9.0");
  });

  it("theme toggles when given no argument", () => {
    const c = ctx({ theme: "dark" });
    const r = run("theme", c);
    expect(text(r)).toContain("light");
    expect(c.setTheme).toHaveBeenCalledWith("light");
  });

  it("theme light switches and reports the new mode", () => {
    const c = ctx({ theme: "dark" });
    expect(text(run("theme light", c))).toContain("light");
    expect(c.setTheme).toHaveBeenCalledWith("light");
  });

  it("theme dark says already-dark without toggling", () => {
    const c = ctx({ theme: "dark" });
    const t = text(run("theme dark", c));
    expect(t).toContain("already in dark mode");
    expect(c.setTheme).not.toHaveBeenCalled();
  });

  it("theme rejects unknown values with the usage line", () => {
    expect(text(run("theme neon"))).toContain("usage: theme");
  });

  it("go playground navigates to the playground route", () => {
    const c = ctx();
    run("go playground", c);
    expect(c.navigate).toHaveBeenCalledWith("/playground");
  });

  it("go rejects unknown pages with a usage line", () => {
    expect(text(run("go mars"))).toContain("usage: go");
  });

  it("echo prints the argument back", () => {
    expect(text(run("echo hello world"))).toBe("hello world");
  });

  it("echo without text shows usage", () => {
    expect(text(run("echo"))).toContain("usage: echo");
  });

  it("unknown commands suggest help", () => {
    const t = text(run("sudo rm -rf /"));
    expect(t).toContain("command not found: sudo");
    expect(t).toContain("help");
  });

  it("clear returns the clear reply", () => {
    expect(runCommand("clear", ctx())).toEqual({ type: "clear" });
  });

  it("blank input returns no lines", () => {
    expect(runCommand("   ", ctx())).toEqual({ type: "lines", lines: [] });
  });

  it("whoami describes the visitor politely", () => {
    expect(text(run("whoami"))).toContain("visitor");
  });

  it("date returns a single timestamp line", () => {
    const r = run("date");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toBeTruthy();
  });

  it("commands are case-insensitive", () => {
    expect(text(run("HELP"))).toContain("about");
    expect(text(run("Echo ping"))).toBe("ping");
  });

  it("ip falls back when the lookup service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    const r = (await runCommand("ip", ctx())) as LinesReply;
    expect(text(r)).toContain("ipify.org");
    vi.restoreAllMocks();
  });

  it("github falls back when the API is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    const r = (await runCommand("github", ctx())) as LinesReply;
    expect(text(r)).toContain("github.com/himanshu-2010/hmx-lang");
    vi.restoreAllMocks();
  });
});