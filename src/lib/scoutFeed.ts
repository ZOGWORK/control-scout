// The Scout page's feed (Task 17): the space's entries on this device, filtered and sorted by what the
// URL says (src/shared/scoutFilter.ts: the same predicate the CSV export applies on the server), and
// the picks the filter bar offers, taken from the entries themselves.
import { useCallback, useMemo } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { compareMatchLabels, ENTRY_FILTER_PARAMS, entryMatches, filtersFromSearch, parseEntryFilters, sortEntries, sortFromSearch, upperAscii, type EntryFilterParam, type EntrySort } from "../shared/scoutFilter";
import type { FilterOptions } from "../components/scout/EntryFilterBar";
import type { ScoutEntry } from "./scouting";

/** You, as a workspace member: whose not-yet-synced entries are yours (the server stamps the author on sync). */
export interface FeedViewer { accountId: number; displayName: string }

/**
 * A workspace entry as the predicate reads it: one this device made and hasn't synced yet has no author
 * stamped (0, ""), and is yours, so the author filter and the search find it as the server will.
 */
export function asAuthored(e: ScoutEntry, me: FeedViewer | null): ScoutEntry {
  if (!me || e.workspaceId == null || e.authorAccountId) return e;
  return { ...e, authorAccountId: me.accountId, authorDisplayName: e.authorDisplayName || me.displayName };
}

/** The filter bar's picks: the teams, events, authors and match labels the entries have. */
export function feedOptions(entries: readonly ScoutEntry[], withAuthors: boolean, me: FeedViewer | null, eventNames?: ReadonlyMap<string, string>): FilterOptions {
  const teams = [...new Set(entries.map((e) => e.team))].sort((a, b) => a - b);
  // Each option is the value as the predicate compares it (upperAscii), and only one that picking it finds again
  // (a label with a comma or stray spaces can't be a filter value, so it isn't offered).
  const values = (param: "event" | "match", raw: (string | null)[]) => [...new Set(raw.filter((v): v is string => !!v).map(upperAscii))]
    .filter((v) => { const r = parseEntryFilters({ [param]: v }); return r.ok && r.filters[param]?.length === 1 && r.filters[param]![0] === v; });
  const codes = values("event", entries.map((e) => e.eventCode)).sort();
  const matches = values("match", entries.map((e) => e.matchLabel)).sort(compareMatchLabels);
  let authors: FilterOptions["authors"] = null;
  if (withAuthors) {
    // The newest name each author has gone by (entries come newest first).
    const names = new Map<number, string>();
    for (const e of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!e.authorAccountId) continue;
      if (!names.has(e.authorAccountId) || !names.get(e.authorAccountId)) names.set(e.authorAccountId, e.authorDisplayName);
    }
    authors = [...names].map(([id, name]) => ({ id, name: (name || "A member") + (me && id === me.accountId ? " (you)" : "") }))
      .sort((a, b) => Number(b.id === me?.accountId) - Number(a.id === me?.accountId) || a.name.localeCompare(b.name));
  }
  return { teams, events: codes.map((code) => ({ code, name: eventNames?.get(code) })), authors, matches };
}

/** The feed: filters and sort from the URL, applied to the space's entries, with setters that write the URL. */
export function useEntryFeed(entries: readonly ScoutEntry[], sp: URLSearchParams, setSp: SetURLSearchParams, opts: { workspace: boolean; me: FeedViewer | null; eventNames?: ReadonlyMap<string, string> }) {
  const { filters, invalid } = useMemo(() => filtersFromSearch(sp), [sp]);
  // Personal has no author filter: every entry is yours.
  const applied = useMemo(() => (opts.workspace ? filters : { ...filters, author: undefined }), [filters, opts.workspace]);
  const sort = sortFromSearch(sp);
  const { me } = opts;
  const authored = useMemo(() => entries.map((e) => asAuthored(e, me)), [entries, me]);
  const shown = useMemo(() => sortEntries(authored.filter((e) => entryMatches(e, applied)), sort), [authored, applied, sort]);
  const options = useMemo(() => feedOptions(authored, opts.workspace, me, opts.eventNames), [authored, opts.workspace, me, opts.eventNames]);
  const setFilter = useCallback((param: EntryFilterParam, value: string | null) => setSp((x) => {
    if (value == null || value === "") x.delete(param); else x.set(param, value);
    return x;
  }, { replace: true }), [setSp]);
  const setSort = useCallback((s: EntrySort) => setSp((x) => { if (s === "newest") x.delete("sort"); else x.set("sort", s); return x; }, { replace: true }), [setSp]);
  const clear = useCallback(() => setSp((x) => { for (const k of ENTRY_FILTER_PARAMS) x.delete(k); return x; }, { replace: true }), [setSp]);
  return { filters: applied, invalid, sort, shown, options, setFilter, setSort, clear, query: sp.get("q") ?? "" };
}
