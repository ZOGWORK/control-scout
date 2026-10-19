// Route-level error boundary: a page that throws while rendering shows a calm
// "this page hit a problem" state inside the shell (navigation keeps working),
// and the error is offered for reporting (src/lib/errorReporting.ts). Keyed by
// the path, so moving to another page starts fresh. "Try again" asks the server
// afresh for what the page read (a bad cached answer would only fail again).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { EmptyState } from "./page";
import { Button } from "./ui/button";
import { captureError } from "../lib/errorReporting";
import { ApiReadsContext, forget } from "../lib/api";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  /** The API paths this page read (useApi registers them). */
  private reads = new Set<string>();
  private retry = () => { forget(this.reads); this.reads.clear(); this.setState({ failed: false }); };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    try { captureError(error, info.componentStack ?? undefined); } catch { /* never rethrow from here */ }
  }
  render() {
    if (!this.state.failed) return <ApiReadsContext.Provider value={this.reads}>{this.props.children}</ApiReadsContext.Provider>;
    return (
      <EmptyState
        className="my-6"
        icon={AlertTriangle}
        title="This page hit a problem"
        description="Something went wrong while showing it. Try again, or head somewhere else; the rest of the app still works."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={this.retry}><RefreshCw /> Try again</Button>
            <Button variant="outline" asChild><Link to="/"><Home /> Home</Link></Button>
          </div>
        }
      />
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
