// The app's optional background parts (syncs, prompts, the tour): each loads its own chunk after the page. If one of
// those downloads fails (a dropped connection before the service worker has it), that part is skipped and the page,
// navigation and every other part keep working; React would otherwise unmount the whole app. Each child gets its own
// boundary, so one failure doesn't take the others with it.
import { Children, Component, Suspense, type ReactNode } from "react";

class Skip extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("An optional part of the app didn't load:", error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function OptionalParts({ children }: { children: ReactNode }) {
  return <>{Children.map(children, (child) => <Skip><Suspense fallback={null}>{child}</Suspense></Skip>)}</>;
}
