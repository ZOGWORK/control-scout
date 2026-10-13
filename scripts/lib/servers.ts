// Real API + Vite servers for browser tooling (shots, audit), on dedicated
// ports so they never hit another app's dev server (e.g. Control Point on 5173).
import { spawn, type ChildProcess } from "node:child_process";

export const WEB_PORT = 5199, API_PORT = 3199;

/** True only when Control Scout's own API answers (not some other app on the port). */
export async function up(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); const j = await r.json(); return r.ok && j?.ok === true && typeof j.engine === "string"; } catch { return false; }
}

const children: ChildProcess[] = [];

/** Start API + Vite unless `base` already answers. `external`: never start, only check. */
export async function ensureServers(base: string, external = false) {
  if (await up(`${base}/api/health`)) return;
  if (external) throw new Error(`${base} isn't reachable`);
  console.log("Starting API + Vite…");
  const env = { ...process.env, CS_NO_SCHEDULER: "1", PORT: String(API_PORT) };
  children.push(spawn("npx", ["tsx", "server/index.ts"], { env, shell: true, stdio: "ignore" }));
  children.push(spawn("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { env, shell: true, stdio: "ignore" }));
  for (let i = 0; i < 90; i++) { if (await up(`${base}/api/health`)) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error("Servers didn't come up in 90 s");
}

/** Stop anything ensureServers started. shell:true spawns a tree; on Windows kill the whole tree. */
export function stopServers() {
  for (const c of children) {
    if (process.platform === "win32" && c.pid) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill();
  }
}
