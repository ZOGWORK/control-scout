// The visitor's address, as a rate limit's key (server/app.ts searchLimit and limiter). Behind Cloudflare, the
// connection nginx sees is Cloudflare's edge, so req.ip (one trusted proxy: nginx) is that edge, shared by every
// visitor it serves; Cloudflare names the visitor in CF-Connecting-IP. That header is believed only when the request
// came from Cloudflare (its published ranges): a client reaching the server some other way could set it to anything
// and give itself a fresh limit on every request. Only a limit's key: never stored, never logged.
import { BlockList, isIPv4, isIPv6 } from "node:net";
import type { Request } from "express";

/** Cloudflare's published address ranges (https://www.cloudflare.com/ips/, read 2026-11-10). */
export const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
export const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const cloudflare = new BlockList();
for (const r of CLOUDFLARE_V4) { const [a, n] = r.split("/"); cloudflare.addSubnet(a, Number(n), "ipv4"); }
for (const r of CLOUDFLARE_V6) { const [a, n] = r.split("/"); cloudflare.addSubnet(a, Number(n), "ipv6"); }

/** Whether `ip` is one of Cloudflare's (an IPv4 address written as IPv6, ::ffff:a.b.c.d, as its IPv4 self). */
export function fromCloudflare(ip: string | undefined): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIPv4(v4)) return cloudflare.check(v4, "ipv4");
  return isIPv6(ip) && cloudflare.check(ip, "ipv6");
}

/** The visitor's address: CF-Connecting-IP when the request came through Cloudflare, else req.ip. */
export function visitorIp(req: Pick<Request, "ip" | "get">): string {
  if (fromCloudflare(req.ip)) {
    const cf = req.get("cf-connecting-ip")?.trim();
    if (cf && (isIPv4(cf) || isIPv6(cf))) return cf;
  }
  return req.ip ?? "?";
}
