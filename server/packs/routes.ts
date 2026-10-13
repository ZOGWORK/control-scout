// /packs/* — versioned offline data packs (built by scripts/build-packs.ts).
// latest.json is the manifest the app polls; pack files are immutable.
import express, { type Router } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.js";

export const packsDir = () => join(env.dataDir, "packs");

export function packsRouter(): Router {
  const r = express.Router();
  r.get("/latest.json", (_req, res) => {
    const f = join(packsDir(), "latest.json");
    if (!existsSync(f)) { res.status(404).json({ error: "No offline packs have been built on this server yet." }); return; }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(f);
  });
  r.get("/:file", (req, res) => {
    const name = req.params.file;
    if (!/^scout-pack-[a-z0-9-]+\.(db|json)(\.gz)?$/.test(name)) { res.status(404).json({ error: "Not found" }); return; }
    const f = join(packsDir(), name);
    if (!existsSync(f)) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.download(f, name);
  });
  return r;
}
