// @vitest-environment node
// The one ledger rule both cards read: the season replay leads until a season has LIVE_THRESHOLD scored
// live calls, then live does; a card opens on that headline and says in words which mode it shows.
import { describe, expect, it } from "vitest";
import type { AccuracyBlock, TrackRecord } from "./api";
import { headlineRule, LIVE_THRESHOLD, ledgerDefault, liveProgress, pickHeadline, REPLAY_HEADLINE_MIN } from "./ledger";

const b = (n: number, accuracy = 0.7) => ({ n, accuracy }) as AccuracyBlock;
const season = (s: number, live: number | null, backtest: number | null) =>
  ({ season: s, label: `${s}–${String(s + 1).slice(2)}`, live: live == null ? null : b(live, 0.5), backtest: backtest == null ? null : b(backtest) });

describe("headline", () => {
  it("is the newest big-enough replay while no season has enough live calls", () => {
    const seasons = [season(2026, 33, 207), season(2025, null, 41743), season(2024, null, 36557)];
    expect(pickHeadline(seasons)).toEqual({ kind: "backtest", season: 2025, accuracy: 0.7, n: 41743 });
  });
  it("switches to live at exactly the threshold", () => {
    expect(pickHeadline([season(2026, LIVE_THRESHOLD - 1, 5000)])?.kind).toBe("backtest");
    expect(pickHeadline([season(2026, LIVE_THRESHOLD, 5000)])).toMatchObject({ kind: "live", season: 2026, n: LIVE_THRESHOLD });
  });
  it("is nothing when no sample is big enough, and the card then opens on the newest season's replay", () => {
    const seasons = [season(2026, 33, REPLAY_HEADLINE_MIN - 1)];
    expect(pickHeadline(seasons)).toBeNull();
    expect(ledgerDefault({ headline: null, seasons: seasons as TrackRecord["seasons"] })).toEqual({ season: 2026, kind: "backtest" });
    expect(ledgerDefault({ headline: null, seasons: [season(2026, 33, null)] as TrackRecord["seasons"] })).toEqual({ season: 2026, kind: "live" });
    expect(ledgerDefault({ headline: null, seasons: [] })).toBeNull();
  });
});

describe("the rule in words", () => {
  const seasons = [season(2026, 33, 207), season(2025, null, 41743)] as TrackRecord["seasons"];
  it("names the mode that leads and the live progress", () => {
    const t = { seasons, liveThreshold: 300, headline: pickHeadline(seasons) };
    expect(liveProgress(t)).toEqual({ season: 2026, label: "2026–27", n: 33 });
    expect(headlineRule(t)).toBe("The season replay leads until a season has 300 scored live calls (2026–27: 33 so far), then live does.");
    const lived = [season(2026, 450, 2000)] as TrackRecord["seasons"];
    expect(headlineRule({ seasons: lived, liveThreshold: 300, headline: pickHeadline(lived) })).toMatch(/^Live calls lead: 2026–27 has 450 scored/);
  });
});
