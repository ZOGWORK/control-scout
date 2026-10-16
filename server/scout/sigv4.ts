// AWS Signature Version 4 query-string signing (presigned URLs), the part of the
// S3 API that Cloudflare R2 needs from us. Photos use four calls (PUT from the
// browser, GET for viewing, HEAD and DELETE from the server) plus a bucket
// listing for the nightly meter, and every one of them is a presigned URL, so
// this one function is the whole client: no AWS SDK (several MB of
// dependencies for the same 60 lines). Checked against AWS's published
// example in sigv4.test.ts.
//
// Spec: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials { accessKeyId: string; secretAccessKey: string; region: string; service?: string }

/** RFC 3986 percent-encoding, as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** 20130524T000000Z */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Sign `url` for `method`, valid `expiresSec` from `now`. `headers` the caller
 * must send exactly (e.g. Content-Type on an upload); host is always signed.
 * The payload is unsigned (UNSIGNED-PAYLOAD), as for any presigned URL.
 */
export function presign(opts: { method: string; url: string; creds: SigV4Credentials; expiresSec: number; now?: Date; headers?: Record<string, string> }): string {
  const { method, creds, expiresSec } = opts;
  const u = new URL(opts.url);
  const date = amzDate(opts.now ?? new Date());
  const scope = `${date.slice(0, 8)}/${creds.region}/${creds.service ?? "s3"}/aws4_request`;
  const headers: Record<string, string> = { host: u.host };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const query: [string, string][] = [...u.searchParams.entries()].filter(([k]) => k !== "X-Amz-Signature");
  query.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"], ["X-Amz-Credential", `${creds.accessKeyId}/${scope}`], ["X-Amz-Date", date],
    ["X-Amz-Expires", String(Math.floor(expiresSec))], ["X-Amz-SignedHeaders", signedHeaders],
  );
  const canonicalQuery = query.map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  // Each path segment encoded once (S3 never double-encodes).
  const canonicalUri = u.pathname.split("/").map((seg) => uriEncode(decodeURIComponent(seg))).join("/") || "/";
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  let key: Buffer = hmac(`AWS4${creds.secretAccessKey}`, date.slice(0, 8));
  for (const part of [creds.region, creds.service ?? "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
  return `${u.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
