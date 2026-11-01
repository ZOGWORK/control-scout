// Frozen snapshots are static HTML built from data people type (team names, pick-list notes): every value is
// escaped, nothing can run, and the snapshot time is printed in the page itself.
import { describe, expect, it } from "vitest";
import { clockIn, esc, picklistHtml } from "./snapshotHtml";
import type { EventDetail } from "../../src/shared/api";
import type { PickList } from "../../src/shared/picklist";

const ev = {
  event: { name: "Big <b>Meet</b>", timezone: "America/Chicago" },
  field: [{ team: 13, name: "<img src=x onerror=alert(1)>", rank: 2, opr: { np: 51.25, auto: null, teleop: null, endgame: null, pen: null } }],
} as unknown as EventDetail;
const list: PickList = { workspaceId: "3101", season: 2025, version: 4, picks: [
  { team: 13, rank: 1, addedBy: { accountId: 1, name: "Coach" }, addedAt: 0, note: "</td><script>steal()</script>", noteBy: { accountId: 1, name: "Coach" }, noteUpdatedAt: 1 },
] };

describe("snapshot HTML", () => {
  it("escapes every value from data, and runs nothing", () => {
    const html = picklistHtml(list, ev, { asOf: "2026-11-01T13:12:00Z", workspaceName: "Team \"Bolt\"" });
    expect(html).not.toMatch(/<script|<img/i); // as text only: &lt;img … &gt;
    expect(html).toContain("&lt;script&gt;steal()&lt;/script&gt;");
    expect(html).toContain("Big &lt;b&gt;Meet&lt;/b&gt;");
    expect(html).toContain("Team &quot;Bolt&quot;");
    expect(html).toContain("default-src 'none'");
  });

  it("says when it's from, in the event's own time zone, and that it may be stale", () => {
    const html = picklistHtml(list, ev, { asOf: "2026-11-01T13:12:00Z", workspaceName: "W" });
    expect(html).toMatch(/Snapshot from Nov 1, 7:12 AM CST · may be stale/);
    expect(html).toMatch(/check the live list before you pick/);
    expect(html).toContain("#2 · 51.3 OPR");
  });

  it("clockIn falls back to UTC when the zone is unknown", () => {
    expect(clockIn("2026-11-01T13:12:00Z", null)).toBe("Nov 1, 1:12 PM UTC");
    expect(esc(`<'&">`)).toBe("&lt;&#39;&amp;&quot;&gt;");
  });
});
