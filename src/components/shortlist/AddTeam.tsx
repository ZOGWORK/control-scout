// Add a team to the shortlist from the Shortlist page itself: the app's team search (TeamPicker), with the
// teams already on the list marked in the results. A pick goes to the end of the personal bookmarks, the same
// list a team page's Shortlist button adds to (this device, synced when signed in). A number typed by hand is
// checked against the teams on record first, like Compare; with no signal it goes through.
import { useRef, useState } from "react";
import { usePersonal } from "../../lib/personal";
import { MAX_BOOKMARKS } from "../../shared/personal";
import { teamError } from "../../lib/teamCheck";
import { lookupTeamName } from "../TeamInput";
import { TeamPicker } from "../TeamPicker";
import { toast } from "../ui/sonner";

export function AddTeam({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const { state, update } = usePersonal();
  const list = state.bookmarks;
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(new Set<number>());
  const full = list.length >= MAX_BOOKMARKS;

  const add = async (team: number) => {
    if (list.includes(team) || pending.current.has(team)) { setError(`${team} is already on your shortlist.`); return; }
    pending.current.add(team);
    setChecking(true);
    let name: string | null | undefined;
    const err = await teamError(String(team), async (n) => (name = await lookupTeamName(n)));
    pending.current.delete(team);
    setChecking(pending.current.size > 0);
    if (err) { setError(err); input.current?.focus(); return; }
    setError(null);
    // Against the list as it is now: a team added meanwhile (another tab, a sync, another pick still
    // being checked) isn't added twice, and the list never grows past what it keeps.
    let outcome = "added" as "added" | "already" | "full", at = 0;
    const stored = update("bookmarks", (b) => {
      if (b.includes(team)) { outcome = "already"; return b; }
      if (b.length >= MAX_BOOKMARKS) { outcome = "full"; return b; }
      at = b.length;
      return [...b, team];
    });
    if (outcome === "already") { setError(`${team} is already on your shortlist.`); return; }
    if (outcome === "full") { setError(`The shortlist holds ${MAX_BOOKMARKS} teams: remove one to add another.`); return; }
    const who = name ? `${team} ${name}` : `Team ${team}`;
    const msg = `Added ${who} to your shortlist as pick ${at + 1}${stored === false ? ", but this device's storage is full, so it may not be kept" : ""}`;
    setSaid(msg);
    toast(msg, { action: { label: "Undo", onClick: () => update("bookmarks", (b) => b.filter((x) => x !== team)) } });
  };

  return (
    <div className={className}>
      <TeamPicker onPick={add} marked={list} markedLabel="On your shortlist" busy={checking} error={error} onEdit={() => { setError(null); setSaid(""); }}
        inputRef={input} autoFocus={autoFocus} disabled={full} className="w-full"
        label="Add a team to your shortlist" placeholder={full ? `The shortlist holds ${MAX_BOOKMARKS} teams: remove one to add another` : "Add a team: number or name"} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{said}</p>
    </div>
  );
}
