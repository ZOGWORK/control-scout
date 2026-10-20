// What's new, the content (loaded only when the dialog opens): CHANGELOG.md read into releases, with a
// version rail (beside the release on wide screens, above it on phones). Each release opens on its digest,
// a few one-line highlights with coloured icons, and keeps the full notes behind "Full release notes".
import { useId, useMemo, useState, type ComponentType } from "react";
import {
  Bell, ChevronDown, ClipboardList, CloudDownload, FileText, History, House, ListOrdered, Radio, Share2,
  Sparkles, Target, Trophy, Users, UsersRound, Wrench, Zap,
} from "lucide-react";
import md from "../../CHANGELOG.md?raw";
import { inlines, parseChangelog, type ChangelogEntry, type ChangelogHighlight, type HighlightTag } from "../lib/changelog";
import { cn } from "./cn";

const REPO = "https://github.com/Control-Point-FTC/control-scout/pull/";

type Tone = { icon: ComponentType<{ className?: string }>; tone: string };
/** A highlight's `[tag]` → its icon and colour (the tags CHANGELOG.md documents). Unknown or missing: a sparkle. */
const TAGS: Record<HighlightTag, Tone> = {
  home: { icon: House, tone: "bg-amber-500/15 text-accent-text" },
  predict: { icon: Target, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300" },
  teams: { icon: Users, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  scout: { icon: ClipboardList, tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  offline: { icon: CloudDownload, tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  speed: { icon: Zap, tone: "bg-yellow-500/15 text-accent-text" },
  live: { icon: Radio, tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  report: { icon: FileText, tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  alerts: { icon: Bell, tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  rankings: { icon: Trophy, tone: "bg-yellow-500/15 text-accent-text" },
  share: { icon: Share2, tone: "bg-pink-500/15 text-pink-700 dark:text-pink-300" },
  workspace: { icon: UsersRound, tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  picklist: { icon: ListOrdered, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300" },
  history: { icon: History, tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  fixes: { icon: Wrench, tone: "bg-lime-500/15 text-lime-700 dark:text-lime-300" },
};
const FALLBACK: Tone = { icon: Sparkles, tone: "bg-accent-soft text-accent-text" };
const toneOf = (tag: string | null): Tone => (tag && Object.hasOwn(TAGS, tag) ? TAGS[tag as HighlightTag] : FALLBACK);

function Line({ text }: { text: string }) {
  return (
    <>
      {inlines(text).map((p, i) => p.kind === "bold" ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong>
        : p.kind === "code" ? <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{p.text}</code>
        : p.kind === "pr" ? <a key={i} href={`${REPO}${p.number}`} target="_blank" rel="noreferrer noopener" className="text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground hover:decoration-current">{p.text}</a>
        : <span key={i}>{p.text}</span>)}
    </>
  );
}

/** The digest: one short line per highlight, each behind a coloured icon chip. */
function Highlights({ items }: { items: ChangelogHighlight[] }) {
  return (
    <ul aria-label="Highlights" className="mt-4 grid gap-2.5">
      {items.map((h, i) => {
        const { icon: Icon, tone } = toneOf(h.tag);
        return (
          <li key={i} className="flex items-center gap-3 text-[15px] leading-snug text-foreground">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone)} aria-hidden><Icon className="size-4" /></span>
            <span><Line text={h.text} /></span>
          </li>
        );
      })}
    </ul>
  );
}

function Notes({ e }: { e: ChangelogEntry }) {
  return (
    <>
      {e.groups.map((g) => (
        <section key={g.heading} className="mt-5 first:mt-0">
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-text">{g.heading}</h4>
          <ul className="mt-2 grid gap-2">
            {g.items.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden /><span><Line text={item} /></span></li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Release({ e }: { e: ChangelogEntry }) {
  const [full, setFull] = useState(false);
  const notesId = useId();
  const digest = e.highlights.length > 0;
  return (
    <article>
      <p className="text-xs text-muted-foreground">v{e.version} · {e.date}</p>
      <h3 className="mt-1 font-display text-lg font-semibold tracking-tight sm:text-xl">{e.summary}</h3>
      {digest ? (
        <>
          <Highlights items={e.highlights} />
          {e.groups.length > 0 && (
            <>
              <button type="button" aria-expanded={full} aria-controls={notesId} onClick={() => setFull((f) => !f)}
                className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60">
                Full release notes
                <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", full && "rotate-180")} aria-hidden />
              </button>
              <div id={notesId} hidden={!full} className="mt-5 border-t border-border pt-5">{full && <Notes e={e} />}</div>
            </>
          )}
        </>
      ) : (
        // No highlights written for this release: its full notes, as before.
        <div className="mt-5"><Notes e={e} /></div>
      )}
    </article>
  );
}

export default function WhatsNewContent() {
  const all = useMemo(() => parseChangelog(md), []);
  const [version, setVersion] = useState(all[0]?.version);
  const e = all.find((x) => x.version === version) ?? all[0];
  return (
    <div className="grid min-h-0 sm:grid-cols-[160px_1fr]">
      <nav aria-label="Releases" className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:max-h-[64dvh] sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
        {all.map((x, i) => (
          <button key={x.version} type="button" onClick={() => setVersion(x.version)} aria-current={x.version === e?.version ? "true" : undefined}
            className={cn("flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-lg px-3 text-left text-sm transition-colors",
              x.version === e?.version ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
            v{x.version}
            {i === 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">Latest</span>}
          </button>
        ))}
      </nav>
      {/* A scrolling region keyboard users can reach (Tab, then the arrow keys) even when a release has no links. */}
      <div tabIndex={0} role="region" aria-label={e ? `Release v${e.version}` : "Releases"} className="max-h-[56dvh] overflow-y-auto px-6 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 sm:max-h-[64dvh]">{e ? <Release key={e.version} e={e} /> : <p className="text-sm text-muted-foreground">No releases listed yet.</p>}</div>
    </div>
  );
}
