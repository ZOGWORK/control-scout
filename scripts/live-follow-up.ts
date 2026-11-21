// The live fast lane's follow-up after new results, run as a child process of the server where the data cycle
// runs in one (DATA_CYCLE=child). See server/data/liveFollowUp.ts. The server holds the writer lease for it; the
// job comes as JSON in the first argument, the counts go back over the IPC channel.
import "../server/env.js";
import { configure } from "../server/db.js";
import { runFollowUp, type FollowUpJob, type FollowUpMessage } from "../server/data/liveFollowUp.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const send = (m: FollowUpMessage) => new Promise<void>((r) => { if (process.send) process.send(m, () => r()); else r(); });

try {
  const job = JSON.parse(process.argv[2] ?? "") as FollowUpJob;
  await configure(); // same busy wait as the server: both processes write this file
  // The lease-holder's throttle is told as each records rebuild starts (a failure after that still counts).
  const r = await runFollowUp(job, { log, onRecords: (s) => { void send({ records: s }); } });
  await send({ done: r });
  process.exit(0);
} catch (e) {
  const err = e as { message?: string; code?: unknown };
  await send({ error: { message: String(err?.message ?? e).slice(0, 500), ...(typeof err?.code === "string" ? { code: err.code } : {}) } });
  process.exit(1);
}
