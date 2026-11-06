// A yes-or-no question's answer, first and big ("has 12345 ever been to worlds"): the word in its colour (green yes,
// slate no, from search's palette), the sentence that says it after it. The card under it is the evidence
// (server/api/answers/yesNo.ts).
import type { SearchAnswer } from "../../../shared/api";
import { SEARCH_PALETTE } from "../../../lib/textTones";
import { cn } from "../../cn";

export function Verdict({ v, className }: { v: NonNullable<SearchAnswer["verdict"]>; className?: string }) {
  return (
    <p className={cn("mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5", className)} data-verdict={v.answer}>
      <span className={cn("rounded-lg px-3 py-1 font-display text-3xl font-semibold leading-tight", SEARCH_PALETTE[v.answer === "Yes" ? "yes" : "no"].fill)}>{v.answer}</span>
      <span className="min-w-0 text-base text-foreground">{v.label}</span>
    </p>
  );
}
