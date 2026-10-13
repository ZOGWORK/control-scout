// Real API + Vite servers for browser tooling (shots, audit), on dedicated
// ports so they never hit another app's dev server (e.g. Control Point on 5173).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export const WEB_PORT = 5199, API_PORT = 3199;

/** True only when Control Scout's own API answers (not some other app on the
 *  port) AND has its data ready. The server opens its port before its data is
 *  ready (health says ready:false meanwhile); older servers omit the field. */
export async function up(url: string, timeoutMs = 5000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, timeoutMs)) }); const j = await r.json(); return r.ok && j?.ok === true && typeof j.engine === "string" && j.ready !== false; } catch { return false; }
}

/** Poll until `up`, for at most `seconds` of wall-clock time (a cold start on a
 *  small host takes minutes). Each check is capped to the time that's left. */
export async function waitUp(url: string, seconds: number) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await up(url, Math.min(5000, deadline - Date.now()))) return true;
    const left = deadline - Date.now();
    if (left > 0) await new Promise((r) => setTimeout(r, Math.min(2000, left)));
  }
  return false;
}

const children: ChildProcess[] = [];

/** Start API + Vite unless `base` already answers. `external`: never start, only check. */
export async function ensureServers(base: string, external = false) {
  if (await up(`${base}/api/health`)) return;
  if (external) {
    if (await waitUp(`${base}/api/health`, 300)) return; // e.g. a sleeping/cold-starting host
    throw new Error(`${base} didn't become ready in 5 minutes`);
  }
  console.log("Starting API + Vite…");
  const env = { ...process.env, CS_NO_SCHEDULER: "1", PORT: String(API_PORT) };
  children.push(spawn("npx", ["tsx", "server/index.ts"], { env, shell: true, stdio: "ignore" }));
  children.push(spawn("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], { env, shell: true, stdio: "ignore" }));
  if (await waitUp(`${base}/api/health`, 120)) return;
  throw new Error("Servers didn't become ready in 120 s");
}

/** Stop anything ensureServers started. shell:true spawns a tree; on Windows kill
 *  the whole tree — synchronously, so a caller that exits right after (audit:flows
 *  calls process.exit) can't leave servers running on the tool ports. */
export function stopServers() {
  for (const c of children) {
    if (process.platform === "win32" && c.pid) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill();
  }
  children.length = 0;
}
