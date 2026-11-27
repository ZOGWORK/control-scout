// The channels FIRST's own event pages lead to for regions no watched channel covered (server/data/officialChannels.ts,
// 2026-11-27): FIRST in Michigan's numbered AV channels and The Orange Alliance, Washington's league streams, and the
// leagues and partners of Illinois, Minnesota, North Carolina, Ohio, Massachusetts, Oregon, Kentucky, Iowa and Florida.
// Each real upload below, with its YouTube facts and its Scout event as the live database gave them that day, lands
// on that event and day by the channel's own rule, and the same video is never taken by a channel of another region.
import { describe, expect, it } from "vitest";
import { matchVideo, parseRule, type WatchEvent, type WatchVideo } from "./officialMatch";
import { OFFICIAL_CHANNELS } from "../data/officialChannels";

type Row = [channel: string, title: string, start: string | null, published: string, durationS: number, event: Omit<WatchEvent, "country" | "parent" | "divisionCode"> & { divisionCode: string | null }, day: string];
const ROWS: Row[] = [
  ["UCGaAkLZcsB5f8VqY5wP7Sqw", "2025 MI FTC Ann Arbor Qualifier - Day 1", "2025-11-22T13:54:51Z", "2025-11-23T01:20:14Z", 39619, {"season":2025,"code":"USMIAAQ","name":"Ann Arbor Qualifier","type":"Qualifier","city":"Ann Arbor","state":"MI","start":"2025-11-21","end":"2025-11-22","timezone":"America/New_York","divisionCode":null,"playedDays":["2025-11-22"]}, "2025-11-22"],
  ["UCZr2X6KmlaHNgeufpopYwAw", "2025 MI FTC Michigan State Championship-SE - Woodie Flowers Division - Day 2", "2025-12-14T12:26:56Z", "2025-12-15T01:14:12Z", 35643, {"season":2025,"code":"USMICMPWF","name":"Michigan State Championship-SE - Woodie Flowers Division","type":"Championship","city":"Grand Blanc","state":"MI","start":"2025-12-12","end":"2025-12-14","timezone":"America/New_York","divisionCode":"USMICMP","playedDays":["2025-12-13","2025-12-14"]}, "2025-12-14"],
  ["UCkc2ktK7zNYJYz_-InEU3fg", "FTC Michigan State Championship Howell Marie Curie Day 2", "2023-12-17T12:57:47Z", "2023-12-18T01:31:41Z", 22350, {"season":2023,"code":"USMICMPCUR","name":"Michigan FTC State Championship-NW - Marie Curie Division","type":"Championship","city":"Howell","state":"MI","start":"2023-12-15","end":"2023-12-17","timezone":"America/New_York","divisionCode":"USMICMP","playedDays":["2023-12-16","2023-12-17"]}, "2023-12-17"],
  ["UCO3zuHQCzGfpBZqgeaJv52g", "2025 MI FTC Michigan State Championship-SE - Marie Curie Division - Day 2", "2025-12-14T12:24:23Z", "2025-12-14T22:13:14Z", 25818, {"season":2025,"code":"USMICMPMC","name":"Michigan State Championship-SE - Marie Curie Division","type":"Championship","city":"Grand Blanc","state":"MI","start":"2025-12-12","end":"2025-12-14","timezone":"America/New_York","divisionCode":"USMICMP","playedDays":["2025-12-13","2025-12-14"]}, "2025-12-14"],
  ["UCktZZel5mlxe94nxEhAkytg", "2024 MI Capital FTC League Tournament", "2024-12-08T13:41:03Z", "2024-12-08T22:06:33Z", 28811, {"season":2024,"code":"USMICPLT","name":"Capital League Tournament","type":"LeagueTournament","city":"Mason","state":"MI","start":"2024-12-07","end":"2024-12-08","timezone":"America/New_York","divisionCode":null,"playedDays":["2024-12-08"]}, "2024-12-08"],
  ["UCktZZel5mlxe94nxEhAkytg", "2024 MI Ann Arbor FTC Qualifier", null, "2024-11-14T17:54:33Z", 42518, {"season":2024,"code":"USMIAAQ","name":"Ann Arbor FTC Qualifier","type":"Qualifier","city":"Ann Arbor","state":"MI","start":"2024-11-08","end":"2024-11-09","timezone":"America/New_York","divisionCode":null,"playedDays":["2024-11-09"]}, "2024-11-09"],
  ["UCyDSbngDnW3ugJfXPXYjA9Q", "WA Salk League Meet 2 - Decode", "2025-11-15T19:10:09Z", "2025-11-15T23:52:46Z", 16245, {"season":2025,"code":"USWASAM2","name":"Salk League Meet 2","type":"LeagueMeet","city":"University Place","state":"WA","start":"2025-11-15","end":"2025-11-15","timezone":"America/Los_Angeles","divisionCode":null,"playedDays":["2025-11-15"]}, "2025-11-15"],
  ["UCyDSbngDnW3ugJfXPXYjA9Q", "Washington Championship - Into The Deep", "2025-02-01T18:38:22Z", "2025-02-02T06:47:56Z", 32224, {"season":2024,"code":"USWACMP","name":"Washington Championship","type":"Championship","city":"Seattle","state":"WA","start":"2025-02-01","end":"2025-02-01","timezone":"America/Los_Angeles","divisionCode":null,"playedDays":["2025-02-01"]}, "2025-02-01"],
  ["UCJ9bEunueYwsxLQDq9UqFVQ", "Illinois Suburban South League Tournament", "2026-02-14T16:00:54Z", "2026-02-15T03:04:19Z", 29550, {"season":2025,"code":"USILCSSLT","name":"Suburban South League Tournament","type":"LeagueTournament","city":"Flossmoor","state":"IL","start":"2026-02-14","end":"2026-02-14","timezone":"America/Chicago","divisionCode":null,"playedDays":["2026-02-14"]}, "2026-02-14"],
  ["UCyTMmdrAKfJLbTDMmbzm_Mg", "2024 FTC Vermillion League Meet 2", "2024-11-23T18:00:02Z", "2024-11-23T23:25:15Z", 18087, {"season":2024,"code":"USMNVRM2","name":"MN Lake Vermillion League Meet 2","type":"LeagueMeet","city":"Albertville","state":"MN","start":"2024-11-23","end":"2024-11-23","timezone":"America/Chicago","divisionCode":null,"playedDays":["2024-11-23"]}, "2024-11-23"],
  ["UCj1YSrNIfooAucIOFpciZHQ", "2025 Carolinas Premier Event - FIRST Tech Challenge - Day 1", "2025-07-26T13:59:07Z", "2025-07-26T22:16:49Z", 27735, {"season":2024,"code":"FPECA","name":"Carolinas Premier Event","type":"Premier","city":"Winston-Salem","state":"NC","start":"2025-07-25","end":"2025-07-27","timezone":"America/New_York","divisionCode":null,"playedDays":["2025-07-26","2025-07-27"]}, "2025-07-26"],
  ["UCMmmPHs2j9IIQKhAyfkCeSw", "FTC Centerstage Kirtland Qualifier", "2024-01-06T15:49:50Z", "2024-01-06T22:28:59Z", 22998, {"season":2023,"code":"USOHCLQ","name":"OH Kirtland Qualifier","type":"Qualifier","city":"Cleveland","state":"OH","start":"2024-01-05","end":"2024-01-06","timezone":"America/New_York","divisionCode":null,"playedDays":["2024-01-06"]}, "2024-01-06"],
  ["UC1qJHmuAXfEoPkc6j346Q1A", "Ohio FIRST Tech Challenge Centerstage Van Wert Qualifier", "2023-12-16T15:15:26Z", "2023-12-16T22:16:02Z", 24167, {"season":2023,"code":"USOHVWQ","name":"OH Van Wert Qualifier","type":"Qualifier","city":"Van Wert","state":"OH","start":"2023-12-16","end":"2023-12-16","timezone":"America/New_York","divisionCode":null,"playedDays":["2023-12-16"]}, "2023-12-16"],
  ["UCmoGHXAZID5sAf0SIWVQ_Mw", "MA FIRST Tech Challenge Battle of Lexington Qualifier - Into the Deep", "2025-02-15T15:43:10Z", "2025-02-15T22:07:34Z", 21604, {"season":2024,"code":"USMALEQ","name":"MA Battle of Lexington","type":"Qualifier","city":"Lexington","state":"MA","start":"2025-02-15","end":"2025-02-15","timezone":"America/New_York","divisionCode":null,"playedDays":["2025-02-15"]}, "2025-02-15"],
  ["UCObwvX6kjppRtlnao0F5IlA", "Midwestern League Meet 1 - FIRST Tech Challenge - November 16th, 2024 - #ftc #robotics #intothedeep", "2024-11-16T16:44:27Z", "2024-11-16T22:08:11Z", 18725, {"season":2024,"code":"USORMWM1","name":"Midwestern League Meet 1","type":"LeagueMeet","city":"Eugene","state":"OR","start":"2024-11-16","end":"2024-11-16","timezone":"America/Los_Angeles","divisionCode":null,"playedDays":["2024-11-16"]}, "2024-11-16"],
  ["UCeG7fGClF3lO2DOHoxIpJqg", "Run for the Robots - Man o' War Division Day 1", "2026-05-29T13:23:56Z", "2026-05-29T22:56:58Z", 32752, {"season":2025,"code":"FPERRMOW","name":"Run for the Robots Premier Event - Man o' War Division","type":"Premier","city":"Lexington","state":"KY","start":"2026-05-28","end":"2026-05-30","timezone":"America/New_York","divisionCode":"FPERR","playedDays":["2026-05-29","2026-05-30"]}, "2026-05-29"],
  ["UC8ccUqFD6wNYYVaFcM5rBXg", "FTC Iowa - Horace Pippin League Tournament", "2024-01-20T17:10:47Z", "2024-01-20T23:56:11Z", 22961, {"season":2023,"code":"USIAHPLT","name":"IA Horace Pippin League Tournament","type":"LeagueTournament","city":"West Burlington","state":"IA","start":"2024-01-20","end":"2024-01-20","timezone":"America/Chicago","divisionCode":null,"playedDays":["2024-01-20"]}, "2024-01-20"],
  ["UCnSd7SAxUFyL_DcA4PSf5fQ", "League Meet 1 • November 16, 2024", "2024-11-16T15:50:45Z", "2024-11-17T03:47:07Z", 20346, {"season":2024,"code":"USFLFLORM1","name":"Orlando Robotics League Meet #1","type":"LeagueMeet","city":"Orlando","state":"FL","start":"2024-11-16","end":"2024-11-16","timezone":"America/New_York","divisionCode":null,"playedDays":["2024-11-16"]}, "2024-11-16"],];

const seed = (id: string) => OFFICIAL_CHANNELS.find((c) => c.channelId === id);
const videoOf = (r: Row): WatchVideo => ({ videoId: "abcdefghijk", title: r[1], start: r[2], published: r[3], durationS: r[4], privacy: "public", embeddable: true, blockedIn: 0 });
const eventOf = (r: Row): WatchEvent => ({ ...r[5], country: "USA", parent: false });

describe("channels for regions FIRST's links lead to", () => {
  it("are each in the seed once, with a region rule that reads", () => {
    const ids = OFFICIAL_CHANNELS.map((c) => c.channelId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of new Set(ROWS.map((r) => r[0]))) {
      const c = seed(id);
      expect(c, id).toBeTruthy();
      expect(parseRule(c!.region), c!.region).toBeTruthy();
    }
    // FIRST in Michigan's twelve numbered channels.
    expect(OFFICIAL_CHANNELS.filter((c) => /^FIRST in Michigan \d+$/.test(c.title))).toHaveLength(12);
  });

  it.each(ROWS.map((r) => [r[5].code, r[1], r] as const))("%s: %s", (code, _title, r) => {
    const c = seed(r[0])!;
    const rule = { region: c.region, words: c.words ?? null, titlePattern: c.titlePattern ?? null };
    expect(matchVideo(videoOf(r), rule, [eventOf(r)])).toMatchObject({ kind: "add", event: { code }, day: r[6] });
    // Another state's channel never takes it.
    const other = r[5].state === "MI" ? seed("UCyDSbngDnW3ugJfXPXYjA9Q")! : seed("UCGaAkLZcsB5f8VqY5wP7Sqw")!;
    expect(matchVideo(videoOf(r), { region: other.region, words: other.words ?? null }, [eventOf(r)]).kind).not.toBe("add");
  });
});
