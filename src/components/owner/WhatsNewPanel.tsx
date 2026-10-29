// The owner console's What's new (Rankings & content): the releases visitors see, where they come from and how
// a new one goes out. CHANGELOG.md is the one store: an entry ships with its pull request, so the notes always
// match the code that's live, and there's no second copy to keep in step.
import { lazy, Suspense } from "react";
import { Section } from "../page";
import { LoadingBlock } from "../states";
import { currentRelease } from "../../lib/changelog";

const WhatsNewReleases = lazy(() => import("./WhatsNewReleases"));

const STEPS = [
  <>Add a <span className="font-mono">## x.y.z — date</span> entry at the top of <span className="font-mono">CHANGELOG.md</span>: the next number after the newest (1.4.1 → 1.4.2, 1.4.9 → 1.5.0), with a one-line summary under it.</>,
  <>Open it with <span className="font-mono">### Highlights</span>: 3 to 5 one-line <span className="font-mono">- [tag] …</span> bullets a visitor would notice (the tag picks the icon), then the full notes in groups.</>,
  <>Bump the app's version to match (<span className="font-mono">npm version x.y.z --no-git-tag-version</span>) and link the pull request, e.g. <span className="font-mono">(#335)</span>.</>,
  <>Merge: the release goes live with the deploy, and visitors see the dot on What's new until they open it.</>,
];

export function WhatsNewPanel() {
  const live = currentRelease();
  return (
    <Section title="What's new" description={<>The releases every visitor sees under What's new{live ? <>, currently <span className="font-mono">v{live}</span></> : null}. They're read from <span className="font-mono">CHANGELOG.md</span>, which ships with each pull request, so there's nothing to edit here: the notes always match what's live.</>}>
      <ol className="mb-4 grid gap-2 sm:grid-cols-2" aria-label="How a release is published">
        {STEPS.map((s, i) => (
          <li key={i} className="flex min-w-0 gap-3 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-text" aria-hidden>{i + 1}</span>
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ol>
      <Suspense fallback={<LoadingBlock rows={4} label="Loading releases" />}><WhatsNewReleases live={live} /></Suspense>
    </Section>
  );
}
