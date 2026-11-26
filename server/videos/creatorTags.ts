// What a creator video is, read from its own words (./creatorVideos.ts): its series (from the channel's playlists, or
// its title), the program it is about (FTC, FRC, VEX or unknown), its FTC season, and the FTC teams it names. Tags go
// live with no one confirming them, so a team is tagged only on strong evidence:
//  - FTC videos only. An FRC or VEX video (or one that names more than one program) is never tagged, and a
//    VEX-style number ("24118E", "11V") is never read as a team.
//  - A number with a cue before it ("#12345", "Team 12345", "FTC 12345") that is a team active around the video's season.
//  - A bare number only with the team's own name right beside it ("21229 Quality Control"), so years, scores and
//    counts never become tags.
//  - A name with no number only when a whole title part is exactly one active team's full name.
// Pure: the team look-ups come in as functions (the server's from the names index, tests' from fixtures).
import { SEASONS } from "../../src/shared/seasonList.js";
import { fold, joinDotted } from "../../src/shared/query/names.js";
import type { CreatorProgram, CreatorSeries } from "../../src/shared/creatorVideos.js";

/** The series a playlist or title part names, most specific first. "Behind the Bumpers" (FRC) is not Behind the Bot. */
const SERIES_RULES: [CreatorSeries, RegExp][] = [
  ["behind-the-bot", /\bbehind the bot\b/i],
  ["pits-and-parts", /\bpits?\s*(?:&|and|n)\s*parts\b/i],
  ["top-25", /\btop\s*25\b/i],
  ["funalysis", /\bfunalysis\b/i],
];

/** The series a video is in: the first its playlists name (in SERIES_RULES order), else the first its title names. */
export function seriesOf(title: string, playlistTitles: readonly string[]): CreatorSeries | null {
  for (const [s, re] of SERIES_RULES) if (playlistTitles.some((t) => re.test(t))) return s;
  for (const [s, re] of SERIES_RULES) if (re.test(title)) return s;
  return null;
}

const FTC_GAMES = SEASONS.map((s) => s.game);
const words = (list: readonly string[]) => list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
const FTC_RE = new RegExp(`\\bFTC\\b|\\bFIRST Tech Challenge\\b|\\bBehind the Bot\\b|\\b(?:${words(FTC_GAMES)})\\b`, "i");
const FRC_RE = /\bFRC\b|\bFIRST Robotics Competition\b|\bBehind the Bumpers\b|\b(?:REBUILT|REEFSCAPE|CRESCENDO|CHARGED UP|RAPID REACT|INFINITE RECHARGE)\b/i;
/** VEX's programs and games, and a VEX team number (two digits or more and a letter: "98601S", "11V"; "3D" is not one). */
const VEX_RE = /\bVEX\b|\bV5RC\b|\bVRC\b|\bVIQR?C\b|\bVEX\s?U\b|\bRECF\b|\b(?:High Stakes|Over Under|Spin Up|Push Back)\b|(?<![\w#])\d{2,5}[A-Z](?![\w])/;
/** Not a robotics program Scout covers: drones, combat robots, FIRST LEGO League. */
const OTHER_RE = /\bdrones?\b|\bcombat robots?\b|\b(?:beetle|ant|feather|hobby)weight\b|\bbattle ?bots?\b|\bFLL\b|\bFIRST LEGO League\b/i;

function signals(text: string): Set<CreatorProgram> {
  const out = new Set<CreatorProgram>();
  if (FTC_RE.test(text)) out.add("ftc");
  if (FRC_RE.test(text)) out.add("frc");
  if (VEX_RE.test(text)) out.add("vex");
  if (OTHER_RE.test(text)) out.add("unknown");
  return out;
}
/** One program, when the text names exactly one (anything else: none). */
const one = (s: Set<CreatorProgram>): CreatorProgram | null => (s.size === 1 ? [...s][0] : null);

/**
 * The program a video is about: its title's, when the title names one (or "unknown" when it names more than one or
 * something else); else its series playlist's, then its other playlists'; else its description's. Unknown otherwise.
 */
export function programOf(title: string, description: string, playlistTitles: readonly string[], seriesPlaylistTitles: readonly string[] = []): CreatorProgram {
  const t = signals(title);
  if (t.size) return one(t) ?? "unknown";
  for (const list of [seriesPlaylistTitles, playlistTitles]) {
    const p = new Set<CreatorProgram>();
    for (const x of list) for (const s of signals(x)) p.add(s);
    if (p.size) return one(p) ?? "unknown";
  }
  // The description only when it names one program, by name or hashtag (#ftc, #frc).
  const d = signals(description.replace(/#(ftc|frc|vex)\w*/gi, " $1 "));
  return one(d) ?? "unknown";
}

/** Its FTC season: the season whose game the title (then the description) names, else the season its date falls in
 *  (FTC's seasons start in September). */
export function seasonOf(title: string, description: string, publishedAt: string): number | null {
  for (const text of [title, description]) {
    for (const s of [...SEASONS].sort((a, b) => b.game.length - a.game.length)) {
      if (new RegExp(`\\b${words([s.game])}\\b`, "i").test(text)) return s.season;
    }
  }
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export interface TagLookups {
  /** The team's stored name (undefined: no such team). */
  team(n: number): { name: string | null } | undefined;
  /** Whether the team was registered or played within a season of this one. */
  active(n: number, season: number | null): boolean;
  /** The teams whose whole name is these folded words (the search pipeline's names index). */
  named(folded: string): number[];
}

export type TagRule = "title:cue" | "title:bare-name" | "title:name" | "description:cue" | "description:bare-name";
export interface Tag { team: number; rule: TagRule }

/** The ways a team's name is written beside its number: as stored, dotted initials as a word ("I.C.E." → "ice"),
 *  and with "The …", "… Robotics" or trailing digits ("CYBERMOON093") dropped. Three letters at least. */
export function nameForms(name: string | null): string[] {
  if (!name) return [];
  const out = new Set<string>();
  for (const base of [fold(name), fold(joinDotted(name))]) {
    if (!base) continue;
    out.add(base);
    const core = base.replace(/^the /, "").replace(/ (?:robotics|team)$/, "").replace(/^team /, "").replace(/(?<=[a-z])\d+$/, "").trim();
    if (core) out.add(core);
  }
  return [...out].filter((f) => f.replace(/[^a-z]/g, "").length >= 3);
}

/** Where a title or description part ends: its separators. */
const PART_END = /[|•·\n()[\]{}]|\s[-–—]\s/;

/** Whether the words right after a number (up to the part's end) start with one of these forms of the team's name. */
function nameAfter(after: string, forms: string[]): boolean {
  const f = fold(after.split(PART_END)[0]);
  return forms.some((v) => f === v || f.startsWith(`${v} `));
}
/** Whether the words right before a number (back to the part's start) end with one of them. */
function nameBefore(before: string, forms: string[]): boolean {
  const parts = before.replace(/[\s(#:,–—-]+$/u, "").split(PART_END);
  const f = fold(parts[parts.length - 1] ?? "");
  return forms.some((v) => f === v || f.endsWith(` ${v}`));
}

/** Words that say what a title part is (the series, the program, a season's game): never a team's name. */
const NOT_A_NAME = new RegExp(`\\b(?:FTC|FRC|VEX|FIRST|robot|snapshot|interview|winners?|reveal|ri3d|${words(FTC_GAMES)})\\b|${SERIES_RULES.map(([, re]) => re.source).join("|")}`, "i");

const CUE = /(?:#|\bteam\s*(?:no\.?|number)?\s*#?|\bftc\s*(?:team\s*)?#?)\s*$/i;
const isYear = (n: number) => n >= 1990 && n <= 2035;

/** The tags in one text (the title or the description). */
function scan(text: string, where: "title" | "description", season: number | null, look: TagLookups, out: Map<number, TagRule>): void {
  const re = /\d{1,5}/g;
  for (let m; (m = re.exec(text));) {
    const i = m.index, j = i + m[0].length;
    const prev = text[i - 1] ?? "", next = text[j] ?? "";
    // Part of a longer word or number: "A301", "V5RC", "24118E", "11V", "2nd", "123456", "3,000", "4.5", "1:30", "60%".
    if (/[\p{L}\p{N}_]/u.test(prev) || /[\p{L}\p{N}_]/u.test(next)) continue;
    if (/[$€£]/.test(prev) || ([",", ".", ":", "/"].includes(prev) && /\d/.test(text[i - 2] ?? ""))) continue;
    if (next === "%" || ([",", ".", ":", "/"].includes(next) && /\d/.test(text[j + 1] ?? ""))) continue;
    const n = Number(m[0]);
    if (!n || out.has(n)) continue;
    const t = look.team(n);
    if (!t || !look.active(n, season)) continue;
    const before = text.slice(Math.max(0, i - 16), i);
    const cue = CUE.exec(before);
    // A cue counts for a number that can't be a year or a ranking ("#1", "#25"): those need the name, like a bare one.
    if (cue && !isYear(n) && !(cue[0].trim().startsWith("#") && n < 100)) { out.set(n, `${where}:cue`); continue; }
    const forms = nameForms(t.name);
    if (forms.length && (nameAfter(text.slice(j), forms) || nameBefore(text.slice(0, i), forms))) out.set(n, `${where}:bare-name`);
  }
}

/**
 * The FTC teams a video names, with the rule each was found by (a title's first). None for a video that isn't FTC's.
 */
export function tagsOf(v: { title: string; description: string | null; program: CreatorProgram; season: number | null }, look: TagLookups): Tag[] {
  if (v.program !== "ftc") return [];
  const out = new Map<number, TagRule>();
  scan(v.title, "title", v.season, look, out);
  // A title part that is one active team's whole name, and nothing else.
  for (const part of v.title.split(/\s*[|•·]\s*|\s[-–—]\s/)) {
    const p = part.trim();
    if (!p || /\d/.test(p) || NOT_A_NAME.test(p)) continue;
    const f = fold(p);
    if (f.replace(/[^a-z]/g, "").length < 5) continue;
    const teams = look.named(f);
    if (teams.length === 1 && !out.has(teams[0]) && look.active(teams[0], v.season)) out.set(teams[0], "title:name");
  }
  const fromTitle = new Set(out.keys());
  if (v.description) {
    const d = new Map<number, TagRule>();
    scan(v.description, "description", v.season, look, d);
    for (const [n, r] of d) if (!fromTitle.has(n)) out.set(n, r);
  }
  return [...out].map(([team, rule]) => ({ team, rule })).sort((a, b) => a.team - b.team);
}
