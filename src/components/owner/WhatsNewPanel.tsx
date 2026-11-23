// The owner console's What's new (Rankings & content): the releases visitors see. CHANGELOG.md is the one store: an
// entry ships with its pull request, so the notes always match the code that's live and there's nothing to edit here.
// Folded: it's there to look something up, not to act on.
import { lazy, Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Section } from "../page";
import { LoadingBlock } from "../states";
import { currentRelease } from "../../lib/changelog";

const WhatsNewReleases = lazy(() => import("./WhatsNewReleases"));

export function WhatsNewPanel() {
  const live = currentRelease();
  return (
    <Section title="What's new" collapsible icon={Sparkles} summary={live ? `v${live} live · the releases visitors see` : "The releases visitors see"}
      description={<>The releases every visitor sees under What's new. They're read from <span className="font-mono">CHANGELOG.md</span>, which ships with each pull request, so there's nothing to edit here: the notes always match what's live.</>}>
      <Suspense fallback={<LoadingBlock rows={4} label="Loading releases" />}><WhatsNewReleases live={live} /></Suspense>
    </Section>
  );
}
