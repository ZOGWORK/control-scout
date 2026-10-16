// Cloudflare R2 (S3 API) for entry photos: configuration from env (server/env.ts,
// docs/r2-photos.md) and the handful of calls photos need, each a presigned URL
// (sigv4.ts). Path-style URLs: <endpoint>/<bucket>/<key>.
//
// Not configured (any of the key id, secret, bucket or endpoint/account id
// missing): r2() is null and photos are off everywhere, UI included.
// R2_FAKE=1 (development and tests, never production) points everything at the
// in-process stand-in (fakeR2.ts). Under vitest only a localhost endpoint is
// ever used, so a test can't touch the real bucket even with real secrets in .env.
import { env } from "../env.js";
import { presign, type SigV4Credentials } from "./sigv4.js";

export interface R2Config { endpoint: string; bucket: string; creds: SigV4Credentials; fake: boolean }

/** The stand-in's credentials (it checks signatures with them). Not secrets: it only runs locally. */
export const FAKE_R2_CREDS = { accessKeyId: "fake-r2-key", secretAccessKey: "fake-r2-secret" };

const local = (endpoint: string) => {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname); } catch { return false; }
};

/** The R2 settings, or null when photos aren't configured. */
export function r2(): R2Config | null {
  let cfg: R2Config | null;
  if (env.r2Fake) {
    cfg = {
      endpoint: (env.r2Endpoint ?? `http://localhost:${env.port}/__fake-r2`).replace(/\/$/, ""),
      bucket: env.r2Bucket ?? "control-scout-photos",
      creds: { ...FAKE_R2_CREDS, region: "auto" }, fake: true,
    };
  } else {
    const keyId = env.r2AccessKeyId, secret = env.r2SecretAccessKey, bucket = env.r2Bucket;
    const endpoint = env.r2Endpoint ?? (env.r2AccountId ? `https://${env.r2AccountId}.r2.cloudflarestorage.com` : null);
    cfg = keyId && secret && bucket && endpoint
      ? { endpoint: endpoint.replace(/\/$/, ""), bucket, creds: { accessKeyId: keyId, secretAccessKey: secret, region: "auto" }, fake: false }
      : null;
  }
  // Tests never reach a real bucket.
  if (cfg && process.env.VITEST && !local(cfg.endpoint)) return null;
  return cfg;
}

const objectUrl = (c: R2Config, key: string) => `${c.endpoint}/${encodeURIComponent(c.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

/**
 * A URL the browser PUTs the photo to. Content-Type and Content-Length are signed: the body must be
 * exactly `bytes` long (the browser sends the length itself), so storage refuses anything larger
 * than what was reserved against the cap, a repeat PUT within the URL's lifetime included.
 */
export function uploadUrl(c: R2Config, key: string, contentType: string, bytes: number, ttlSec: number): string {
  return presign({ method: "PUT", url: objectUrl(c, key), creds: c.creds, expiresSec: ttlSec, headers: { "Content-Type": contentType, "Content-Length": String(bytes) } });
}

/** A short-lived URL to view a photo. */
export function viewUrl(c: R2Config, key: string, ttlSec: number): string {
  return presign({ method: "GET", url: objectUrl(c, key), creds: c.creds, expiresSec: ttlSec });
}

const call = async (c: R2Config, method: string, url: string) => {
  const r = await fetch(presign({ method, url, creds: c.creds, expiresSec: 60 }), { method, signal: AbortSignal.timeout(15_000) });
  return r;
};

export class R2Error extends Error {}

/** The object's size, or null when it isn't there. Throws on anything else (R2 down, bad credentials). */
export async function headObject(c: R2Config, key: string): Promise<{ bytes: number } | null> {
  const r = await call(c, "HEAD", objectUrl(c, key));
  if (r.status === 404) return null;
  if (!r.ok) throw new R2Error(`R2 HEAD answered ${r.status}`);
  return { bytes: Number(r.headers.get("content-length") ?? 0) };
}

/** Delete an object (gone already counts as deleted). Throws when R2 refuses or can't be reached. */
export async function deleteObject(c: R2Config, key: string): Promise<void> {
  const r = await call(c, "DELETE", objectUrl(c, key));
  await r.arrayBuffer().catch(() => undefined);
  if (!r.ok && r.status !== 404) throw new R2Error(`R2 DELETE answered ${r.status}`);
}

export interface ListedObject { key: string; bytes: number; lastModified: number }

const xmlText = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every object under `prefix` (ListObjectsV2, 1000 a page). */
export async function listObjects(c: R2Config, prefix: string): Promise<ListedObject[]> {
  const out: ListedObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < 10_000; page++) {
    const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const r = await call(c, "GET", `${c.endpoint}/${encodeURIComponent(c.bucket)}?${q}`);
    const xml = await r.text();
    if (!r.ok) throw new R2Error(`R2 list answered ${r.status}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = m[1];
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
      if (!key) continue;
      out.push({ key: xmlText(key), bytes: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0), lastModified: Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(body)?.[1] ?? "") || 0 });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || null : null;
    if (!token) break;
  }
  return out;
}
