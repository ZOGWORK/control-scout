// streamRun (scripts/lib/streamRun.ts): lines as they come, and a run past its limit stopped whole, its child too.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamRun } from "./streamRun";

const node = process.execPath;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("streamRun", () => {
  it("gives each line of stdout and stderr as it comes, a last line without its newline too, and the exit", async () => {
    const lines: string[] = [];
    const r = await streamRun(node, ["-e", "process.stdout.write('a\\nb\\n'); process.stderr.write('e1\\n'); process.stdout.write('tail'); process.exitCode = 3"], {
      timeoutMs: 20_000, onLine: (l, from) => lines.push(`${from}:${l}`),
    });
    expect(r).toEqual({ code: 3, out: "a\nb\ntail", killed: false });
    expect(lines.filter((l) => l.startsWith("out:"))).toEqual(["out:a", "out:b", "out:tail"]);
    expect(lines).toContain("err:e1");
  });

  it("shows a line before the command ends, not only after", async () => {
    let firstAt = 0;
    const started = Date.now();
    await streamRun(node, ["-e", "console.log('now'); setTimeout(() => console.log('later'), 1500)"], {
      timeoutMs: 20_000, onLine: (l) => { if (l === "now" && !firstAt) firstAt = Date.now() - started; },
    });
    expect(firstAt).toBeGreaterThan(0);
    expect(firstAt).toBeLessThan(1400);
  });

  it("past its limit stops the whole tree: a grandchild still running (tsx's child is the reader) dies with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "streamrun-"));
    const pidFile = join(dir, "grandchild.pid").replace(/\\/g, "/");
    // The child starts a grandchild that writes its pid and would run a minute, then waits on it.
    const script = `const { spawn } = require("node:child_process"); const g = spawn(process.execPath, ["-e", "require('node:fs').writeFileSync('${pidFile}', String(process.pid)); setTimeout(() => {}, 60000)"], { stdio: "inherit" }); console.log("started"); g.on("exit", () => process.exit(0));`;
    let timedOut = false;
    const lines: string[] = [];
    const t0 = Date.now();
    const r = await streamRun(node, ["-e", script], { timeoutMs: 2_500, graceMs: 2_000, onLine: (l) => lines.push(l), onTimeout: () => { timedOut = true; } });
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.killed).toBe(true);
    expect(r.code).toBe(1);
    expect(timedOut).toBe(true);
    expect(lines).toContain("started");
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    await wait(3_000);
    expect(alive(grandchild)).toBe(false);
  }, 40_000);

  it("a command that can't start resolves as a failure, never throws", async () => {
    const lines: string[] = [];
    const r = await streamRun(join(tmpdir(), "no-such-command-xyz"), [], { timeoutMs: 5_000, onLine: (l) => lines.push(l) });
    expect(r.code).toBe(1);
    expect(lines.some((l) => l.startsWith("couldn't start"))).toBe(true);
  });
});
