// Owner portal › Usage › First-visit onboarding: how far new visitors get (server/onboardingStats.ts), from those who
// allowed usage statistics. One zero-based bar per step (the share of visitors who saw step 1 that reached it), the
// skips on each step, and the finish line: how many finished, and how many of them picked a team.
import type { OnboardingSummary } from "../../shared/onboardingStats";

const STEPS = ["Welcome", "Your team", "Search", "Find your way"] as const;
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "–");

export function OnboardingFunnel({ s }: { s: OnboardingSummary }) {
  const skippedTotal = s.skipped.reduce((a, b) => a + b, 0);
  // Empty only when nothing at all was counted: a visitor can open it before the period and skip or finish inside it.
  if (s.shown === 0 && skippedTotal === 0 && s.finished === 0 && s.reached.every((n) => n === 0)) {
    return <p className="text-sm text-text-muted" data-onboarding-funnel="">No first visits counted in the last {s.days} days yet.</p>;
  }
  return (
    <div data-onboarding-funnel="">
      <ol className="grid gap-2.5">
        {STEPS.map((name, i) => {
          const n = s.reached[i]!;
          const share = s.shown > 0 ? Math.min(1, n / s.shown) : 0;
          return (
            <li key={name} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 max-sm:grid-cols-[6rem_1fr_auto]">
              <span className="truncate text-sm text-text-base">{i + 1}. {name}</span>
              <span className="h-3 overflow-hidden rounded-full bg-text-base/10" role="img" aria-label={s.shown > 0 ? `${pct(n, s.shown)} reached step ${i + 1}` : `${n} reached step ${i + 1}`}>
                <span className="block h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
              </span>
              <span className="text-right font-mono text-sm tabular-nums text-text-base">
                {n.toLocaleString("en-US")} <span className="text-text-muted">({pct(n, s.shown)})</span>
                {s.skipped[i]! > 0 && <span className="ml-2 text-text-muted">· {s.skipped[i]!.toLocaleString("en-US")} skipped</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <dl className="mt-4 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <div className="rounded-xl border border-line p-3">
          <dt className="text-xs text-text-muted">Finished</dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums text-success-text">{s.finished.toLocaleString("en-US")} <span className="text-sm text-text-muted">({pct(s.finished, s.shown)})</span></dd>
        </div>
        <div className="rounded-xl border border-line p-3">
          <dt className="text-xs text-text-muted">Skipped</dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums text-text-base">{skippedTotal.toLocaleString("en-US")} <span className="text-sm text-text-muted">({pct(skippedTotal, s.shown)})</span></dd>
        </div>
        <div className="rounded-xl border border-line p-3">
          <dt className="text-xs text-text-muted">Picked a team</dt>
          <dd className="mt-0.5 font-mono text-lg tabular-nums text-accent-text">{s.withTeam.toLocaleString("en-US")} <span className="text-sm text-text-muted">({pct(s.withTeam, s.finished)} of finished)</span></dd>
        </div>
      </dl>
    </div>
  );
}
