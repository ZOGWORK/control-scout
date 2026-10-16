// A stand-in for Cloudflare R2, for development and tests (R2_FAKE=1; never in
// production): the S3 calls photos make (PUT, GET, HEAD, DELETE and a
// ListObjectsV2 of a prefix), each only with a valid, unexpired presigned URL
// for the fake credentials, the same signature check R2 does. CORS answers like
// the real bucket's rules (docs/r2-photos.md) for the app's own origin, so the
// browser uploads to it exactly as it would to R2.
//
// Objects live in memory, or under R2_FAKE_DIR when set (so a dev server's
// restart keeps them).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { env } from "../env.js";
import { FAKE_R2_CREDS } from "./r2.js";
import { presign } from "./sigv4.js";

interface Obj { body: Buffer; contentType: string; lastModified: number }
const memory = new Map<string, Obj>();

const store = {
  get(key: string): Obj | null {
    const dir = env.r2FakeDir;
    if (!dir) return memory.get(key) ?? null;
    const f = join(dir, ...key.split("/"));
    if (!existsSync(f)) return null;
    return { body: readFileSync(f), contentType: "image/jpeg", lastModified: statSync(f).mtimeMs };
  },
  put(key: string, o: Obj) {
    const dir = env.r2FakeDir;
    if (!dir) { memory.set(key, o); return; }
    const f = join(dir, ...key.split("/"));
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, o.body);
  },
  delete(key: string) {
    const dir = env.r2FakeDir;
    if (!dir) { memory.delete(key); return; }
    rmSync(join(dir, ...key.split("/")), { force: true });
  },
  list(prefix: string): { key: string; o: Obj }[] {
    const dir = env.r2FakeDir;
    if (!dir) return [...memory.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, o }));
    const out: { key: string; o: Obj }[] = [];
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else {
          const key = relative(dir, p).split(sep).join("/");
          if (key.startsWith(prefix)) out.push({ key, o: { body: readFileSync(p), contentType: "image/jpeg", lastModified: statSync(p).mtimeMs } });
        }
      }
    };
    walk(dir);
    return out;
  },
};

/** Tests: every stored object, and a way to drop them all. */
export const fakeR2 = {
  keys: (prefix = "") => store.list(prefix).map((x) => x.key).sort(),
  has: (key: string) => !!store.get(key),
  put: (key: string, body: Buffer) => store.put(key, { body, contentType: "image/jpeg", lastModified: Date.now() }),
  clear: () => { memory.clear(); },
};

/** Is this request signed like a presigned URL from r2.ts, and still valid? */
function validSignature(req: Request): boolean {
  const q = new URL(req.originalUrl, "http://x").searchParams;
  const date = q.get("X-Amz-Date"), expires = Number(q.get("X-Amz-Expires")), given = q.get("X-Amz-Signature");
  const cred = q.get("X-Amz-Credential") ?? "";
  if (!date || !given || !Number.isFinite(expires) || !cred.startsWith(`${FAKE_R2_CREDS.accessKeyId}/`)) return false;
  const at = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  if (!Number.isFinite(at) || Date.now() > at + expires * 1000) return false;
  const headers: Record<string, string> = {};
  for (const h of (q.get("X-Amz-SignedHeaders") ?? "").split(";")) if (h && h !== "host") headers[h] = req.get(h) ?? "";
  // Rebuild the URL as signed (the X-Amz-* parameters are added back by presign).
  const plain = new URLSearchParams([...q.entries()].filter(([k]) => !k.startsWith("X-Amz-")));
  const host = req.get("host") ?? "";
  const url = `${req.protocol}://${host}${req.originalUrl.split("?")[0]}${[...plain.keys()].length ? `?${plain}` : ""}`;
  const expected = presign({
    method: req.method, url, creds: { ...FAKE_R2_CREDS, region: "auto" }, expiresSec: expires, headers,
    now: new Date(at),
  });
  return new URL(expected).searchParams.get("X-Amz-Signature") === given;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fakeR2Router(): Router {
  const r = express.Router();
  // CORS as the real bucket's rules: the app's origin, GET/PUT/DELETE/HEAD, Content-Type, an hour's preflight cache.
  r.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
      res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, PUT, DELETE, HEAD", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "3600", Vary: "Origin" });
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  r.use(express.raw({ type: () => true, limit: "20mb" }));
  r.all(/.*/, (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    if (!validSignature(req)) { res.status(403).type("application/xml").send("<Error><Code>SignatureDoesNotMatch</Code></Error>"); return; }
    const parts = req.path.replace(/^\//, "").split("/").map(decodeURIComponent);
    const key = parts.slice(1).join("/");
    if (!key) {
      if (req.method !== "GET") { res.status(405).end(); return; }
      const prefix = String(req.query.prefix ?? "");
      const items = store.list(prefix);
      res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map(({ key: k, o }) =>
        `<Contents><Key>${xml(k)}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`).join("")}</ListBucketResult>`);
      return;
    }
    if (req.method === "PUT") {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      store.put(key, { body, contentType: req.get("content-type") ?? "application/octet-stream", lastModified: Date.now() });
      res.status(200).end();
      return;
    }
    const o = store.get(key);
    if (req.method === "DELETE") { store.delete(key); res.status(204).end(); return; }
    if (!o) { res.status(404).type("application/xml").send("<Error><Code>NoSuchKey</Code></Error>"); return; }
    res.set({ "Content-Type": o.contentType, "Content-Length": String(o.body.length), "Last-Modified": new Date(o.lastModified).toUTCString() });
    if (req.method === "HEAD") { res.status(200).end(); return; }
    if (req.method === "GET") { res.status(200).end(o.body); return; }
    res.status(405).end();
  });
  return r;
}
