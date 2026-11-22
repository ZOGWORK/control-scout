// /legacy: pick the new look (v8, docs/design/v8-revamp-brief.md) or the classic one, on this device. The owner's
// alone (src/lib/ownerLook.tsx): linked from the owner console's Features tab; anyone else is sent Home. noindex. The
// choice is stored (src/lib/v8.ts).
import { Check } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useMayPickLook } from "../lib/ownerLook";
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
  const may = useMayPickLook();
  // Nothing until the server has said who's here; then the owner picks, and anyone else goes Home.
  if (may === undefined) return null;
  if (!may) return <Navigate to="/" replace />;
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
