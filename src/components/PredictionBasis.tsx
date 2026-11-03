// "What this prediction learns from", in one short line under a prediction, with a link to the full story
// (src/shared/predictionBasis.ts holds the copy and where each fact is checked in the engine).
import { Link } from "react-router-dom";
import { BASIS, BASIS_HREF, type BasisKind } from "../shared/predictionBasis";
import { cn } from "./cn";

export function PredictionBasis({ kind, className }: { kind: BasisKind; className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="prediction-basis" data-basis={kind}>
      {BASIS[kind]} <Link to={BASIS_HREF} className="underline">How</Link>
    </p>
  );
}
