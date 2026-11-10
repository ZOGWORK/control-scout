// How every /search answer card's numbers read. Colour is the first signal (the owner's brief, 11-06, over the search
// results guide's "hue means team"): one palette for every card (lib/textTones SEARCH_PALETTE), each meaning its own
// colour (a phase, an award, a status), and whatever has no meaning of its own in the card's team hue. A rank is a pill
// in the team hue (filled on the top three), an award a filled chip in its kind's colour, an OPR a bar in the team hue.
// Alliance red and blue stay where they mark an alliance. A cell that isn't in a known shape stays plain text.
import { useId, useState, type ReactNode } from "react";
import { recordWords } from "../../../shared/format";
import { Award, Info, Medal, Trophy } from "lucide-react";
import { PODIUM_CHIP, SEARCH_PALETTE, meaningOf } from "../../../lib/textTones";
import { eventTypeLabel } from "../../../shared/labels";
import { Badge } from "../../ui/basic";
import { Meter } from "../../StatTile";
import { cn } from "../../cn";

/** The touch rule every search control keeps: at least 44px each way on phones and touch screens (a link in running
 *  text is exempt, WCAG 2.5.8). */
export const TAP = "max-md:min-h-[44px] max-md:min-w-[44px] pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]";

/** The places that get a medal: the top three, filled in the team hue. */
export const PODIUM: Record<number, true> = { 1: true, 2: true, 3: true };

/** The card's team hue (team A, the colour a team has wherever search compares it) on whatever has no meaning of its
 *  own: its numbers, bars and marks. No data visual is grey (the owner, 11-06). */
export const TEAM_BAR = "bg-team-a";
export const TEAM_TEXT = "text-team-a";
/** A data bar with no meaning of its own (a table's OPR, a rate): the team hue. */
export const INK_BAR = TEAM_BAR;
/** The team hue as a palette swatch (the same keys as SEARCH_PALETTE's), and teams B and C's. */
export const TEAM_SWATCH = [
  { fill: "bg-team-a text-background", text: TEAM_TEXT, bar: TEAM_BAR, edge: "border-l-team-a", tint: "bg-team-a/10", stroke: "stroke-team-a" },
  { fill: "bg-team-b text-background", text: "text-team-b-text", bar: "bg-team-b", edge: "border-l-team-b", tint: "bg-team-b/10", stroke: "stroke-team-b" },
  { fill: "bg-team-c text-background", text: "text-team-c-text", bar: "bg-team-c", edge: "border-l-team-c", tint: "bg-team-c/10", stroke: "stroke-team-c" },
] as const;
export type Swatch = { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string };
/** A label's colour: its meaning's (an award, a phase, a status), else team `i`'s hue. */
export function swatchOf(label: string | null | undefined, i = 0): Swatch {
  const m = label ? meaningOf(label) : null;
  return m ? SEARCH_PALETTE[m] : TEAM_SWATCH[Math.max(0, Math.min(2, i))];
}

// One team's tiles in a row (an average, a trend, a highest, a lowest): each its own colour, never the team's blue
// on every tile (the owner, 11-09: "falling should be red… make all groups unique in color"). A trend says its
// direction (rising green, falling red, steady slate); a highest, lowest and average keep one colour wherever they
// show; anything else takes the next colour no other tile in the row has. No sky, cyan, blue or amber: too like the
// team's hue or each other on one card (answerAudit ALIKE).
const P = SEARCH_PALETTE;
const KPI_KINDS: [RegExp, Swatch][] = [
  [/high|best|max|\btop\b|most/i, P.endgame],
  [/low|worst|\bmin|fewest|least/i, P.winning],
  [/average|\bavg\b|mean|typical/i, TEAM_SWATCH[0]],
];
const KPI_ROTATION: Swatch[] = [TEAM_SWATCH[0], P.endgame, P.winning, P.inspire, P.performance, P.judged, P.finalist, P.finished];
const familyOf = (s: Swatch) => s.bar.split(" ")[0].replace(/^bg-/, "").replace(/-\d+$/, "");
/** A row of one team's tiles, each its colour: its meaning's (a phase, an award), its tone's (a trend: good green,
 *  bad red, else slate), its kind's (highest, lowest, average), else the next colour no tile in the row has yet. */
export function kpiSwatches(items: { label: string; value?: unknown; tone?: string }[]): Swatch[] {
  const fixed = items.map((k): Swatch | null => {
    const m = meaningOf(k.label);
    if (m) return P[m];
    if (k.tone === "good") return P.yes;
    if (k.tone === "bad") return P.pen;
    if (/trend|direction/i.test(k.label) || /^steady$/i.test(String(k.value ?? ""))) return P.no;
    return KPI_KINDS.find(([re]) => re.test(k.label))?.[1] ?? null;
  });
  const used = new Set<string>();
  // A kind's colour only once: a second "best" tile in a row takes the rotation's next.
  const out = fixed.map((s) => { if (!s || used.has(familyOf(s))) return null; used.add(familyOf(s)); return s; });
  return out.map((s) => {
    if (s) return s;
    const next = KPI_ROTATION.find((r) => !used.has(familyOf(r))) ?? TEAM_SWATCH[0];
    used.add(familyOf(next));
    return next;
  });
}

/** An award as a filled chip in its kind's colour (Inspire, Winning or Finalist Alliance, a judged award), its name on it. */
export function AwardChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-start gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold", SEARCH_PALETTE[meaningOf(name) ?? "judged"].fill, className)} data-award={meaningOf(name) ?? "judged"}>
      <Award className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>{name}</span>
    </span>
  );
}

const RANK = /^(Ranked\s+)?#?(\d[\d,]*)(?:\s+of\s+(\d[\d,]*))?(.*)$/;
const RECORD = /^(\d{1,4})-(\d{1,4})-(\d{1,4})(.*)$/;
const n = (s: string) => Number(s.replace(/,/g, ""));

/** "#6 of 24", "Ranked #1 of 21", "#12 of 300 (top 4%)" or a bare rank: a pill, a medal on the top three. */
export function RankPill({ text, className }: { text: string; className?: string }) {
  const m = RANK.exec(text.trim());
  if (!m) return <>{text}</>;
  const rank = n(m[2]);
  const tone = PODIUM[rank];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)} data-rank={rank}>
      {m[1] && <span className="text-muted-foreground">Ranked</span>}
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums leading-none", tone ? PODIUM_CHIP[rank] : "bg-team-a/15 text-foreground")} data-rank-pill>
        {tone && <Medal className="size-3" aria-hidden />}#{rank.toLocaleString()}
        {/* No fade: on the filled podium pill a faded count fell under 4.5:1. */}
        {m[3] && <span className="font-medium">{` of ${n(m[3]).toLocaleString()}`}</span>}
      </span>
      {m[4].trim() && <span className="text-xs text-muted-foreground">{m[4].trim()}</span>}
    </span>
  );
}

/** "5-3-0" with the wins in bold (no win or loss hue: red and blue are alliances); anything after it muted. */
/** `win`: the wins' colour (ink, or one team's hue on its own card). */
export function RecordText({ text, className, win = "text-foreground" }: { text: string; className?: string; win?: string }) {
  const m = RECORD.exec(text.trim());
  if (!m) return <>{text}</>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} aria-label={`${recordWords(m[1], m[2], m[3])}${m[4]}`} data-record-text>
      <span aria-hidden><b className={cn("font-semibold", win)}>{m[1]}</b><span className="text-muted-foreground">-{m[2]}-{m[3]}</span></span>
      {m[4] && <span aria-hidden className="text-muted-foreground">{m[4]}</span>}
    </span>
  );
}

/** A won, lost or tied result as a chip: a win filled green, a loss red, a tie slate (the owner, 11-09: colour each
 *  group); the letter says it too. */
export function ResultChip({ text }: { text: string }) {
  const r = /^w/i.test(text) ? "W" : /^l/i.test(text) ? "L" : /^t/i.test(text) ? "T" : null;
  if (!r) return <>{text}</>;
  const tone = r === "W" ? SEARCH_PALETTE.yes.fill : r === "L" ? SEARCH_PALETTE.pen.fill : SEARCH_PALETTE.no.fill;
  return <span className={cn("inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold", tone)} data-result={r}>{text}</span>;
}

/** A season ("2025–26") as the header's season badge. */
export const SeasonChip = ({ text }: { text: string }) => <Badge variant="secondary" className="tabular-nums" data-season-chip>{text}</Badge>;

/** An event's type as a neutral badge (wider screens only); no dot, no hue. Only with `chip`. */
export function EventMarker({ type, chip }: { type: string | null | undefined; chip?: boolean }) {
  if (type === undefined || !chip || !type) return null;
  return <Badge variant="outline" className="ml-1.5 align-middle max-md:hidden" data-event-type={type}>{eventTypeLabel(type)}</Badge>;
}

type Col = { key: string; label: string; num?: boolean };

const isRankCol = (c: Col) => c.key === "rank" || /\brank\b|^#$/i.test(c.label);
const isRecordCol = (c: Col) => c.key === "record" || c.key === "rec" || /W-L-T/.test(c.label);
const isSeasonCol = (c: Col) => c.key === "season" && !c.num;
const isOprCol = (c: Col) => !!c.num && /\bOPR\b/.test(c.label) && !isRankCol(c);
const isRateCol = (c: Col) => !!c.num && /win rate/i.test(c.label);

/** A table column's largest positive number, which its bars scale to (the best OPR listed). */
export function columnMax(c: Col, values: (string | number | null | undefined)[]): number | null {
  if (!isOprCol(c)) return null;
  const xs = values.map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => Number.isFinite(v) && v > 0);
  return xs.length ? Math.max(...xs) : null;
}

/** One table cell, by what its column holds. */
export function Cell({ col, value, max }: { col: Col; value: string | number | null | undefined; max?: number | null }): ReactNode {
  if (value == null || value === "") return "–";
  const text = String(value);
  if (text === "–" || text === "—") return <span className="text-muted-foreground">–</span>;
  if (isRankCol(col)) return <RankPill text={text} />;
  if (isRecordCol(col)) return <RecordText text={text} />;
  if (isSeasonCol(col)) return <SeasonChip text={text} />;
  if (col.key === "result") return <ResultChip text={text} />;
  if (col.key === "award") return <AwardChip name={text} />;
  if (col.label === "Red–Blue") {
    const [r, b] = text.split("–");
    if (b != null) return <span className="whitespace-nowrap tabular-nums"><b className="font-semibold text-red-alliance-text">{r}</b><span className="text-muted-foreground">–</span><b className="font-semibold text-blue-alliance-text">{b}</b></span>;
  }
  const v = Number(text);
  if (isRateCol(col) && /%$/.test(text)) {
    const pc = Number(text.replace("%", ""));
    return <span className="inline-flex flex-col items-end gap-0.5" data-rate-cell><span>{text}</span>{Number.isFinite(pc) && <span className="block w-12"><Meter parts={[{ pc, cls: INK_BAR }]} /></span>}</span>;
  }
  if (max && Number.isFinite(v)) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5" data-opr-cell>
        <span className="font-semibold text-foreground">{text}</span>
        <span className="block w-12" data-opr-bar><Meter parts={[{ pc: Math.max(0, Math.min(100, (100 * v) / max)), cls: INK_BAR, value: v, scale: max }]} /></span>
      </span>
    );
  }
  return text;
}

/** Whether a table's column is text a phone row folds under the event's name (the team page's phone rows keep only
 *  the numbers in columns): the season and date beside an event. */
export const foldsOnPhone = (c: Col, first: Col) => first.key === "event" && (isSeasonCol(c) || c.key === "date");

const INLINE = /(Ranked\s+#\d[\d,]*(?:\s+of\s+\d[\d,]*)?|#\d[\d,]*\s+of\s+\d[\d,]*|\b\d{1,4}-\d{1,4}-\d{1,4}\b)/g;

/** A line of an answer's words with its ranks as pills and its records with the wins bold ("Ranked #6 of 24 · OPR 101.6"). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(INLINE);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 === 0 ? p : RECORD.test(p) ? <RecordText key={i} text={p} /> : <RankPill key={i} text={p} />))}</>;
}

/** A headline's value in the foreground: a record with its wins bold, a podium rank with a medal. No hue. */
/** `win`: a record's wins colour (one team's hue on its own card). */
export function HeadlineValue({ value, win }: { value: string; win?: string }) {
  if (RECORD.test(value) && !RECORD.exec(value)![4].trim()) return <RecordText text={value} win={win} />;
  const res = /^(Won|Lost|Tied)\b(.*)$/.exec(value);
  if (res) return <><span>{res[1]}</span>{res[2]}</>;
  const rank = /^#(\d+)\b/.exec(value);
  if (rank && PODIUM[Number(rank[1])]) return <span className="inline-flex items-center gap-2"><Trophy className="size-8 text-muted-foreground" aria-hidden />{value}</span>;
  return <>{value}</>;
}

/** One of a card line's small stat pills ("Ranked #1", "6-0-0 in quals", "OPR 50.0", "Red alliance", an award): a
 *  rank as its pill, an alliance in its colour (red and blue mark alliances), an award a filled chip in its kind's
 *  colour; the rest on the team hue's wash (nothing grey for data). */
export function ResultPill({ text }: { text: string }) {
  const box = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums";
  if (/^(Ranked\s+)?#\d/.test(text)) return <RankPill text={text} />;
  if (RECORD.test(text)) return <span className={cn(box, "border-team-a/50 bg-card")} data-pill><RecordText text={text} win={TEAM_TEXT} /></span>;
  if (/^red\b/i.test(text)) return <span className={cn(box, "border-red-alliance/30 bg-red-alliance/10 text-red-alliance-text")}>{text}</span>;
  if (/^blue\b/i.test(text)) return <span className={cn(box, "border-blue-alliance/30 bg-blue-alliance/10 text-blue-alliance-text")}>{text}</span>;
  if (/\b(award|alliance|winner|finalist|inspire|think|connect|innovate|control|motivate|design|reach|sustain)\b/i.test(text)) return <AwardChip name={text} className="py-0.5" />;
  return <span className={cn(box, "border-team-a/50 bg-card text-foreground")} data-pill>{text}</span>;
}

/** Which of two teams' numbers in a row is the better one ("a", "b", or null on a tie or a word): the higher, but
 *  the lower for a rank, a miss or penalties. */
export function better(label: string, a: unknown, b: unknown): "a" | "b" | null {
  if (a == null || b == null) return null;
  // The first number in each (a rank "#12 of 300", a rating "101.6 ±2.3", a ratio "0.50×"), the formatting dropped.
  const n = (x: unknown) => { const m = /[-−]?\d[\d,]*(?:\.\d+)?/.exec(String(x)); return m ? Number(m[0].replace(/,/g, "").replace("−", "-")) : NaN; };
  const x = n(a), y = n(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return null;
  // Lower is better for a rank, a miss, penalties, losses and every reliability part (no-shows, disqualifications,
  // near-zero matches, swing).
  const low = /pen|foul|rank|miss|loss|lost|no-?show|disqualif|\bdq|near-zero|swing/i.test(label) || String(a).trim().startsWith("#");
  return (low ? x < y : x > y) ? "a" : "b";
}

/** An answer's one footnote line (the guide's §8): where its numbers come from, with how they're counted behind an
 *  info button (a 44px target; the sentence opens under the line, by tap or keyboard), never a paragraph in the card. */
export function MethodNote({ lead, source, definition, children }: { lead?: string; source: string; definition: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const note = useId();
  return (
    <footer className="mt-5 border-t border-border pt-3" data-definition>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">{lead}<span data-source>{source}.</span></span>
        {definition && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={note} aria-label="How this is counted"
            className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground" data-method>
            <Info className="size-4" aria-hidden />
          </button>
        )}
      </p>
      {definition && <p id={note} hidden={!open} className="mt-1 text-xs text-muted-foreground" role="note">{definition}</p>}
      {children}
    </footer>
  );
}
