// "Take the tour": the first-run tour again, from step 1, on the last page this tab was on that has a tour
// (Home when there's none). Shown in Settings → About and on How it works; skipping the tour never hides it.
import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "../ui/button";
import { replayTour } from "../../lib/tour";

export function TakeTour({ label = "Take the tour", className }: { label?: string; className?: string }) {
  const navigate = useNavigate();
  return (
    <Button variant="outline" size="sm" className={className ?? "max-sm:h-11"} onClick={() => navigate(replayTour())} data-take-tour="">
      <Compass /> {label}
    </Button>
  );
}
