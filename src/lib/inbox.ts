// The notification inbox on the device (docs/inbox.md): the bell's unread count and the list behind it.
// Read and follow-up state live on the server, so marking an item read (or unread, or flagging it to follow
// up) on one device changes it on the others: the stream tells every tab, and an open list refetches.
//
// Live: an EventSource on /api/inbox/stream (one per signed-in tab, across every workspace, open whether
// or not a scout space is) sends the unread count on connect and whenever an item arrives or read state
// changes anywhere. When it keeps failing, or the owner switched live updates off (503), or EventSource
// isn't there, the count is polled every 45 s while the tab is visible, and the stream is tried again
// every 2 minutes. Either way the count is fetched again when the tab comes back into focus, and the
// stream lets go after the tab has been hidden for a minute.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { INBOX_PAGE, INBOX_PAGE_MAX, type InboxFilter, type InboxItem, type InboxPage } from "../shared/inbox";

export type InboxMode = "off" | "connecting" | "live" | "polling";

export const INBOX_BACKOFF_MS = [2_000, 5_000, 15_000];
export const INBOX_POLL_MS = 45_000;
export const INBOX_STREAM_RETRY_MS = 120_000;
export const INBOX_HIDDEN_CLOSE_MS = 60_000;
/** Kept row ids per Follow up request (the server takes up to 200). */
const KEEP_BATCH = 200;

export interface InboxNotice { unread: number; latest: number | null; followUp?: number | null }

interface Deps {
  EventSource?: typeof EventSource;
  count?: () => Promise<InboxNotice | null>;
  random?: () => number;
}

const fetchCount = async (): Promise<InboxNotice | null> => {
  const r = await apiFetch<{ unread: number }>("/api/inbox/unread-count");
  return Number.isFinite(r?.unread) ? { unread: r.unread, latest: null } : null;
};

/** Follow the signed-in account's inbox until stop() is called. `onNotice` hears each count; `onMode` each change of mode. */
export function followInbox(onNotice: (n: InboxNotice) => void, onMode: (m: InboxMode) => void, deps: Deps = {}): () => void {
  const ES = "EventSource" in deps ? deps.EventSource : (globalThis as { EventSource?: typeof EventSource }).EventSource;
  const count = deps.count ?? fetchCount;
  const random = deps.random ?? Math.random;
  let es: EventSource | null = null;
  let stopped = false, failures = 0;
  let mode: InboxMode | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;

  const setMode = (m: InboxMode) => { if (m !== mode) { mode = m; onMode(m); } };
  const close = () => { if (es) { es.close(); es = null; } };
  const clearRetry = () => { if (retry) { clearTimeout(retry); retry = null; } };
  const poll = () => { count().then((n) => { if (n && !stopped) onNotice(n); }, () => { /* offline: the next tick tries again */ }); };
  const startPolling = () => {
    setMode("polling");
    if (poller) return;
    poll();
    poller = setInterval(poll, INBOX_POLL_MS);
  };
  const stopPolling = () => { if (poller) { clearInterval(poller); poller = null; } };

  function failed() {
    close();
    if (stopped) return;
    failures++;
    clearRetry();
    if (failures === 1) poll(); // the badge stays right while the stream is away
    if (failures > INBOX_BACKOFF_MS.length) {
      startPolling();
      retry = setTimeout(connect, INBOX_STREAM_RETRY_MS);
    } else {
      const base = INBOX_BACKOFF_MS[failures - 1];
      retry = setTimeout(connect, base + Math.floor(random() * base * 0.3));
    }
  }

  function connect() {
    retry = null;
    if (stopped) return;
    if (!ES) { startPolling(); return; }
    if (!poller) setMode("connecting");
    const s = new ES("/api/inbox/stream", { withCredentials: true });
    es = s;
    s.addEventListener("inbox", (ev) => {
      if (es !== s) return;
      let n: Partial<InboxNotice> = {};
      try { n = JSON.parse((ev as MessageEvent<string>).data) ?? {}; } catch { return; }
      if (!Number.isSafeInteger(n.unread)) return;
      failures = 0;
      stopPolling(); clearRetry();
      setMode("live");
      onNotice({ unread: n.unread!, latest: Number.isSafeInteger(n.latest) ? n.latest! : null, followUp: Number.isSafeInteger(n.followUp) ? n.followUp! : null });
    });
    s.onerror = () => { if (es === s) failed(); };
  }

  const online = () => { if (!stopped && !es) { failures = 0; clearRetry(); connect(); } };
  const focus = () => { if (!stopped) poll(); };
  window.addEventListener("online", online);
  window.addEventListener("focus", focus);
  connect();
  return () => {
    stopped = true;
    window.removeEventListener("online", online);
    window.removeEventListener("focus", focus);
    close(); clearRetry(); stopPolling();
    setMode("off");
  };
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const change = () => {
      if (t) { clearTimeout(t); t = null; }
      if (document.visibilityState === "hidden") t = setTimeout(() => setVisible(false), INBOX_HIDDEN_CLOSE_MS);
      else setVisible(true);
    };
    document.addEventListener("visibilitychange", change);
    return () => { document.removeEventListener("visibilitychange", change); if (t) clearTimeout(t); };
  }, []);
  return visible;
}

/** A valid-looking item (a bad one must never break the list). */
export function isInboxItem(x: unknown): x is InboxItem {
  const i = x as InboxItem;
  return !!i && Number.isSafeInteger(i.id) && Number.isFinite(i.at) && typeof i.title === "string" && typeof i.link === "string" && typeof i.read === "boolean";
}
/** The valid items of a reply (followUp missing, e.g. from a server mid-deploy: not flagged). */
const cleanItems = (xs: unknown): InboxItem[] => (Array.isArray(xs) ? xs.filter(isInboxItem).map((i) => ({ ...i, followUp: i.followUp === true })) : []);


export interface InboxState {
  unread: number; mode: InboxMode;
  /** How many items are flagged to follow up (the whole inbox, whatever the filter). */ followUp: number;
  filter: InboxFilter;
  items: InboxItem[]; loaded: boolean; loading: boolean; error: ApiError | null; more: boolean; loadingOlder: boolean;
  /** Fetch the newest page. */ load: () => void;
  /** The panel opening: the newest page, and items unflagged in the Follow up view are let go. */ open: () => void;
  setFilter: (f: InboxFilter) => void;
  loadOlder: () => void;
  markRead: (ids: number[]) => void;
  markUnread: (ids: number[]) => void;
  setFollowUp: (ids: number[], on: boolean) => void;
  markAllRead: () => void;
}

/**
 * The inbox of the signed-in account (`userId`; null: signed out, nothing runs).
 *
 * Every refresh replaces the list with the newest page (older pages loaded with "Load older" go: their read
 * state can't be refreshed with it). Replies are applied in order: each refresh or read change takes a number,
 * and a refresh's reply is used only when no newer one of those started after it, so a slow snapshot can never
 * bring back items or unread state a later one replaced. An older page never cancels a refresh: its reply is
 * dropped instead when the list changed after it was asked for.
 *
 * Filter "followUp" lists flagged items only. An item toggled in that view stays on screen (so it can be flagged
 * again and focus isn't lost) until the filter changes or the panel opens again: the view asks the server for those
 * rows too (keep=), and refreshes the whole range it has loaded, so every row it shows has the server's state.
 *
 * While a read or follow-up write is queued, refreshes wait (a snapshot from before it would undo it on screen, and
 * the next toggle would be decided from that stale state); the list is fetched once the last write is in.
 */
export function useInbox(userId: number | null): InboxState {
  const visible = useVisible();
  const [unread, setUnread] = useState(0);
  const [followUp, setFollowUpCount] = useState(0);
  const [filter, setFilterState] = useState<InboxFilter>("all");
  const [mode, setMode] = useState<InboxMode>("off");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // One generation per account: a reply for an earlier one (signed out, or someone else signed in) changes nothing.
  const gen = useRef(0);
  // The latest refresh or read change; and the latest older-page request (its own count).
  const seq = useRef(0);
  const olderSeq = useRef(0);
  // Bumped whenever a refresh's page replaces the list: an older page asked for before that doesn't fit it.
  const listVersion = useRef(0);
  const loadedRef = useRef(false);
  const filterRef = useRef<InboxFilter>("all");
  // Toggled in the Follow up view: kept on screen (see above).
  const kept = useRef(new Set<number>());
  // Where "Load older" carries on from: the oldest id the server sent for this list.
  const cursor = useRef<number | null>(null);
  // Writes go one at a time, in the order they were made, so a quick flag then unflag ends unflagged.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const shown = useRef<InboxItem[]>([]);
  shown.current = items;
  // The Follow up view's extra queries: the toggled rows it keeps (the account's own, checked on the server), in
  // batches of 200 (the server's limit per request); none: one pass without.
  const keepBatches = (): string[] => {
    const ids = [...kept.current], out: string[] = [];
    for (let i = 0; i < ids.length; i += KEEP_BATCH) out.push(`&keep=${ids.slice(i, i + KEEP_BATCH).join(",")}`);
    return out.length ? out : [""];
  };

  const load = useCallback(() => {
    if (userId == null) return;
    if (!loadedRef.current) setLoading(true);
    if (pendingWrites.current > 0) return; // the last queued write refreshes once it's in
    const g = gen.current, s = ++seq.current, f = filterRef.current;
    const current = () => gen.current === g && seq.current === s && filterRef.current === f;
    // The Follow up view refreshes everything it shows (kept rows included): pages of up to 100, down to the oldest
    // row on screen when it starts; All, the newest page.
    const start = shown.current, startIds = new Set(start.map((i) => i.id)), floor = start.at(-1)?.id ?? null;
    // One pass over the range per batch of kept ids; the passes differ only in which kept rows they add, so their
    // union (by id) is the flagged rows plus every kept row.
    const pass = async (keep: string): Promise<InboxPage> => {
      const got: unknown[] = [];
      let before: number | null = null;
      for (;;) {
        const limit = Math.min(INBOX_PAGE_MAX, Math.max(INBOX_PAGE, start.length - got.length));
        const r: InboxPage = await apiFetch<InboxPage>(`/api/inbox?limit=${limit}&filter=followUp${keep}${before ? `&before=${before}` : ""}`);
        const page = Array.isArray(r?.items) ? r.items : [];
        got.push(...page);
        before = cleanItems(page).at(-1)?.id ?? null;
        // More pages only until the oldest row that was on screen is covered (a first load is one page).
        if (!r?.more || !before || floor == null || before <= floor || !current()) return { ...r, items: got as InboxItem[] };
      }
    };
    const range = async (): Promise<InboxPage> => {
      if (f !== "followUp") return apiFetch<InboxPage>(`/api/inbox?limit=${INBOX_PAGE}`);
      const byId = new Map<number, InboxItem>();
      let r: InboxPage | null = null, more = false;
      for (const keep of keepBatches()) {
        r = await pass(keep);
        more ||= !!r.more;
        for (const i of cleanItems(r.items)) byId.set(i.id, i);
        if (!current()) break;
      }
      return { ...r!, more, items: [...byId.values()].sort((a, b) => b.id - a.id) };
    };
    range()
      .then((r) => {
        if (!current()) return;
        listVersion.current++;
        const page = cleanItems(r.items);
        // An older page that landed while this refresh ran (Load older) is below its range and fresher than it: those
        // rows (only those: not ones that were already on screen) stay, and paging carries on after them.
        const last = page.at(-1)?.id;
        const below = f === "followUp" && r.more && last ? shown.current.filter((i) => i.id < last && !startIds.has(i.id)) : [];
        const next = [...page, ...below];
        cursor.current = next.at(-1)?.id ?? null;
        setItems(next);
        if (!below.length) setMore(!!r.more);
        if (Number.isFinite(r.unread)) setUnread(r.unread);
        if (Number.isFinite(r.followUp)) setFollowUpCount(r.followUp);
        loadedRef.current = true; setLoaded(true); setError(null);
      })
      .catch((e) => { if (current()) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load your notifications.")); })
      .finally(() => { if (current()) setLoading(false); });
  }, [userId]);

  // A new account (or signed out): start clean.
  useEffect(() => {
    gen.current++;
    setUnread(0); setFollowUpCount(0); setItems([]); setLoaded(false); setLoading(false); setError(null); setMore(false); setLoadingOlder(false);
    setFilterState("all"); filterRef.current = "all"; kept.current.clear(); cursor.current = null;
    writes.current = Promise.resolve(); pendingWrites.current = 0;
    loadedRef.current = false;
    // Unmounting, or the account changing: anything still queued or in flight belongs to the old one.
    return () => { gen.current++; };
  }, [userId]);

  const open = useCallback(() => { kept.current.clear(); load(); }, [load]);

  // Another filter: a new list (the old one's items don't belong in it).
  const setFilter = useCallback((f: InboxFilter) => {
    if (f === filterRef.current) return;
    filterRef.current = f; kept.current.clear();
    setFilterState(f);
    olderSeq.current++; setLoadingOlder(false);
    loadedRef.current = false; setLoaded(false); setItems([]); setMore(false); cursor.current = null;
    load();
  }, [load]);

  useEffect(() => {
    if (userId == null || !visible) { setMode("off"); return; }
    return followInbox((n) => {
      setUnread(n.unread);
      if (n.followUp != null) setFollowUpCount(n.followUp);
      // Something newer than the list has arrived, or read state changed elsewhere: the list follows (once it's been opened).
      if (loadedRef.current) load();
    }, setMode);
  }, [userId, visible, load]);

  const loadOlder = useCallback(() => {
    const oldest = cursor.current;
    if (userId == null || !oldest) return;
    const g = gen.current, s = seq.current, v = listVersion.current, o = ++olderSeq.current, f = filterRef.current;
    setLoadingOlder(true);
    apiFetch<InboxPage>(`/api/inbox?limit=${INBOX_PAGE}&before=${oldest}${f === "all" ? "" : `&filter=${f}`}`)
      .then((r) => {
        if (gen.current !== g || seq.current !== s || listVersion.current !== v || olderSeq.current !== o || filterRef.current !== f) return; // the list changed meanwhile: this page may not fit it
        const page = cleanItems(r.items);
        if (page.length) cursor.current = page.at(-1)!.id;
        // The server's copy wins for a row already shown.
        setItems((cur) => { const ids = new Set(page.map((i) => i.id)); return [...cur.filter((i) => !ids.has(i.id)), ...page].sort((a, b) => b.id - a.id); });
        setMore(!!r.more);
      })
      .catch((e) => { if (gen.current === g) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load older notifications.")); })
      .finally(() => { if (gen.current === g && olderSeq.current === o) setLoadingOlder(false); });
  }, [userId]);

  // A read or follow-up change: shown at once; any reply to a request started before it is ignored, and once the
  // server has it the list is fetched again (the server's state, with this change in it). Each write waits for the
  // one before it, so the server applies them in the order they were made.
  const send = useCallback((path: string, body: unknown) => {
    const g = gen.current;
    seq.current++;
    pendingWrites.current++;
    // A write still waiting when the account changes (or the bell goes away) is dropped, never sent with the next
    // account's cookie.
    const w = writes.current
      .then(() => (gen.current === g ? apiFetch<{ unread: number }>(path, { method: "POST", json: body }) : undefined))
      .catch(() => undefined)
      .then(() => { if (gen.current === g) pendingWrites.current = Math.max(0, pendingWrites.current - 1); })
      // The list is fetched once the last queued write is in (an earlier one's snapshot would undo the later change on screen).
      .then(() => { if (gen.current === g && writes.current === w) load(); });
    writes.current = w;
  }, [load]);

  const markRead = useCallback((ids: number[]) => {
    const fresh = items.filter((i) => ids.includes(i.id) && !i.read).map((i) => i.id);
    if (!fresh.length) return;
    setItems((cur) => cur.map((i) => (fresh.includes(i.id) ? { ...i, read: true } : i)));
    setUnread((u) => Math.max(0, u - fresh.length));
    send("/api/inbox/read", { ids: fresh });
  }, [items, send]);

  const markUnread = useCallback((ids: number[]) => {
    const was = items.filter((i) => ids.includes(i.id) && i.read).map((i) => i.id);
    if (!was.length) return;
    setItems((cur) => cur.map((i) => (was.includes(i.id) ? { ...i, read: false } : i)));
    setUnread((u) => u + was.length);
    send("/api/inbox/unread", { ids: was });
  }, [items, send]);

  const setFollowUp = useCallback((ids: number[], on: boolean) => {
    const change = items.filter((i) => ids.includes(i.id) && i.followUp !== on).map((i) => i.id);
    if (!change.length) return;
    if (filterRef.current === "followUp") for (const id of change) kept.current.add(id);
    setItems((cur) => cur.map((i) => (change.includes(i.id) ? { ...i, followUp: on } : i)));
    setFollowUpCount((n) => Math.max(0, n + (on ? change.length : -change.length)));
    send("/api/inbox/follow-up", { ids: change, on });
  }, [items, send]);

  // Every item, up to the newest seen (only offered on the All view: the Follow up view's newest isn't the inbox's).
  const markAllRead = useCallback(() => {
    setItems((cur) => cur.map((i) => (i.read ? i : { ...i, read: true })));
    setUnread(0);
    send("/api/inbox/read", { all: true, ...(items[0] ? { upTo: items[0].id } : {}) });
  }, [items, send]);

  return { unread, followUp, filter, mode, items, loaded, loading, error, more, loadingOlder, load, open, setFilter, loadOlder, markRead, markUnread, setFollowUp, markAllRead };
}
