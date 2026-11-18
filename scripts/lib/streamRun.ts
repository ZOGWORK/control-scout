// A long-running command (the clip autopilot's frame reader) whose output is wanted line by line as it comes, not only
// when it ends, and which is stopped whole when it runs too long. Used by scripts/clip-autopilot.ts.
import { spawn, spawnSync } from "node:child_process";

export interface StreamRun { code: number; out: string; killed: boolean }

/** The commands still running, each with what stops its whole tree. Each has its own process group on macOS and
 *  Linux, so a Ctrl-C or SIGTERM to the runner, or the runner exiting, no longer reaches it by itself: the runner
 *  stops them all as it goes (stopAll), so a reader never runs on, writing its season file, after the run's lock is
 *  released. */
const live = new Set<(signal: NodeJS.Signals) => void>();
export const running = () => live.size;
export function stopAll(signal: NodeJS.Signals = "SIGKILL"): void { for (const kill of [...live]) kill(signal); }
let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => stopAll("SIGKILL"));
  // A signal's own default (ending the runner) is kept, once its commands are stopped: 128 + the signal's number.
  for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]] as const) process.on(sig, () => { stopAll("SIGTERM"); process.exit(128 + n); });
}

/**
 * Runs `cmd args`, calling `onLine` for each line of its stdout and stderr as it comes (a last line without its newline
 * too, at the end). Past `timeoutMs` the whole process tree is killed: a command like tsx runs its script in a child
 * process, which a kill of the command alone would leave running. On macOS and Linux the command gets its own process
 * group, signalled whole (TERM, then KILL after `graceMs`); on Windows, `taskkill /T /F`. Resolves with its exit code
 * (1 when killed or when it couldn't start), its stdout, and whether it was killed. If the runner itself exits or is
 * signalled first, the command's tree is stopped with it (stopAll).
 */
export function streamRun(cmd: string, args: string[], o: { timeoutMs: number; onLine: (line: string, from: "out" | "err") => void; onTimeout?: () => void; graceMs?: number; env?: NodeJS.ProcessEnv }): Promise<StreamRun> {
  hookExit();
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const child = spawn(cmd, args, { env: o.env ?? process.env, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", killed = false, settled = false;
    const rest = { out: "", err: "" };
    const take = (k: "out" | "err", chunk: Buffer) => {
      const s = chunk.toString("utf8");
      if (k === "out") out += s;
      const lines = (rest[k] + s).split("\n");
      rest[k] = lines.pop() ?? "";
      for (const l of lines) o.onLine(l.replace(/\r$/, ""), k);
    };
    child.stdout.on("data", (c: Buffer) => take("out", c));
    child.stderr.on("data", (c: Buffer) => take("err", c));
    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid == null) return;
      if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else try { process.kill(-child.pid, signal); } catch { /* already gone */ }
    };
    live.add(killTree);
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      killed = true;
      o.onTimeout?.();
      killTree("SIGTERM");
      grace = setTimeout(() => killTree("SIGKILL"), o.graceMs ?? 15_000);
      grace.unref();
    }, o.timeoutMs);
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      live.delete(killTree);
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      for (const k of ["out", "err"] as const) if (rest[k]) o.onLine(rest[k].replace(/\r$/, ""), k);
      resolve({ code: killed ? 1 : code, out, killed });
    };
    child.on("error", (e) => { o.onLine(`couldn't start: ${e.message}`, "err"); done(1); });
    child.on("close", (code) => done(code ?? 1));
  });
}
