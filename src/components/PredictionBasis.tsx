// "What this prediction learns from", in one short line under a prediction, with a link to the full story
// (src/shared/predictionBasis.ts holds the copy and where each fact is checked in the engine).
import { Link } from "react-router-dom";
import { BASIS, BASIS_HREF, type BasisKind } from "../shared/predictionBasis";
import { cn } from "./cn";

/** `quiet`: only a "How" link, the sentence in its tooltip and for screen readers (a page short on words). */
export function PredictionBasis({ kind, className, quiet }: { kind: BasisKind; className?: string; quiet?: boolean }) {
  if (quiet) return (
    <span className={cn("text-xs text-muted-foreground", className)} data-testid="prediction-basis" data-basis={kind}>
      <span className="sr-only">{BASIS[kind]} </span><Link to={BASIS_HREF} title={BASIS[kind]} className="underline decoration-dotted underline-offset-2">How</Link>
    </span>
  );
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="prediction-basis" data-basis={kind}>
      {BASIS[kind]} <Link to={BASIS_HREF} className="underline">How</Link>
    </p>
  );
}
