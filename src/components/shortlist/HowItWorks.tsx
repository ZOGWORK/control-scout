// The Shortlist's instructions: shown in full while the list is empty (a first visit), and behind a
// "How it works" button once there are picks, so a returning scout sees their candidates first.
import { Bookmark, ChevronDown, Download, GripVertical, HelpCircle, Palette, PencilLine, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { MAX_COMPARE } from "./PickRows";

export const HOW_IT_WORKS_ID = "shortlist-how-it-works";

/** The button that shows or hides the instructions (words, not just an icon). */
export function HowItWorksToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={onToggle} aria-expanded={open} aria-controls={HOW_IT_WORKS_ID} className={className}>
      <HelpCircle /> How it works <ChevronDown className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </Button>
  );
}

function Step({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5", tone)}>{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** What a pick list can do, step by step (with each step's keyboard way where it has one). */
export function HowItWorks({ className, title = true, hidden }: { className?: string; title?: boolean; hidden?: boolean }) {
  return (
    <section id={HOW_IT_WORKS_ID} hidden={hidden} aria-label="How the shortlist works" className={cn("rounded-2xl border border-border bg-card p-4 text-sm", className)}>
      {title && <h2 className="mb-3 font-display text-base font-semibold">How it works</h2>}
      <ul className="grid gap-2.5 text-text-muted sm:grid-cols-2">
        <Step icon={<Bookmark />} tone="bg-accent/15 text-accent-text">Add a team with the search on this page, or press <span className="font-medium text-text-base">Shortlist</span> on any team page. An event’s Rankings tab is a good place to start.</Step>
        <Step icon={<GripVertical />} tone="bg-accent/15 text-accent-text">Drag the grip to rank your picks, or focus it and use the arrow keys. <span className="font-medium text-text-base">Order picks</span> ranks the whole list by OPR or rating.</Step>
        <Step icon={<Scale />} tone="bg-info/15 text-info">Tick up to {MAX_COMPARE} teams to compare them (in the phone’s list view, open a pick to tick it). With none ticked, Compare takes your top {MAX_COMPARE}.</Step>
        <Step icon={<Palette />} tone="bg-violet-500/15 text-violet-600 dark:text-violet-300">Give a team one of eight named colours with the dot beside its number; Compare draws the team in it too.</Step>
        <Step icon={<PencilLine />} tone="bg-success/15 text-success">Write a private note under any team. Open a pick for its OPR split, event by event chart and last matches.</Step>
        <Step icon={<Download />} tone="bg-warning/15 text-warning"><span className="font-medium text-text-base">CSV</span> downloads the list with your notes, for a spreadsheet or print-out.</Step>
      </ul>
    </section>
  );
}
