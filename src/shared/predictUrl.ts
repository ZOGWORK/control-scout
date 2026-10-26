// Predict's URL, read and written in one place. Three modes, each with its own params:
//   advancement  ?mode=advancement&season=2025&code=USNJQ1&team=4215
//   scheduled    ?mode=scheduled&for=team:4215   (or for=event:2025:USNJQ1), season only with a team
//   match        ?mode=match&season=2025&red=1,2&blue=3,4
// Older links (?view=events|lab, a bare code or red/blue, a lab link carrying for=) still open the
// right mode with the right picks; `canonicalPredict` rewrites them to the form above.

export type PredictMode = "advancement" | "scheduled" | "match";
export const PREDICT_MODES: PredictMode[] = ["advancement", "scheduled", "match"];

/** Scheduled's pick: a team, or an event of a season. */
export type PredictPick = { kind: "team"; team: number } | { kind: "event"; season: number; code: string } | null;

export interface PredictState {
  mode: PredictMode;
  /** The season asked for (null: the page's default). */
  season: number | null;
  /** Advancement's event and team. */
  code: string | null;
  team: number | null;
  /** Scheduled's team or event. */
  pick: PredictPick;
  /** Custom matchup's teams, as typed (numbers when valid). */
  red: readonly number[];
  blue: readonly number[];
}

export function parsePick(v: string | null): PredictPick {
  const [k, a, b] = (v ?? "").split(":");
  if (k === "team" && /^\d+$/.test(a ?? "") && Number(a) > 0) return { kind: "team", team: Number(a) };
  if (k === "event" && /^\d{4}$/.test(a ?? "") && b) return { kind: "event", season: Number(a), code: b.toUpperCase() };
  return null;
}
export const pickParam = (p: PredictPick) => (!p ? null : p.kind === "team" ? `team:${p.team}` : `event:${p.season}:${p.code}`);

const int = (v: string | null) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);
const teams = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x) && Number(x) > 0).map(Number).slice(0, 2);

/** Which mode a URL opens: an explicit mode, then the old view switch, then whatever the link carries. */
export function modeOf(sp: URLSearchParams): PredictMode {
  const mode = sp.get("mode");
  // Old links: view= picked Events or the Lab, and mode= was the Lab's own tab, remembered while on Events.
  const view = sp.get("view");
  if (view === "events") return "scheduled";
  if (view === "lab") return mode === "match" || (!mode && (sp.get("red") || sp.get("blue"))) ? "match" : "advancement";
  if (mode === "advancement" || mode === "scheduled" || mode === "match") return mode;
  if (sp.get("red") || sp.get("blue")) return "match";
  if (sp.get("code")) return "advancement";
  if (view !== "lab" && sp.get("for")) return "scheduled";
  return "advancement";
}

export function readPredict(sp: URLSearchParams): PredictState {
  const mode = modeOf(sp);
  const pick = parsePick(sp.get("for"));
  let season = int(sp.get("season"));
  let code = sp.get("code")?.trim().toUpperCase() || null;
  let team = int(sp.get("team"));
  // A lab link that came through Scheduled carries its team or event as for=: keep it rather than drop it.
  if (mode === "advancement") {
    if (!team && pick?.kind === "team") team = pick.team;
    if (!code && pick?.kind === "event") { code = pick.code; season ??= pick.season; }
  }
  // Scheduled's pick, or the team a link carried for another mode.
  const schedPick: PredictPick = pick ?? (team ? { kind: "team", team } : null);
  if (mode === "scheduled" && schedPick?.kind === "event") season = schedPick.season;
  return { mode, season, code, team, pick: mode === "scheduled" ? schedPick : pick, red: teams(sp.get("red")), blue: teams(sp.get("blue")) };
}

/** The params one mode's state writes: nothing from another mode, nothing empty. */
export function predictParams(s: Partial<PredictState> & { mode: PredictMode }): URLSearchParams {
  const out = new URLSearchParams();
  out.set("mode", s.mode);
  const set = (k: string, v: string | number | null | undefined) => { if (v != null && v !== "") out.set(k, String(v)); };
  if (s.mode === "advancement") { set("season", s.season); set("code", s.code); set("team", s.team); }
  else if (s.mode === "scheduled") {
    set("for", pickParam(s.pick ?? null));
    // An event's season is in its pick; a team's season is its own param.
    if (s.pick?.kind !== "event") set("season", s.season);
  } else { set("season", s.season); set("red", s.red?.join(",")); set("blue", s.blue?.join(",")); }
  return out;
}

export const predictHref = (s: Partial<PredictState> & { mode: PredictMode }) => `/predict?${predictParams(s).toString().replace(/%2C/g, ",").replace(/%3A/g, ":")}`;

/** The canonical params for a URL, or null when it already is canonical (so the page only rewrites old links). */
export function canonicalPredict(sp: URLSearchParams): URLSearchParams | null {
  const next = predictParams(readPredict(sp));
  // Params the page doesn't own (utm_*, ref) ride along untouched.
  for (const [k, v] of sp) if (!["mode", "view", "season", "code", "team", "for", "red", "blue"].includes(k)) next.append(k, v);
  return next.toString() === sp.toString() ? null : next;
}

/**
 * Switching modes: carry the team across where it means the same thing, and drop the rest.
 * Advancement's team → Scheduled's team; Scheduled's team or event → Advancement's team or event;
 * a team into a fresh matchup as red's first robot.
 */
export function switchMode(s: PredictState, to: PredictMode): Partial<PredictState> & { mode: PredictMode } {
  const team = s.mode === "scheduled" ? (s.pick?.kind === "team" ? s.pick.team : null) : s.mode === "advancement" ? s.team : null;
  if (to === "advancement") {
    if (s.mode === "scheduled" && s.pick?.kind === "event") return { mode: to, season: s.pick.season, code: s.pick.code };
    return { mode: to, season: s.season, team };
  }
  if (to === "scheduled") return { mode: to, pick: team ? { kind: "team", team } : s.mode === "advancement" && s.code && s.season ? { kind: "event", season: s.season, code: s.code } : null, season: team ? s.season : null };
  return { mode: to, season: s.season, red: s.mode === "match" ? s.red : team ? [team] : [], blue: s.mode === "match" ? s.blue : [] };
}
