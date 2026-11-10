// The shared event forecast's refusals: a before-the-event view of an event with no start date is unsupported (422),
// never reported as ratings still loading (503).
import { describe, expect, it, vi } from "vitest";

const preEvent = vi.fn(() => null);
vi.mock("../api/events.js", () => ({
  eventDetail: async () => ({ event: { name: "No Date Meet", start: null, end: null, status: "upcoming" }, field: [], matches: [], alliances: [], forecastUnsupported: null }),
  toEventInput: () => ({ start: null }),
}));
vi.mock("./engine.js", () => ({ dataVersion: async () => "d", liveVersion: async () => "l", liveForecaster: async () => ({ preEventForecast: preEvent, forecast: () => null }) }));
vi.mock("../caches.js", () => ({ registerCache: () => {} }));
const { eventForecast, ForecastUnavailable } = await import("./eventForecast");

describe("eventForecast", () => {
  it("a before-the-event view of an event with no start date: 422, said why, nothing simulated", async () => {
    const e = await eventForecast(2025, "USNODATE", null, "pre-event").catch((x) => x);
    expect(e).toBeInstanceOf(ForecastUnavailable);
    expect(e).toMatchObject({ status: 422, message: "USNODATE has no start date, so there's no before-the-event view of it." });
    expect(preEvent).not.toHaveBeenCalled();
  });
});
