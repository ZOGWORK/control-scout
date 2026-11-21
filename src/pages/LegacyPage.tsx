// /legacy: pick the new look (v8, docs/design/v8-revamp-brief.md) or the classic one, on this device. Linked from
// Settings → Display → Look; noindex. The choice is stored (src/lib/v8.ts), so the classic look stays reachable after
// the new one becomes the default.
import { Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { useTitle } from "../lib/meta";
import { setV8, useIsV8 } from "../lib/v8";

const LOOKS = [
  { v8: true, name: "New look", line: "Calmer and darker, each page built around what you came for." },
  { v8: false, name: "Classic look", line: "Control Scout as it was, yellow accents and all." },
] as const;

export default function LegacyPage() {
  useTitle("Classic look");
  const v8 = useIsV8();
  return (
    <div className="mx-auto max-w-xl space-y-6 py-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight v8:font-sans v8:text-[1.375rem]">Pick a look</h1>
        <p className="text-sm text-text-muted">Your choice is kept on this device. Everything else stays the same: your team, shortlist and settings.</p>
      </div>
      <ul className="space-y-3">
        {LOOKS.map((l) => {
          const on = l.v8 === v8;
          return (
            <li key={l.name} data-look={l.v8 ? "new" : "classic"} className="flex items-center gap-4 rounded-xl border border-line bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.name}</p>
                <p className="text-sm text-text-muted">{l.line}</p>
              </div>
              {on
                ? <span className="flex items-center gap-1.5 text-sm text-text-muted"><Check className="size-4" /> In use</span>
                : <Button size="sm" className="max-sm:h-[44px]" onClick={() => setV8(l.v8, "/")}>Use {l.name.toLowerCase()}</Button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
