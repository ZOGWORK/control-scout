// Test fixture for listen.test.ts: a tiny server that listens the way
// server/index.ts does (the systemd socket when there is one) and drains on
// SIGTERM. GET /slow answers after 1.5 s, /hang never. GRACE_MS: the grace period. HOLD_MS: work begun at SIGTERM the exit waits for (a data cycle finishing).
import express from "express";
import type { Server } from "node:http";
import { drainOnSigterm, systemdSocket } from "./listen";

const socket = systemdSocket();
const app = express();
app.get("/hello", (_req, res) => res.send(`${socket ? "socket" : "port"} ${process.pid}`));
app.get("/slow", (_req, res) => { setTimeout(() => res.send("finished"), 1500); });
app.get("/hang", () => {});
let http: Server | null = null;
const holdMs = Number(process.env.HOLD_MS ?? 0);
drainOnSigterm(() => http, (m) => console.log(m), Number(process.env.GRACE_MS ?? 10_000), undefined, holdMs ? () => new Promise((r) => setTimeout(r, holdMs)) : undefined);
http = socket ? app.listen(socket, () => console.log("listening")) : app.listen(Number(process.env.PORT), () => console.log("listening"));
