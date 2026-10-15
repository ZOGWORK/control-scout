// "Something broke — report it?": the non-blocking prompt shown when the app
// catches an error (src/lib/errorReporting.ts). One tap on Report sends the
// sanitized report; Dismiss sends nothing. It sits just under the top bar
// (right-hand side from md up), so it never covers the phone tab bar, the
// privacy banner or a page's sticky action bar, which all live at the bottom.
// Esc inside it dismisses.
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bug, Check, X } from "lucide-react";
import { Button } from "../ui/button";
import { clearPrompt, disableReporting, sendReport, usePendingReport, type SendResult } from "../../lib/errorReporting";

type Phase = "ask" | "sending" | SendResult;

const DONE: Record<Exclude<Phase, "ask" | "sending">, string> = {
  sent: "Thanks, it's reported.",
  limited: "Thanks, we already have several reports from you this hour.",
  failed: "Couldn't send it just now.",
};

function Prompt() {
  const report = usePendingReport();
  const [phase, setPhase] = useState<Phase>("ask");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new prompt always starts by asking.
  useEffect(() => { if (report) setPhase("ask"); }, [report]);

  const close = () => { window.clearTimeout(timer.current); clearPrompt(); };
  const send = () => {
    if (!report || phase !== "ask") return;
    setPhase("sending");
    void sendReport(report).then((r) => {
      setPhase(r);
      timer.current = window.setTimeout(close, r === "failed" ? 4000 : 2500);
    });
  };

  return (
    <AnimatePresence>
      {report && (
        <motion.section
          role="region" aria-label="Error report" aria-live="polite"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: "easeOut" }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
          data-error-report-prompt=""
          className="fixed inset-x-3 top-[calc(3rem+0.75rem)] z-[70] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] md:inset-x-auto md:right-4 md:w-[22rem]"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-danger/15 text-danger" aria-hidden>
              {phase === "sent" || phase === "limited" ? <Check className="size-4" /> : <Bug className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-foreground">
                {phase === "ask" || phase === "sending" ? "Something broke — report it?" : DONE[phase]}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {phase === "failed" ? "Nothing else is affected. You can send one from Settings later."
                  : phase === "sent" || phase === "limited" ? "We'll look into it."
                  : "Sends the error, the page and your browser version. Never your notes or personal details."}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-10" aria-label="Close" onClick={close}><X /></Button>
          </div>
          {(phase === "ask" || phase === "sending") && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={close} disabled={phase === "sending"}>Dismiss</Button>
              <Button size="sm" className="max-sm:h-10" onClick={send} disabled={phase === "sending"}>{phase === "sending" ? "Sending…" : "Report"}</Button>
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** If the prompt itself ever fails to render, it switches reporting off for this page load instead of looping. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { try { disableReporting(); } catch { /* nothing more to do */ } }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ErrorReportPrompt() {
  return <Guard><Prompt /></Guard>;
}
