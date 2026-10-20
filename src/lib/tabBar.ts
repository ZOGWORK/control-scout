// The phone's bottom tab bar: which pages it holds, in what order. Everything else (and these too) is in the
// menu the top-left button opens. People pick their own in Settings › Appearance; the choice is kept on this
// device (it's about this phone's screen, not the account). Pure rules below, tested in tabBar.test.ts.
import { useSyncExternalStore } from "react";
import { BookOpen, Bookmark, CalendarDays, ClipboardList, House, ListOrdered, Scale, Settings, Sparkles, Star, Trophy, Users, type LucideIcon } from "lucide-react";

export type TabId = "home" | "events" | "teams" | "rankings" | "powerRankings" | "predict" | "compare" | "myTeam" | "shortlist" | "scout" | "methodology" | "settings";

export interface TabDef { id: TabId; to: string; label: string; icon: LucideIcon; end?: boolean }

/** Every page that can sit in the bar, in the menu's order. "myTeam" opens My team / My teams (src/lib/yoursRow.ts). */
export const TAB_OPTIONS: TabDef[] = [
  { id: "home", to: "/", label: "Home", icon: House, end: true },
  { id: "events", to: "/events", label: "Events", icon: CalendarDays },
  { id: "teams", to: "/teams", label: "Teams", icon: Users },
  { id: "rankings", to: "/rankings", label: "Rankings", icon: ListOrdered },
  { id: "powerRankings", to: "/power-rankings", label: "Power", icon: Trophy },
  { id: "predict", to: "/predict", label: "Predict", icon: Sparkles, end: true },
  { id: "compare", to: "/compare", label: "Compare", icon: Scale },
  { id: "myTeam", to: "/my-team", label: "My team", icon: Star },
  { id: "shortlist", to: "/shortlist", label: "Shortlist", icon: Bookmark },
  { id: "scout", to: "/scout", label: "Scout", icon: ClipboardList },
  { id: "methodology", to: "/methodology", label: "How it works", icon: BookOpen },
  { id: "settings", to: "/settings", label: "Settings", icon: Settings },
];

export const DEFAULT_TABS: TabId[] = ["home", "events", "predict", "myTeam", "scout"];
/** Five fit a 320 px phone with readable labels; two is the least that's still a bar. */
export const MAX_TABS = 5;
export const MIN_TABS = 2;
export const TAB_KEY = "cs-tab-bar";

const BY_ID = new Map(TAB_OPTIONS.map((t) => [t.id, t]));
export const tabDef = (id: TabId) => BY_ID.get(id)!;

/** A stored choice → a usable one: known ids, each once, at most MAX_TABS; fewer than MIN_TABS (or anything unreadable) is the default. */
export function normalizeTabs(raw: unknown): TabId[] {
  if (!Array.isArray(raw)) return DEFAULT_TABS;
  const out: TabId[] = [];
  for (const x of raw) if (typeof x === "string" && BY_ID.has(x as TabId) && !out.includes(x as TabId) && out.length < MAX_TABS) out.push(x as TabId);
  return out.length >= MIN_TABS ? out : DEFAULT_TABS;
}

/** Turn a page on or off in the bar (added at the end; refused past MAX_TABS or below MIN_TABS). */
export function toggleTab(tabs: TabId[], id: TabId): TabId[] {
  if (tabs.includes(id)) return tabs.length > MIN_TABS ? tabs.filter((t) => t !== id) : tabs;
  return tabs.length < MAX_TABS ? [...tabs, id] : tabs;
}

/** Move a page one place left (-1) or right (+1). */
export function moveTab(tabs: TabId[], id: TabId, by: -1 | 1): TabId[] {
  const i = tabs.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= tabs.length) return tabs;
  const next = [...tabs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------------------------------------------------------------------------
// This device's choice: localStorage (a private window or blocked storage just gets the default), and every
// open tab of the app follows a change at once.
// ---------------------------------------------------------------------------

const CHANGED = "cs-tab-bar-changed";
let cached: { raw: string | null; tabs: TabId[] } | null = null;

function read(): TabId[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(TAB_KEY); } catch { /* storage blocked */ }
  if (cached && cached.raw === raw) return cached.tabs;
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* damaged: the default */ }
  cached = { raw, tabs: normalizeTabs(parsed) };
  return cached.tabs;
}

export function saveTabs(tabs: TabId[]): void {
  const v = normalizeTabs(tabs);
  try {
    if (v.join() === DEFAULT_TABS.join()) localStorage.removeItem(TAB_KEY);
    else localStorage.setItem(TAB_KEY, JSON.stringify(v));
  } catch { /* storage blocked: this visit only */ cached = { raw: null, tabs: v }; }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === TAB_KEY || e.key === null) fn(); };
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener("storage", onStorage); };
}

/** The bar's pages on this device. */
export function useTabBar(): TabId[] {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_TABS);
}
