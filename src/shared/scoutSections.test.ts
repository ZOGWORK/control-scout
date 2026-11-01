import { describe, expect, it } from "vitest";
import { legacyScoutUrl, picklistQuery, sectionFromUrl } from "./scoutSections";

const url = (s: string) => new URLSearchParams(s);

describe("sectionFromUrl", () => {
  it("reads the new sections", () => {
    expect(sectionFromUrl(url("tab=event"))).toBe("event");
    expect(sectionFromUrl(url("tab=entries"))).toBe("entries");
    expect(sectionFromUrl(url("tab=planning"))).toBe("planning");
  });
  it("opens the section a view belongs to, old links included", () => {
    for (const v of ["picklist", "assignments", "alliance", "activity", "template"]) expect(sectionFromUrl(url(`view=${v}`))).toBe("planning");
    expect(sectionFromUrl(url("view=entries"))).toBe("entries");
    expect(sectionFromUrl(url("tab=data&view=recordings"))).toBe("entries");
    expect(sectionFromUrl(url("tab=data&view=pit"))).toBe("event");
    expect(sectionFromUrl(url("view=nonsense"))).toBe("entries");
  });
  it("maps the old tabs: Scout and its match list to Event day, Data to Entries", () => {
    expect(sectionFromUrl(url("tab=match"))).toBe("event");
    expect(sectionFromUrl(url("tab=matches"))).toBe("event");
    expect(sectionFromUrl(url("tab=data"))).toBe("entries");
  });
  it("opens a linked entry under Entries, a read-only space on Entries, and everything else on Event day", () => {
    expect(sectionFromUrl(url("entry=abc&space=personal"))).toBe("entries");
    expect(sectionFromUrl(url(""), true)).toBe("entries");
    expect(sectionFromUrl(url(""))).toBe("event");
    expect(sectionFromUrl(url("tab=nonsense"))).toBe("event");
  });
});

describe("legacyScoutUrl", () => {
  it("leaves new URLs alone", () => {
    expect(legacyScoutUrl(url("tab=event&at=Q3"))).toBeNull();
    expect(legacyScoutUrl(url("space=7&view=picklist"))).toBeNull();
    expect(legacyScoutUrl(url(""))).toBeNull();
  });
  it("rewrites the old tabs, keeping everything else", () => {
    expect(legacyScoutUrl(url("tab=match&at=Q12&space=7"))?.toString()).toBe("tab=event&at=Q12&space=7");
    expect(legacyScoutUrl(url("tab=matches&list=1"))?.toString()).toBe("tab=event");
    expect(legacyScoutUrl(url("tab=data&view=picklist&season=2025"))?.toString()).toBe("tab=planning&view=picklist&season=2025");
    expect(legacyScoutUrl(url("tab=data&team=21010&q=fast"))?.toString()).toBe("tab=entries&team=21010&q=fast");
  });
  it("sends the old pit view to Event day's pit queue and the old setup screen to the event picker", () => {
    expect(legacyScoutUrl(url("tab=data&view=pit"))?.toString()).toBe("tab=event");
    expect(legacyScoutUrl(url("tab=match&setup=1"))?.toString()).toBe("tab=event&pick=1");
  });
});

describe("picklistQuery", () => {
  it("links to the pick list under Pick list & planning", () => {
    expect(picklistQuery("7", "2025").toString()).toBe("space=7&tab=planning&view=picklist&season=2025");
    expect(picklistQuery(null, null).toString()).toBe("tab=planning&view=picklist");
  });
});
