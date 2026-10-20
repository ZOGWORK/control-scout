// Route-level error boundary: a page that throws while rendering shows a calm
// "this page hit a problem" state inside the shell (navigation keeps working),
// and the error is offered for reporting (src/lib/errorReporting.ts). Keyed by
// the path, so moving to another page starts fresh. "Try again" asks the server
// afresh for what the page read (a bad cached answer would only fail again).
//
// A page whose code didn't download (src/lib/chunkError.ts) can't be tried again in place: React keeps the
// failed import. It gets its own state, whose button reloads Control Scout (only when pressed). Unsent work
// kept on this device comes back after the reload; work that exists only on this page is named first, and the
// reload waits for a second press.
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, CloudOff, Home, RefreshCw } from "lucide-react";
import { EmptyState } from "./page";
import { Button } from "./ui/button";
import { captureError } from "../lib/errorReporting";
import { ApiReadsContext, forget } from "../lib/api";
import { appReload, isChunkLoadError, workOnlyOnThisPage } from "../lib/chunkError";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean; chunk: boolean }> {
  state = { failed: false, chunk: false };
  /** The API paths this page read (useApi registers them). */
  private reads = new Set<string>();
  private retry = () => { forget(this.reads); this.reads.clear(); this.setState({ failed: false, chunk: false }); };
  static getDerivedStateFromError(error: unknown) { return { failed: true, chunk: isChunkLoadError(error) }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    // A download that failed isn't a bug in the page: nothing to report.
    if (isChunkLoadError(error)) return;
    try { captureError(error, info.componentStack ?? undefined); } catch { /* never rethrow from here */ }
  }
  render() {
    if (!this.state.failed) return <ApiReadsContext.Provider value={this.reads}>{this.props.children}</ApiReadsContext.Provider>;
    if (this.state.chunk) return <ReloadNeeded />;
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

/** This page's code didn't download: reloading Control Scout fetches it again. */
function ReloadNeeded() {
  // Shared work only on this page, found when the button was pressed: named, and the reload waits for a second press.
  const [unsaved, setUnsaved] = useState(0);
  const reload = () => {
    const only = workOnlyOnThisPage();
    if (only && !unsaved) { setUnsaved(only); return; }
    appReload.run();
  };
  return (
    <EmptyState
      className="my-6"
      icon={CloudOff}
      title="This page didn't finish downloading"
      description="Part of Control Scout didn't arrive, perhaps a dropped connection or a new version going live. Reloading fetches it again; unsent scouting, notes and comments are kept on this device and carry on after the reload."
      action={
        <div className="flex flex-col items-center gap-3">
          {unsaved > 0 && (
            <p role="alert" className="max-w-md text-sm text-warning">
              {unsaved === 1 ? "1 change" : `${unsaved} changes`} to a shared pick list or comment couldn't be stored on this device, so a reload now loses {unsaved === 1 ? "it" : "them"}. Give {unsaved === 1 ? "it" : "them"} a moment to send or retry from Scout first, or reload anyway.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reload}><RefreshCw /> {unsaved ? "Reload anyway" : "Reload Control Scout"}</Button>
            <Button variant="outline" asChild><Link to="/"><Home /> Home</Link></Button>
          </div>
        </div>
      }
    />
  );
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
