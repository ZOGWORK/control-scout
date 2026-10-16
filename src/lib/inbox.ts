// The notification inbox on the device (docs/inbox.md): the bell's unread count and the list behind it.
// Read state lives on the server, so marking an item read on one device clears it on the others.
//
// Live: an EventSource on /api/inbox/stream (one per signed-in tab, across every workspace, open whether
// or not a scout space is) sends the unread count on connect and whenever an item arrives or read state
// changes anywhere. When it keeps failing, or the owner switched live updates off (503), or EventSource
// isn't there, the count is polled every 45 s while the tab is visible, and the stream is tried again
// every 2 minutes. Either way the count is fetched again when the tab comes back into focus, and the
// stream lets go after the tab has been hidden for a minute.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { INBOX_PAGE, type InboxItem, type InboxPage } from "../shared/inbox";

export type InboxMode = "off" | "connecting" | "live" | "polling";

export const INBOX_BACKOFF_MS = [2_000, 5_000, 15_000];
export const INBOX_POLL_MS = 45_000;
export const INBOX_STREAM_RETRY_MS = 120_000;
export const INBOX_HIDDEN_CLOSE_MS = 60_000;

export interface InboxNotice { unread: number; latest: number | null }

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
      onNotice({ unread: n.unread!, latest: Number.isSafeInteger(n.latest) ? n.latest! : null });
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

/**
 * The newest page on top of what's shown: within the page's range the page is the truth (fresher read
 * state, and an item the server replaced, such as a coalesced edit, is gone); older items loaded before stay.
 */
export function mergeInbox(current: InboxItem[], page: InboxItem[], more: boolean): InboxItem[] {
  if (!more || !page.length) return more ? current : page; // no more on the server: the page is all there is
  const floor = page.at(-1)!.id;
  return [...page, ...current.filter((i) => i.id < floor)];
}

export interface InboxState {
  unread: number; mode: InboxMode;
  items: InboxItem[]; loaded: boolean; loading: boolean; error: ApiError | null; more: boolean; loadingOlder: boolean;
  /** Fetch the newest page (the panel opening). */ load: () => void;
  loadOlder: () => void;
  markRead: (ids: number[]) => void;
  markAllRead: () => void;
}

/** The inbox of the signed-in account (`userId`; null: signed out, nothing runs). */
export function useInbox(userId: number | null): InboxState {
  const visible = useVisible();
  const [unread, setUnread] = useState(0);
  const [mode, setMode] = useState<InboxMode>("off");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // One generation per account: a reply for an earlier one (signed out, or someone else signed in) changes nothing.
  const gen = useRef(0);
  const loadedRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(() => {
    if (userId == null) return;
    const g = gen.current;
    if (!loadedRef.current) setLoading(true);
    apiFetch<InboxPage>(`/api/inbox?limit=${INBOX_PAGE}`)
      .then((r) => {
        if (gen.current !== g) return;
        const page = (r.items ?? []).filter(isInboxItem);
        // The newest page replaces what's shown when it doesn't reach it (a gap); otherwise it's merged on top.
        const gap = !loadedRef.current || (!!r.more && page.length > 0 && page.at(-1)!.id > (itemsRef.current[0]?.id ?? 0));
        if (gap || !r.more) setMore(!!r.more);
        setItems((cur) => (gap ? page : mergeInbox(cur, page, !!r.more)));
        if (Number.isFinite(r.unread)) setUnread(r.unread);
        loadedRef.current = true; setLoaded(true); setError(null);
      })
      .catch((e) => { if (gen.current === g) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load your notifications.")); })
      .finally(() => { if (gen.current === g) setLoading(false); });
  }, [userId]);

  // A new account (or signed out): start clean.
  useEffect(() => {
    gen.current++;
    setUnread(0); setItems([]); setLoaded(false); setLoading(false); setError(null); setMore(false); setLoadingOlder(false);
    loadedRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (userId == null || !visible) { setMode("off"); return; }
    return followInbox((n) => {
      setUnread(n.unread);
      // Something newer than the list has arrived, or read state changed elsewhere: the list follows (once it's been opened).
      if (loadedRef.current) load();
    }, setMode);
  }, [userId, visible, load]);

  const oldest = items.at(-1)?.id;
  const loadOlder = useCallback(() => {
    if (userId == null || !oldest) return;
    const g = gen.current;
    setLoadingOlder(true);
    apiFetch<InboxPage>(`/api/inbox?limit=${INBOX_PAGE}&before=${oldest}`)
      .then((r) => {
        if (gen.current !== g) return;
        const page = (r.items ?? []).filter(isInboxItem);
        setItems((cur) => { const ids = new Set(cur.map((i) => i.id)); return [...cur, ...page.filter((i) => !ids.has(i.id))]; });
        setMore(!!r.more);
      })
      .catch((e) => { if (gen.current === g) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load older notifications.")); })
      .finally(() => { if (gen.current === g) setLoadingOlder(false); });
  }, [userId, oldest]);

  const send = useCallback((body: unknown) => {
    const g = gen.current;
    apiFetch<{ unread: number }>("/api/inbox/read", { method: "POST", json: body })
      .then((r) => { if (gen.current === g && Number.isFinite(r.unread)) setUnread(r.unread); })
      .catch(() => { if (gen.current === g) load(); }); // the server's state wins: show it again
  }, [load]);

  const markRead = useCallback((ids: number[]) => {
    const fresh = items.filter((i) => ids.includes(i.id) && !i.read).map((i) => i.id);
    if (!fresh.length) return;
    setItems((cur) => cur.map((i) => (fresh.includes(i.id) ? { ...i, read: true } : i)));
    setUnread((u) => Math.max(0, u - fresh.length));
    send({ ids: fresh });
  }, [items, send]);

  const markAllRead = useCallback(() => {
    setItems((cur) => cur.map((i) => (i.read ? i : { ...i, read: true })));
    setUnread(0);
    send({ all: true, ...(items[0] ? { upTo: items[0].id } : {}) });
  }, [items, send]);

  return { unread, mode, items, loaded, loading, error, more, loadingOlder, load, loadOlder, markRead, markAllRead };
}
