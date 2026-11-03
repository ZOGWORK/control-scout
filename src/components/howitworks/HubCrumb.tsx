// The way back to the How it works hub (/how-it-works), above each of its subpages.
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export function HubCrumb({ here }: { here: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 font-mono text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link to="/how-it-works" className="inline-flex min-h-8 items-center hover:text-foreground hover:underline">How it works</Link></li>
        <li aria-hidden><ChevronRight className="size-3.5" /></li>
        <li aria-current="page" className="text-foreground">{here}</li>
      </ol>
    </nav>
  );
}
