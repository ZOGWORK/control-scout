// Test fixture for listen.test.ts: a tiny server that listens the way
// server/index.ts does (the systemd socket when there is one) and drains on
// SIGTERM. GET /slow answers after 1.5 s.
import express from "express";
import type { Server } from "node:http";
import { drainOnSigterm, systemdSocket } from "./listen";

const socket = systemdSocket();
const app = express();
app.get("/hello", (_req, res) => res.send(`${socket ? "socket" : "port"} ${process.pid}`));
app.get("/slow", (_req, res) => { setTimeout(() => res.send("finished"), 1500); });
let http: Server | null = null;
drainOnSigterm(() => http, (m) => console.log(m));
http = socket ? app.listen(socket, () => console.log("listening")) : app.listen(Number(process.env.PORT), () => console.log("listening"));
