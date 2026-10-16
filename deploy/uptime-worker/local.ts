// Runs the uptime Worker's logic from Node, for local testing and demos:
//
//   SITE=http://localhost:4061 UPTIME_DISCORD_WEBHOOK=http://127.0.0.1:6061/hook \
//     INTERVAL_SECONDS=60 npx tsx deploy/uptime-worker/local.ts
//
// Same checks, debounce and messages as the Worker (src/uptime.ts); the state is
// kept in memory instead of a Durable Object. Nothing is posted anywhere unless
// UPTIME_DISCORD_WEBHOOK is set in this shell. Stop with Ctrl+C.
// ONCE=1 runs a single tick and exits (0 up, 1 failing).

import { configFrom, INITIAL_STATE, num, tick, type StoredState } from "./src/uptime";

const cfg = configFrom(process.env);
const intervalMs = num(process.env.INTERVAL_SECONDS, 60) * 1000;
let state: StoredState = { ...INITIAL_STATE };
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function once(): Promise<boolean> {
  const out = await tick(cfg, {
    fetch: (url, init) => fetch(url, init),
    store: { get: async () => state, put: async (s) => { state = s; } },
    log,
  });
  return out.result.ok;
}

log(`Checking ${cfg.site} every ${intervalMs / 1000} s; alert after ${cfg.threshold} failures in a row; webhook ${cfg.webhookUrl ? "set" : "not set (log only)"}`);
if (process.env.ONCE === "1") {
  process.exit((await once()) ? 0 : 1);
}
for (;;) {
  const started = Date.now();
  await once().catch((e) => log(`tick failed: ${(e as Error).message}`));
  await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - started))));
}
