// "Take the tour": the first-run tour, from step 1, on the last page this tab was on that has a tour (Home when
// there's none). Shown in Settings → About, on How it works and on the welcome card, only while the owner has the
// tour on (onboardingTour); skipping the tour never hides it.
import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "../ui/button";
import { replayTour } from "../../lib/tour";
import { useFlag } from "../../lib/flags";

export function TakeTour({ label = "Take the tour", className }: { label?: string; className?: string }) {
  const navigate = useNavigate();
  if (!useFlag("onboardingTour")) return null;
  return (
    <Button variant="outline" size="sm" className={className ?? "max-sm:h-[44px]"} onClick={() => navigate(replayTour())} data-take-tour="">
      <Compass /> {label}
    </Button>
  );
}
