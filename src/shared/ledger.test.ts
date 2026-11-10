// @vitest-environment node
// The one ledger rule both cards read: last season's replay leads until a season has LIVE_THRESHOLD scored
// live calls (or a replay of REPLAY_HEADLINE_MIN), then that does; a card opens on that headline and says in
// words which mode it shows.
import { describe, expect, it } from "vitest";
import type { AccuracyBlock, TrackRecord } from "./api";
import { headlineRule, LIVE_THRESHOLD, ledgerDefault, liveCallsLine, liveProgress, pickHeadline, REPLAY_HEADLINE_MIN } from "./ledger";

const b = (n: number, accuracy = 0.7) => ({ n, accuracy }) as AccuracyBlock;
const season = (s: number, live: number | null, backtest: number | null) =>
  ({ season: s, label: `${s}–${String(s + 1).slice(2)}`, live: live == null ? null : b(live, 0.5), backtest: backtest == null ? null : b(backtest) });

describe("headline", () => {
  it("is the newest big-enough replay while no season has enough live calls", () => {
    const seasons = [season(2026, 33, 207), season(2025, null, 41743), season(2024, null, 36557)];
    expect(pickHeadline(seasons)).toEqual({ kind: "backtest", season: 2025, accuracy: 0.7, n: 41743 });
  });
  it("stays on last season's replay a few weeks into a season, while its live calls are still calibrating", () => {
    // Production on 2026-10-27: 681 live calls and 1,053 replayed matches for 2026–27, 41,743 replayed for 2025–26.
    const seasons = [season(2026, 681, 1053), season(2025, null, 41743)];
    expect(LIVE_THRESHOLD).toBe(10_000);
    expect(REPLAY_HEADLINE_MIN).toBe(10_000);
    expect(pickHeadline(seasons)).toEqual({ kind: "backtest", season: 2025, accuracy: 0.7, n: 41743 });
    expect(ledgerDefault({ headline: pickHeadline(seasons), seasons: seasons as TrackRecord["seasons"] })).toEqual({ season: 2025, kind: "backtest" });
  });
  it("switches to live at exactly the threshold", () => {
    expect(pickHeadline([season(2026, LIVE_THRESHOLD - 1, 50_000)])?.kind).toBe("backtest");
    expect(pickHeadline([season(2026, LIVE_THRESHOLD, 50_000)])).toMatchObject({ kind: "live", season: 2026, n: LIVE_THRESHOLD });
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
  it("names the replay that leads, why that season, and the live progress", () => {
    const t = { seasons, liveThreshold: LIVE_THRESHOLD, headline: pickHeadline(seasons) };
    expect(liveProgress(t)).toEqual({ season: 2026, label: "2026–27", n: 33 });
    expect(headlineRule(t)).toBe("The headline is the 2025–26 replay, the newest with at least 10,000 replayed matches. Live calls take over once a season has 10,000 scored (2026–27: 33 so far).");
  });
  it("says there is no headline (rather than that the replay leads) when neither sample is big enough", () => {
    const small = [season(2026, 33, 207)] as TrackRecord["seasons"];
    const t = { seasons: small, liveThreshold: LIVE_THRESHOLD, headline: pickHeadline(small) };
    expect(t.headline).toBeNull();
    expect(headlineRule(t)).toBe("No headline yet: a replay needs 10,000 matches and live calls 10,000 scored (2026–27: 33 so far), so this opens on the newest season's replay.");
  });
  it("names live when it leads", () => {
    const lived = [season(2026, 12_000, 20_000)] as TrackRecord["seasons"];
    expect(headlineRule({ seasons: lived, liveThreshold: LIVE_THRESHOLD, headline: pickHeadline(lived) })).toMatch(/^Live calls lead: 2026–27 has 12,000 scored/);
  });
});

describe("the live record beside a replay", () => {
  const live = (n: number, decided: number, accuracy: number, provisional: number): AccuracyBlock =>
    ({ n, decided, accuracy, brier: 0.2196, byTier: { provisional: { n: provisional, accuracy, brier: 0.22 }, moderate: { n: n - provisional, accuracy, brier: 0.16 }, confident: { n: 0, accuracy: 0, brier: 0 } } }) as unknown as AccuracyBlock;
  const at = (l: AccuracyBlock | null) => [{ season: 2026, label: "2026–27 BIOBUZZ", live: l, backtest: b(3459) }, { season: 2025, label: "2025–26 DECODE", live: null, backtest: b(41743) }] as TrackRecord["seasons"];
  it("names the slice, the sample, how early it is and that it isn't the card's figure yet", () => {
    expect(liveCallsLine({ seasons: at(live(2720, 2683, 0.6231830040998881, 2541)), liveThreshold: LIVE_THRESHOLD }))
      .toBe("Live calls made in advance, 2026–27 BIOBUZZ: 62.3% of 2,683 decided called right, Brier 0.2196 (early season: 93% of them rough guesses, so the figure is still moving). They lead the track record’s headline once 10,000 are scored (2,720 so far); this card always shows replays.");
  });
  it("says so when nothing is decided yet, and when live leads", () => {
    expect(liveCallsLine({ seasons: at(live(3, 0, 0, 3)), liveThreshold: LIVE_THRESHOLD })).toMatch(/^Live calls made in advance, 2026–27 BIOBUZZ: 3 scored, none decided yet/);
    expect(liveCallsLine({ seasons: at(live(12_000, 11_900, 0.7, 2000)), liveThreshold: LIVE_THRESHOLD })).toMatch(/70\.0% of 11,900 decided called right, Brier 0\.2196\. Past 10,000 scored, they lead the track record’s headline; this card still shows replays\.$/);
  });
  it("is nothing while no live call is scored", () => {
    expect(liveCallsLine({ seasons: at(null), liveThreshold: LIVE_THRESHOLD })).toBeNull();
  });
});
