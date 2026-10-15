import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { systemdSocket } from "./listen";

describe("systemdSocket", () => {
  it("is null when the server wasn't socket-activated", () => {
    expect(systemdSocket({}, 42)).toBeNull();
    expect(systemdSocket({ LISTEN_FDS: "0" }, 42)).toBeNull();
    expect(systemdSocket({ LISTEN_FDS: "x" }, 42)).toBeNull();
  });

  it("is fd 3 when systemd passed a socket to this process", () => {
    expect(systemdSocket({ LISTEN_FDS: "1", LISTEN_PID: "42" }, 42)).toEqual({ fd: 3 });
    expect(systemdSocket({ LISTEN_FDS: "1" }, 42)).toEqual({ fd: 3 });
  });

  it("ignores a socket meant for another process (an inherited environment)", () => {
    expect(systemdSocket({ LISTEN_FDS: "1", LISTEN_PID: "7" }, 42)).toBeNull();
  });
});

// The server the way the VM runs it: node --import tsx (not npx, whose extra
// process wouldn't pass the socket on).
const procs: ChildProcess[] = [];
afterEach(() => { for (const p of procs.splice(0)) p.kill("SIGKILL"); });
const port = () => 30_000 + Math.floor(Math.random() * 20_000);
const fixture = ["--import", "tsx", "server/listen.fixture.ts"];
const exited = (p: ChildProcess) => new Promise<number | null>((r) => p.once("exit", (code) => r(code)));
/** One request on a new connection, like nginx makes to the app (no keep-alive reuse). */
function once(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve(b)); }).on("error", reject);
  });
}
/** Waits for the server to come up (retrying refused connections), then one request. */
async function get(url: string, tries = 50): Promise<string> {
  for (let i = 0; ; i++) {
    try { return await once(url); } catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
}

// Signals are POSIX: on Windows a "SIGTERM" is a hard kill, so these run on Linux and macOS (CI).
describe.skipIf(process.platform === "win32")("stopping", () => {
  it("SIGTERM lets a request in progress finish, then exits cleanly", async () => {
    const p = port();
    const server = spawn(process.execPath, fixture, { env: { ...process.env, PORT: String(p) }, stdio: "ignore" });
    procs.push(server);
    await get(`http://127.0.0.1:${p}/hello`);
    const slow = once(`http://127.0.0.1:${p}/slow`);
    await new Promise((r) => setTimeout(r, 300));
    const exit = exited(server);
    server.kill("SIGTERM");
    expect(await slow).toBe("finished");
    expect(await exit).toBe(0);
  }, 20_000);
});

// The real mechanism: systemd's own socket activation tool (part of systemd, on Linux CI).
const activate = process.platform === "linux" && spawnSync("systemd-socket-activate", ["--help"]).status === 0;
describe.skipIf(!activate)("systemd socket activation", () => {
  it("serves on the socket systemd holds, including a request made before the server started", async () => {
    const p = port();
    // systemd-socket-activate opens the port now and starts the server only when the first connection arrives:
    // that request waits in the socket's queue, exactly like a request during a deploy's restart.
    const holder = spawn("systemd-socket-activate", ["-l", `127.0.0.1:${p}`, process.execPath, ...fixture], { stdio: "ignore" });
    procs.push(holder);
    expect(await get(`http://127.0.0.1:${p}/hello`)).toMatch(/^socket \d+$/);
  }, 20_000);
});

// A restart, the way systemd does one: a long-lived owner holds the socket (listen.owner.py),
// stops the server with SIGTERM and starts a new one on the same socket.
const python = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(!python)("restart with the socket held", () => {
  it("drops no request: one in progress finishes, one sent mid-restart waits for the new server", async () => {
    const p = port();
    const owner = spawn("python3", ["server/listen.owner.py", String(p), process.execPath, ...fixture], { stdio: ["pipe", "pipe", "inherit"] });
    procs.push(owner);
    const lines: string[] = [];
    owner.stdout!.on("data", (d) => lines.push(...String(d).trim().split("\n")));
    const first = await get(`http://127.0.0.1:${p}/hello`);
    expect(first).toMatch(/^socket \d+$/);

    const inProgress = once(`http://127.0.0.1:${p}/slow`);
    await new Promise((r) => setTimeout(r, 200));
    owner.stdin!.write("restart\n");
    await new Promise((r) => setTimeout(r, 300));
    // Sent while the old server drains and before the new one exists: it must wait, not fail.
    const midRestart = once(`http://127.0.0.1:${p}/hello`);

    expect(await inProgress).toBe("finished");
    const second = await midRestart;
    expect(second).toMatch(/^socket \d+$/);
    expect(second).not.toBe(first); // answered by the new server
    expect(lines).toContain("stopped 0");
  }, 30_000);
});
