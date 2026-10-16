// Cloudflare Worker: checks controlscout.org every minute (Cron Trigger) and posts
// to Discord when it goes down, stays down (every 30 min) and comes back.
// Setup: deploy/uptime-worker/README.md. Logic: ./uptime.ts.
//
// The state (consecutive failures, down or not, last alert) lives in one Durable
// Object, so it is strongly consistent from one minute to the next; Workers KV
// can serve a read up to a minute stale, which could double an alert or miss
// the second failure. Only state changes are written, so a healthy site costs
// one Durable Object request a minute and no writes.
//
// The types below are the few pieces of the Workers runtime this file uses,
// declared here so the repo needs no @cloudflare/workers-types.

import { configFrom, tick, type MonitorState } from "./uptime";

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
interface DurableObjectState { storage: DurableObjectStorage }
interface DurableObjectStub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }

export interface Env {
  MONITOR: DurableObjectNamespace;
  SITE?: string;
  FAIL_THRESHOLD?: string;
  REMIND_MINUTES?: string;
  TIMEOUT_MS?: string;
  /** Secret (`wrangler secret put UPTIME_DISCORD_WEBHOOK`). Unset: alerts are only logged. */
  UPTIME_DISCORD_WEBHOOK?: string;
}

const KEY = "state";

function monitor(env: Env): DurableObjectStub {
  return env.MONITOR.get(env.MONITOR.idFromName("controlscout"));
}

export class Monitor {
  private running = false;

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/tick" && req.method === "POST") {
      // A tick still waiting on a slow site must not overlap the next one.
      if (this.running) return Response.json({ skipped: "previous tick still running" });
      this.running = true;
      try {
        const out = await tick(configFrom(this.env as unknown as Record<string, string | undefined>), {
          fetch: (url, init) => fetch(url, init),
          store: {
            get: () => this.ctx.storage.get<MonitorState>(KEY),
            put: (s) => this.ctx.storage.put(KEY, s),
          },
          log: (line) => console.log(line),
        });
        return Response.json({ ok: out.result.ok, state: out.state, alert: out.alert?.kind ?? null, delivery: out.delivery });
      } finally {
        this.running = false;
      }
    }
    if (path === "/state") return Response.json((await this.ctx.storage.get<MonitorState>(KEY)) ?? null);
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(monitor(env).fetch("https://monitor/tick", { method: "POST" }).then((r) => r.text()));
  },

  // GET / on the worker's own URL shows the current state (no secrets in it).
  async fetch(_req: Request, env: Env): Promise<Response> {
    return monitor(env).fetch("https://monitor/state");
  },
};
