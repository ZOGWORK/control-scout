// /packs/* — versioned offline data packs (built by scripts/build-packs.ts).
// latest.json is the manifest the app polls; pack files are immutable.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.js";
import type { Manifest } from "./build.js";
import { featureDisabled, isEnabled } from "../flags.js";
import { featureOffMessage } from "../../src/shared/flags.js";

/** Offline packs switched off by the owner (the offlinePacks feature toggle): every pack URL answers 403
 *  {error: "feature_disabled", feature: "offlinePacks", paused: true}, nothing is served. The files stay on disk. */
export const PACKS_PAUSED = featureOffMessage("offlinePacks");

export const packsDir = () => join(env.dataDir, "packs");

/** True when the manifest parses and every file it lists is on disk. */
/** Engine version the current packs were built with (null when there are none). */
export function packsEngine(): string | null {
  try { return (JSON.parse(readFileSync(join(packsDir(), "latest.json"), "utf8")) as Manifest).engineVersion ?? null; } catch { return null; }
}

export function packsPresent(): boolean {
  try {
    const m = JSON.parse(readFileSync(join(packsDir(), "latest.json"), "utf8")) as Manifest;
    const files = [m.lite, ...(m.full ?? [])].filter((f): f is NonNullable<typeof f> => !!f);
    return files.length > 0 && files.every((f) => existsSync(join(packsDir(), f.name)));
  } catch { return false; }
}

export function packsRouter(): Router {
  const r = express.Router();
  r.use((_req: Request, res: Response, next: NextFunction) => {
    isEnabled("offlinePacks").then((on) => {
      if (on) return next();
      featureDisabled(res, "offlinePacks", { paused: true });
    }, next);
  });
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
