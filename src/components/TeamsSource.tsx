// The event page's source line: where the team list on the page comes from and when it was read. It never names a
// source the list isn't from: FIRST's list, FTC Scout's when FIRST couldn't serve the event, FTC New Jersey's
// provisional list before FIRST publishes one, or FIRST with no teams published yet.
import type { EventDetail } from "../shared/api";
import { ago } from "../lib/format";

/** A read older than this, on an event that isn't over, is said to be out of date. */
export const STALE_SYNC_MS = 36 * 3600_000;

export function TeamsSource({ d, provisional, now = Date.now() }: { d: EventDetail; provisional: boolean; now?: number }) {
  const e = d.event;
  // Absent (saved data, an older server): the time isn't known, which is not the same as never synced.
  const at = provisional ? d.provisional?.fetchedAt : d.teamsSyncedAt;
  const known = at !== undefined;
  const stale = known && e.status !== "finished" && (!at || now - Date.parse(at) > STALE_SYNC_MS);
  // FIRST's registrations are FIRST's list whatever the event's last full fetch came from.
  const source = provisional ? "FTC New Jersey · provisional, FIRST has not published teams yet"
    : e.source === "ftc-scout" && d.field.length && !d.registered ? "FTC Scout (FIRST couldn't serve this event)"
    : d.field.length || d.sharedSessions ? "FIRST Events API" : "FIRST Events API · no teams published yet";
  return (
    <p className="mt-3 text-[11px] text-muted-foreground" data-teams-source>
      Source: {source}
      {known && <> · {at ? <>{provisional ? "read" : d.field.length ? "last synced" : "last checked"} <time dateTime={at} title={new Date(at).toLocaleString()}>{ago(at)}</time></> : "not synced yet"}</>}
      {stale && <span className="text-warning"> · may be out of date</span>}
    </p>
  );
}
