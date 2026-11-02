// The supporters page's list (GET /api/supporters, src/pages/SupportersPage.tsx), read from GitHub Sponsors
// with the profile owner's token (env.githubSponsorsToken). Each sponsor chose there whether to be public:
// public ones are listed by GitHub name, private ones are only counted, and no amount or tier is ever read
// out. Nothing is stored: the list lives in memory for an hour (a failed refresh keeps the last good one).
import { env } from "./env.js";
import { registerCache } from "./caches.js";
import type { Supporter, SupportersResponse } from "../src/shared/sponsor.js";

export const SUPPORTERS_TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const PAGE = 100, MAX_PAGES = 20;

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests: answer GitHub's API with a stand-in (null: the real fetch). */
export function setSponsorsFetch(f: Fetch | null) { fetchImpl = f; }

// Past sponsors too (activeOnly: false): a one-time sponsor is still thanked after the month ends.
const QUERY = `query($after: String) {
  viewer { sponsorshipsAsMaintainer(first: ${PAGE}, after: $after, includePrivate: true, activeOnly: false) {
    pageInfo { hasNextPage endCursor }
    nodes { privacyLevel createdAt sponsorEntity { ... on User { login name } ... on Organization { login name } } }
  } }
}`;
interface Node { privacyLevel: "PUBLIC" | "PRIVATE"; createdAt: string; sponsorEntity: { login?: string; name?: string | null } | null }
interface Page { data?: { viewer?: { sponsorshipsAsMaintainer?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } } }; errors?: unknown[] }

/** Sponsorships → the page's list: one row per public sponsor (first sponsorship's date), oldest first; the
 *  private ones (and any whose account is gone) as a count of distinct sponsors. Private names are dropped here. */
export function toSupporters(nodes: Node[]): { supporters: Supporter[]; anonymous: number } {
  const pub = new Map<string, Supporter>();
  const anon = new Set<string>();
  let unnamed = 0;
  for (const n of nodes) {
    const login = n.sponsorEntity?.login;
    if (n.privacyLevel !== "PUBLIC" || !login) {
      if (login) anon.add(login.toLowerCase()); else unnamed++;
      continue;
    }
    const prev = pub.get(login.toLowerCase());
    if (!prev || n.createdAt < prev.since) pub.set(login.toLowerCase(), { login, name: n.sponsorEntity?.name?.trim() || null, since: n.createdAt });
  }
  // Someone who has sponsored both ways is shown: they made at least one sponsorship public.
  for (const k of pub.keys()) anon.delete(k);
  return { supporters: [...pub.values()].sort((a, b) => a.since.localeCompare(b.since) || a.login.localeCompare(b.login)), anonymous: anon.size + unnamed };
}

async function fetchAll(token: string): Promise<Node[]> {
  const out: Node[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await (fetchImpl ?? fetch)("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "control-scout-supporters" },
      body: JSON.stringify({ query: QUERY, variables: { after } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const body = (await res.json()) as Page;
    const conn = body.data?.viewer?.sponsorshipsAsMaintainer;
    if (!conn || body.errors?.length) throw new Error("GitHub answered without sponsorships");
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

let cached: { at: number; value: SupportersResponse } | null = null;
let inflight: Promise<SupportersResponse> | null = null;
registerCache("supporters", () => { cached = null; });

/** The list, at most an hour old. No token: configured false. GitHub down: the last good list, or throws. */
export async function supporters(now = Date.now()): Promise<SupportersResponse> {
  const token = env.githubSponsorsToken;
  if (!token) return { configured: false, supporters: [], anonymous: 0, updatedAt: null };
  if (cached && now - cached.at < SUPPORTERS_TTL_MS) return cached.value;
  inflight ??= fetchAll(token)
    .then((nodes) => {
      const value: SupportersResponse = { configured: true, ...toSupporters(nodes), updatedAt: new Date(now).toISOString() };
      cached = { at: now, value };
      return value;
    })
    .catch((e) => {
      console.warn(`[supporters] couldn't read GitHub Sponsors: ${(e as Error)?.message ?? e}`);
      // Keep showing the last good list, and ask GitHub again in 5 minutes rather than on every visit.
      if (cached) { cached = { at: now - SUPPORTERS_TTL_MS + RETRY_MS, value: cached.value }; return cached.value; }
      throw e;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
