// /faq: common questions, from src/shared/faq.ts (the same text the server's first paint and its FAQPage
// structured data use). Search narrows the questions as you type; the topic chips jump to a group; every
// question opens in place and has its own link (/faq#offline), which opens it on arrival.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ChevronDown, ClipboardList, Database, HardDriveDownload, Info, Link2, MessageSquare, Search, ShieldCheck, Sparkles, Star, X, type LucideIcon } from "lucide-react";
import { useTitle } from "../lib/meta";
import { PageHeader } from "../components/page";
import { Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/sonner";
import { cn } from "../components/cn";
import { FAQ, faqParts, faqText, type FaqItem } from "../shared/faq";

/** Each topic's icon and colour (chips and headings). */
const TOPIC: Record<string, { icon: LucideIcon; tone: string }> = {
  basics: { icon: Info, tone: "text-accent-text bg-accent/15" },
  data: { icon: Database, tone: "text-sky-500 bg-sky-500/15" },
  predictions: { icon: Sparkles, tone: "text-violet-500 bg-violet-500/15" },
  teams: { icon: Star, tone: "text-amber-500 bg-amber-500/15" },
  scouting: { icon: ClipboardList, tone: "text-emerald-500 bg-emerald-500/15" },
  offline: { icon: HardDriveDownload, tone: "text-orange-500 bg-orange-500/15" },
  privacy: { icon: ShieldCheck, tone: "text-rose-500 bg-rose-500/15" },
};
const topicOf = (id: string) => TOPIC[id] ?? { icon: MessageSquare, tone: "text-muted-foreground bg-muted" };

/** Words to match: lower case, accents dropped. */
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A question matches when every word of the search is in its question or answer. */
export function faqMatches(item: FaqItem, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${item.q} ${item.a.map(faqText).join(" ")}`);
  return words.every((w) => hay.includes(w));
}

function Answer({ text }: { text: string }) {
  return (
    <p>
      {faqParts(text).map((p, i) => !("href" in p) ? <span key={i}>{p.text}</span>
        : /^https?:/.test(p.href) ? <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="font-medium text-accent-text underline-offset-4 hover:underline">{p.text}</a>
        : <Link key={i} to={p.href} className="font-medium text-accent-text underline-offset-4 hover:underline">{p.text}</Link>)}
    </p>
  );
}

function Question({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  const copy = () => {
    const url = `${location.origin}/faq#${item.id}`;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
  };
  return (
    <li id={item.id} className="scroll-mt-20">
      <h3>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${item.id}-answer`}
          className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left font-medium outline-none hover:bg-text-base/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60">
          <span>{item.q}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180 text-accent")} aria-hidden />
        </button>
      </h3>
      {open && (
        <div id={`${item.id}-answer`} className="space-y-3 px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
          {item.a.map((t, i) => <Answer key={i} text={t} />)}
          <button type="button" onClick={copy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground">
            <Link2 className="size-3.5" aria-hidden /> Copy link to this answer
          </button>
        </div>
      )}
    </li>
  );
}

export default function FaqPage() {
  useTitle("FAQ");
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Arriving on /faq#question opens that answer and brings it into view.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id || !FAQ.some((g) => g.items.some((i) => i.id === id))) return;
    setOpen((s) => new Set(s).add(id));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [hash]);

  const groups = useMemo(() => FAQ.map((g) => ({ ...g, items: g.items.filter((i) => faqMatches(i, query)) })).filter((g) => g.items.length), [query]);
  const searching = query.trim().length > 0;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader title="Frequently asked questions" description="Quick answers about Control Scout: the data, the predictions, scouting, offline use and your privacy." />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the questions, e.g. offline, OPR, account" aria-label="Search the FAQ" className="h-12 rounded-xl pl-10 pr-10 text-base" />
        {searching && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{searching ? `${shown} ${shown === 1 ? "question matches" : "questions match"}` : " "}</p>

      {!searching && (
        <nav aria-label="FAQ topics" className="mt-4 flex flex-wrap gap-2">
          {FAQ.map((g) => {
            const t = topicOf(g.id);
            return (
              <a key={g.id} href={`#topic-${g.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3.5 text-sm text-muted-foreground hover:border-accent/50 hover:text-foreground max-sm:min-h-11">
                <span className={cn("flex size-6 items-center justify-center rounded-full", t.tone)}><t.icon className="size-3.5" aria-hidden /></span>{g.title}
              </a>
            );
          })}
        </nav>
      )}

      <div className="mt-8 space-y-10">
        {!groups.length ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
            <p className="font-medium">No question matches “{query.trim()}”</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another word, or ask us directly.</p>
            <Button className="mt-4" asChild><Link to="/contact"><MessageSquare /> Ask a question</Link></Button>
          </div>
        ) : groups.map((g) => (
          <section key={g.id} id={`topic-${g.id}`} aria-labelledby={`topic-${g.id}-title`} className="scroll-mt-20">
            <h2 id={`topic-${g.id}-title`} className="mb-3 flex items-center gap-2.5 font-display text-lg font-semibold">
              {(() => { const t = topicOf(g.id); return <span className={cn("flex size-8 items-center justify-center rounded-lg", t.tone)}><t.icon className="size-4" aria-hidden /></span>; })()}
              {g.title}
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {/* While searching, every match is open: the answer is what you're looking for. */}
              {g.items.map((i) => <Question key={i.id} item={i} open={searching || open.has(i.id)} onToggle={() => toggle(i.id)} />)}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/30 bg-accent/[0.06] p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Still stuck?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ask us anything, report a bug or wrong data, or suggest a feature. We reply by email.</p>
        </div>
        <Button asChild><Link to="/contact">Contact us <ArrowRight /></Link></Button>
      </section>
    </div>
  );
}
