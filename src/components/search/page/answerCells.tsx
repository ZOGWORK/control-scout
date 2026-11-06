// How every /search answer card's numbers read, by the search results guide (.claude/search-viz-guide-2026-11-05.txt):
// hue means team only, so nothing here is coloured by what it is. A rank is a neutral pill (a medal on the top three),
// a record and a result read as their text with the win in bold, an OPR has a small neutral bar from zero to the best
// one listed, a season is the header's season badge, an event's type a neutral badge. Alliance red and blue stay where
// they mark an alliance. Drawn from the text the server sends: a cell that isn't in a known shape stays plain.
import { useId, useState, type ReactNode } from "react";
import { Award, Info, Medal, Trophy } from "lucide-react";
import { PODIUM_CHIP } from "../../../lib/textTones";
import { eventTypeLabel } from "../../../shared/labels";
import { Badge } from "../../ui/basic";
import { Meter } from "../../StatTile";
import { cn } from "../../cn";

/** The places that get a medal: the top three, all in the same neutral chip (no hue for a place). */
export const PODIUM: Record<number, true> = { 1: true, 2: true, 3: true };

/** A data bar's ink where no team is meant (one team's numbers, a table column): neutral, never a hue. */
export const INK_BAR = "bg-foreground/55";
/** A card about one team: that team's hue (team A, the colour a team has wherever search compares it) on its numbers,
 *  bars and marks, the one hue on the card (the search results guide: hue means team; a card without a team stays ink). */
export const TEAM_BAR = "bg-team-a";
export const TEAM_TEXT = "text-team-a";

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
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums leading-none", tone ? PODIUM_CHIP[rank] : "bg-text-base/[0.07] text-foreground")} data-rank-pill>
        {tone && <Medal className="size-3" aria-hidden />}#{rank.toLocaleString()}
        {m[3] && <span className="font-medium opacity-80">{` of ${n(m[3]).toLocaleString()}`}</span>}
      </span>
      {m[4].trim() && <span className="text-xs text-muted-foreground">{m[4].trim()}</span>}
    </span>
  );
}

/** "5-3-0" with the wins in bold (no win or loss hue: red and blue are alliances); anything after it muted. */
export function RecordText({ text, className }: { text: string; className?: string }) {
  const m = RECORD.exec(text.trim());
  if (!m) return <>{text}</>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} aria-label={`${m[1]} wins, ${m[2]} losses, ${m[3]} ties${m[4]}`} data-record-text>
      <span aria-hidden><b className="font-semibold text-foreground">{m[1]}</b><span className="text-muted-foreground">-{m[2]}-{m[3]}</span></span>
      {m[4] && <span aria-hidden className="text-muted-foreground">{m[4]}</span>}
    </span>
  );
}

/** A won, lost or tied result as a chip: a win solid, a loss outlined, a tie muted (told apart without hue). */
export function ResultChip({ text }: { text: string }) {
  const r = /^w/i.test(text) ? "W" : /^l/i.test(text) ? "L" : /^t/i.test(text) ? "T" : null;
  if (!r) return <>{text}</>;
  const tone = r === "W" ? "bg-foreground text-background" : r === "L" ? "border border-border text-foreground" : "bg-muted text-muted-foreground";
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
  if (col.key === "award") return <span className="inline-flex items-start gap-1.5"><Award className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden /><span>{text}</span></span>;
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
export function HeadlineValue({ value }: { value: string }) {
  if (RECORD.test(value) && !RECORD.exec(value)![4].trim()) return <RecordText text={value} />;
  const res = /^(Won|Lost|Tied)\b(.*)$/.exec(value);
  if (res) return <><span>{res[1]}</span>{res[2]}</>;
  const rank = /^#(\d+)\b/.exec(value);
  if (rank && PODIUM[Number(rank[1])]) return <span className="inline-flex items-center gap-2"><Trophy className="size-8 text-muted-foreground" aria-hidden />{value}</span>;
  return <>{value}</>;
}

/** One of a card line's small stat pills ("Ranked #1", "6-0-0 in quals", "OPR 50.0", "Red alliance", an award): a
 *  rank as its pill, an alliance in its colour (red and blue mark alliances), an award with its icon; the rest plain. */
export function ResultPill({ text }: { text: string }) {
  const box = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums";
  if (/^(Ranked\s+)?#\d/.test(text)) return <RankPill text={text} />;
  if (RECORD.test(text)) return <span className={cn(box, "border-border bg-muted/50")}><RecordText text={text} /></span>;
  if (/^red\b/i.test(text)) return <span className={cn(box, "border-red-alliance/30 bg-red-alliance/10 text-red-alliance-text")}>{text}</span>;
  if (/^blue\b/i.test(text)) return <span className={cn(box, "border-blue-alliance/30 bg-blue-alliance/10 text-blue-alliance-text")}>{text}</span>;
  if (/\b(award|alliance|winner|finalist|inspire|think|connect|innovate|control|motivate|design|reach|sustain)\b/i.test(text)) return <span className={cn(box, "border-border bg-muted/50 text-foreground")}><Award className="size-3 text-muted-foreground" aria-hidden />{text}</span>;
  return <span className={cn(box, "border-border bg-muted/50 text-foreground")}>{text}</span>;
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
