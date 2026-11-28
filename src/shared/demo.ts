// The demo account (server/demo/demo.ts, docs/demo.md): read-only, shared by the server's guard and the app, which
// stops a change before it is sent so nothing a visitor does in the demo reads as an error or a lost membership.

/** The demo's sample workspace (server/demo/demo.ts): Scout's own, never one of Control Point's. */
export const DEMO_WORKSPACE_ID = "demo-sample-workspace";

/** What the demo says to any change. */
export const DEMO_READ_ONLY = "This is the demo account, so changes aren't saved. Sign in with your own account to keep yours.";
export const DEMO_READ_ONLY_CODE = "demo_read_only";
/** 405: a status nothing else in the app reacts to (a 403 reads as "removed from the workspace", a 423 as "deleted"). */
export const DEMO_READ_ONLY_STATUS = 405;

/** Changes (paths under /api) a demo session may still make: signing out or into a real account, and the app's own
 *  telemetry and reports. Everything else that isn't a read is refused. */
export const DEMO_ALLOWED = /^\/(?:api\/)?(?:auth\/(?:logout|demo|email\/(?:start|verify))|collect(?:\/[a-z]+)?|search\/click|errors?|bug-reports|contact)\/?(?:\?.*)?$/i;

/** Does this request change something the demo refuses? (`path`: under /api or with its /api prefix.) */
export const demoRefuses = (method: string | undefined, path: string): boolean => {
  const m = (method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !DEMO_ALLOWED.test(path);
};

/** GET /api/auth/demo: the event and team the demo account was seeded from, for the tour on /demo. */
export interface DemoSummary { season: number; eventCode: string; eventName: string; myTeam: number; myTeamName: string; workspaceId: string; seededAt: string }
