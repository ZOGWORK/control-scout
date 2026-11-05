// The colour language every /search answer card's numbers speak, taken from the team and event pages: a rank as a
// pill (the search podium's 1st green, 2nd blue, 3rd orange with a medal; the rest neutral), a W-L-T record with
// wins green and losses red, a win or loss its own chip, an OPR with a small bar against the best one listed (in
// its phase's colour where the column is a phase), a season as the header's season badge, an event's type as the
// Events cards' type colour. Drawn from the text the server sends: a cell that isn't in a known shape stays plain.
import type { ReactNode } from "react";
import { Award, Medal, Trophy } from "lucide-react";
import { EVENT_TYPE_TONE } from "../../../lib/textTones";
import { eventTypeLabel } from "../../../shared/labels";
import { EventTypeChip } from "../../EventChips";
import { Badge } from "../../ui/basic";
import { Meter, TONES, type Tone } from "../../StatTile";
import { cn } from "../../cn";

/** The search podium's colours (./EventAwards.tsx, ../TeamTable.tsx): 1st green, 2nd blue, 3rd orange. */
export const PODIUM: Record<number, Tone> = { 1: "emerald", 2: "sky", 3: "orange" };

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
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums leading-none", tone ? TONES[tone].chip : "bg-text-base/[0.07] text-foreground")} data-rank-pill>
        {tone && <Medal className="size-3" aria-hidden />}#{rank.toLocaleString()}
        {m[3] && <span className="font-medium opacity-80">{` of ${n(m[3]).toLocaleString()}`}</span>}
      </span>
      {m[4].trim() && <span className="text-xs text-muted-foreground">{m[4].trim()}</span>}
    </span>
  );
}

/** "5-3-0" with wins green, losses red and ties muted (the team page's record tile); anything after it plain. */
export function RecordText({ text, className }: { text: string; className?: string }) {
  const m = RECORD.exec(text.trim());
  if (!m) return <>{text}</>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} aria-label={`${m[1]} wins, ${m[2]} losses, ${m[3]} ties${m[4]}`} data-record-text>
      <span aria-hidden><b className="font-semibold text-success-text">{m[1]}</b><span className="text-muted-foreground">-</span><b className="font-semibold text-danger-text">{m[2]}</b><span className="text-muted-foreground">-{m[3]}</span></span>
      {m[4] && <span aria-hidden className="text-muted-foreground">{m[4]}</span>}
    </span>
  );
}

/** A won, lost or tied result as a chip (the match rows' own). */
export function ResultChip({ text }: { text: string }) {
  const r = /^w/i.test(text) ? "W" : /^l/i.test(text) ? "L" : /^t/i.test(text) ? "T" : null;
  if (!r) return <>{text}</>;
  const tone = r === "W" ? "bg-success/15 text-success-text" : r === "L" ? "bg-danger/15 text-danger-text" : "bg-muted text-foreground";
  return <span className={cn("inline-flex min-w-6 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold", tone)} data-result={r}>{text}</span>;
}

/** A season ("2025–26") as the header's season badge. */
export const SeasonChip = ({ text }: { text: string }) => <Badge variant="secondary" className="tabular-nums" data-season-chip>{text}</Badge>;

/** An event's type as a dot in its Events-card colour; with `chip`, the type's label beside it on wider screens. */
export function EventMarker({ type, chip }: { type: string | null | undefined; chip?: boolean }) {
  if (type === undefined) return null;
  const tone = EVENT_TYPE_TONE[type ?? ""];
  return (
    <>
      <span aria-hidden className={cn("mr-1.5 inline-block size-2 shrink-0 rounded-full align-middle", tone?.bar ?? "bg-muted-foreground/50")} data-event-marker={type ?? ""} />
      {chip && type && <EventTypeChip type={type} label={eventTypeLabel(type)} className="ml-1.5 align-middle max-md:hidden" />}
    </>
  );
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

/** One table cell in the answer's colours, by what its column holds. `phase`: the column is a phase (its colour). */
export function Cell({ col, value, max, phase }: { col: Col; value: string | number | null | undefined; max?: number | null; phase?: Tone | null }): ReactNode {
  if (value == null || value === "") return "–";
  const text = String(value);
  if (text === "–" || text === "—") return <span className="text-muted-foreground">–</span>;
  if (isRankCol(col)) return <RankPill text={text} />;
  if (isRecordCol(col)) return <RecordText text={text} />;
  if (isSeasonCol(col)) return <SeasonChip text={text} />;
  if (col.key === "result") return <ResultChip text={text} />;
  if (col.key === "award") return <span className="inline-flex items-start gap-1.5"><Award className="mt-0.5 size-3.5 shrink-0 text-accent-text" aria-hidden /><span>{text}</span></span>;
  if (col.label === "Red–Blue") {
    const [r, b] = text.split("–");
    if (b != null) return <span className="whitespace-nowrap tabular-nums"><b className="font-semibold text-red-alliance-text">{r}</b><span className="text-muted-foreground">–</span><b className="font-semibold text-blue-alliance-text">{b}</b></span>;
  }
  const v = Number(text);
  if (isRateCol(col) && /%$/.test(text)) {
    const pc = Number(text.replace("%", ""));
    return <span className="inline-flex flex-col items-end gap-0.5" data-rate-cell><span>{text}</span>{Number.isFinite(pc) && <span className="block w-12"><Meter parts={[{ pc, cls: "bg-success" }]} /></span>}</span>;
  }
  if (max && Number.isFinite(v)) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5" data-opr-cell>
        <span className={cn("font-semibold", phase ? TONES[phase].text : "text-foreground")}>{text}</span>
        <span className="block w-12" data-opr-bar><Meter parts={[{ pc: Math.max(0, Math.min(100, (100 * v) / max)), cls: phase ? TONES[phase].bar : TONES.accent.bar }]} /></span>
      </span>
    );
  }
  return text;
}

/** Whether a table's column is text a phone row folds under the event's name (the team page's phone rows keep only
 *  the numbers in columns): the season and date beside an event. */
export const foldsOnPhone = (c: Col, first: Col) => first.key === "event" && (isSeasonCol(c) || c.key === "date");

const INLINE = /(Ranked\s+#\d[\d,]*(?:\s+of\s+\d[\d,]*)?|#\d[\d,]*\s+of\s+\d[\d,]*|\b\d{1,4}-\d{1,4}-\d{1,4}\b)/g;

/** A line of an answer's words with its ranks as pills and its records coloured ("Ranked #6 of 24 · OPR 101.6"). */
export function RichText({ text }: { text: string }) {
  const parts = text.split(INLINE);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 === 0 ? p : RECORD.test(p) ? <RecordText key={i} text={p} /> : <RankPill key={i} text={p} />))}</>;
}

/** A headline's value in its colour: a record coloured, a won or lost result in its tone, a yes or no likewise, a
 *  rank in its podium colour. Anything else in the foreground. */
export function HeadlineValue({ value }: { value: string }) {
  if (RECORD.test(value) && !RECORD.exec(value)![4].trim()) return <RecordText text={value} />;
  const res = /^(Won|Lost|Tied)\b(.*)$/.exec(value);
  if (res) return <><span className={res[1] === "Won" ? "text-success-text" : res[1] === "Lost" ? "text-danger-text" : undefined}>{res[1]}</span>{res[2]}</>;
  if (value === "Yes") return <span className="text-success-text">Yes</span>;
  if (value === "No") return <span className="text-danger-text">No</span>;
  const rank = /^#(\d+)\b/.exec(value);
  if (rank && PODIUM[Number(rank[1])]) return <span className="inline-flex items-center gap-2"><Trophy className={cn("size-8", TONES[PODIUM[Number(rank[1])]].text)} aria-hidden />{value}</span>;
  return <>{value}</>;
}

/** One of a card line's small stat pills ("Ranked #1", "6-0-0 in quals", "OPR 50.0", "Red alliance", an award): a
 *  rank as its pill, a record coloured, an alliance in its colour, an award with its icon; anything else plain. */
export function ResultPill({ text }: { text: string }) {
  const box = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums";
  if (/^(Ranked\s+)?#\d/.test(text)) return <RankPill text={text} />;
  if (RECORD.test(text)) return <span className={cn(box, "border-border bg-muted/50")}><RecordText text={text} /></span>;
  if (/^red\b/i.test(text)) return <span className={cn(box, "border-red-alliance/30 bg-red-alliance/10 text-red-alliance-text")}>{text}</span>;
  if (/^blue\b/i.test(text)) return <span className={cn(box, "border-blue-alliance/30 bg-blue-alliance/10 text-blue-alliance-text")}>{text}</span>;
  if (/\b(award|alliance|winner|finalist|inspire|think|connect|innovate|control|motivate|design|reach|sustain)\b/i.test(text)) return <span className={cn(box, TONES.violet.chip, "border-transparent")}><Award className="size-3" aria-hidden />{text}</span>;
  if (/^(auto|tele-?op|end-?game)\b/i.test(text)) { const t: Tone = /^auto/i.test(text) ? "sky" : /^tele/i.test(text) ? "emerald" : "violet"; return <span className={cn(box, TONES[t].chip, "border-transparent")}>{text}</span>; }
  return <span className={cn(box, "border-border bg-muted/50 text-foreground")}>{text}</span>;
}
