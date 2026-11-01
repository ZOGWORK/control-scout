// Preview: an optimistic change (lib/optimistic) on the Assignments view, as the member who has team 18360. The list is
// live here (Done and Reopen change it), so a tap shows before its answer. ?tap=1 taps Done on 18360 once the page is
// up; ?answer=hold keeps the server's answer from ever coming (the moment before it, as on slow venue wifi) and
// ?answer=fail answers it with a 500 (rolled back, "Didn't save"). Without ?answer the request goes out as usual (the
// slow-4G Playwright check answers it). Sample names only. Dev only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page";
import { AssignmentsView } from "../../components/scout/Assignments";
import { applyNotice, type AssignmentsState } from "../../lib/assignments";
import type { MatchAssignmentsState } from "../../lib/slotAssignments";
import type { Assignment, AssignmentNotice } from "../../shared/assignments";

const SEASON = 2025, EVENT = "USMICHQ", ME = 1;
const NAMES: Record<number, string> = { 1: "Priya", 2: "Marcus", 3: "Jo" };
const TEAMS: Assignment[] = [[1, 18360, 3, "open"], [1, 7236, 2, "open"], [2, 21010, 0, "open"], [3, 9999, 4, "done"]].map(([who, team, progress, status], i) => ({
  id: i + 1, workspaceId: "preview", season: SEASON, eventCode: EVENT, team: team as number, assigneeAccountId: who as number, assigneeName: NAMES[who as number],
  createdByAccountId: 9, createdByName: "Coach Rivera", createdAt: Date.now() - 2 * 3_600_000, status: status as Assignment["status"], doneAt: null, doneByAccountId: null,
  doneByName: status === "done" ? NAMES[who as number] : null, version: 1, progress: progress as number,
}));
const noop = () => {};
const PATCH = /\/api\/scout\/workspaces\/preview\/assignments\/\d+$/;

/** ?answer=: what the preview's own server says to a status change (nothing else is touched). */
function useAnswer(answer: string | null) {
  useEffect(() => {
    if (answer !== "hold" && answer !== "fail") return;
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? "GET").toUpperCase() !== "PATCH" || !PATCH.test(new URL(url, location.href).pathname)) return real(input, init);
      if (answer === "hold") return new Promise<Response>(() => {});
      return new Promise<Response>((ok) => setTimeout(() => ok(new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "Content-Type": "application/json" } })), 300));
    };
    return () => { window.fetch = real; };
  }, [answer]);
}

export default function OptimisticPreview() {
  const [sp] = useSearchParams();
  useAnswer(sp.get("answer"));
  const [list, setList] = useState(TEAMS);
  const apply = useCallback((n: AssignmentNotice) => setList((cur) => applyNotice(cur, n, SEASON)), []);
  const teams = useMemo<AssignmentsState>(() => ({ list, loading: false, error: null, reload: noop, apply }), [list, apply]);
  const match = useMemo<MatchAssignmentsState>(() => ({ list: [], loading: false, error: null, reload: noop, apply: noop }), []);
  const tap = sp.get("tap") === "1";
  useEffect(() => {
    if (!tap) return;
    const t = setTimeout(() => {
      const card = [...document.querySelectorAll("li")].find((li) => li.querySelector("a")?.textContent === "18360");
      [...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Done")?.click();
    }, 200);
    return () => clearTimeout(t);
  }, [tap]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Assignments" description="Gearheads · 2025" />
      <AssignmentsView space="preview" workspaceName="Gearheads" season={SEASON} defaultEvent={EVENT} state={teams} matchState={match}
        myAccountId={ME} isAdmin={false} localEntries={[]} onScout={noop} />
    </div>
  );
}
