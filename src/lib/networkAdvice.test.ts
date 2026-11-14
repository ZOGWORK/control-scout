// The Network & offline screen's words: the status sentence, the connection, and whether to use Lite, from the facts.
import { describe, expect, it } from "vitest";
import { adviseLite, connectionLabel, liteCookieOn, liteToggleHref, slowReason, statusSentence } from "./networkAdvice";

const base = { internet: "yes" as const, effectiveType: "4g", saveData: false, slowSeen: false, liteOn: false };

describe("status sentence", () => {
  it("online, offline, a Wi-Fi sign-in page, and not checked yet", () => {
    expect(statusSentence("yes")).toBe("You're online");
    expect(statusSentence("no")).toBe("You're offline");
    expect(statusSentence("portal")).toBe("This Wi-Fi isn't giving internet (it may need a sign-in page)");
    expect(statusSentence("unknown")).toBe("Checking your connection…");
  });
});

describe("connection", () => {
  it("Wi-Fi, mobile data, none, a cable, and the browsers that don't say", () => {
    expect(connectionLabel("wifi")).toBe("Wi-Fi");
    expect(connectionLabel("wifi", "ethernet")).toBe("Cable");
    expect(connectionLabel("cellular")).toBe("Mobile data");
    expect(connectionLabel("none")).toBe("None");
    expect(connectionLabel("unknown")).toBe("Your browser doesn't say");
  });
});

describe("should I use Lite?", () => {
  it("offline: downloads work, Lite needs a connection; no button", () => {
    expect(adviseLite({ ...base, internet: "no" })).toEqual({ kind: "offline", text: "You're offline: your downloaded packs work; Lite needs a connection.", action: null });
  });
  it("a Wi-Fi sign-in page: Lite can't load either, so it isn't offered", () => {
    const a = adviseLite({ ...base, internet: "portal", effectiveType: "2g" });
    expect(a.kind).toBe("portal");
    expect(a.action).toBeNull();
  });
  it("slow by the browser's measure (2g, 3g, slow-2g), Data Saver, or slow pages this visit: offers Lite", () => {
    for (const effectiveType of ["slow-2g", "2g", "3g"]) expect(adviseLite({ ...base, effectiveType })).toMatchObject({ kind: "slow", action: "on", text: "Your connection is slow: Lite loads a fraction of the data." });
    expect(adviseLite({ ...base, saveData: true }).kind).toBe("slow");
    expect(adviseLite({ ...base, slowSeen: true }).kind).toBe("slow");
  });
  it("slow with Lite already on: no button", () => {
    expect(adviseLite({ ...base, slowSeen: true, liteOn: true })).toMatchObject({ kind: "slow", action: null });
  });
  it("fine: the full app is best; with Lite on, offers to turn it off", () => {
    expect(adviseLite(base)).toEqual({ kind: "fine", text: "Your connection is fine: the full app is best.", action: null });
    expect(adviseLite({ ...base, effectiveType: null })).toMatchObject({ kind: "fine" });
    expect(adviseLite({ ...base, liteOn: true })).toMatchObject({ kind: "fine", action: "off" });
  });
  it("not checked yet: says so, no advice", () => {
    expect(adviseLite({ ...base, internet: "unknown" })).toMatchObject({ kind: "checking", action: null });
  });
  it("says why it's slow, the strongest evidence first", () => {
    expect(slowReason({ slowSeen: true, saveData: true, effectiveType: "2g" })).toMatch(/loaded slowly/);
    expect(slowReason({ slowSeen: false, saveData: true, effectiveType: "2g" })).toMatch(/Data Saver/);
    expect(slowReason({ slowSeen: false, saveData: false, effectiveType: "3g" })).toMatch(/browser says/);
    expect(slowReason({ slowSeen: false, saveData: false, effectiveType: "4g" })).toBeNull();
  });
});

describe("Lite on or off", () => {
  it("reads the cs-lite cookie", () => {
    expect(liteCookieOn("a=1; cs-lite=1")).toBe(true);
    expect(liteCookieOn("cs-lite-x=1; cs-lite=0")).toBe(false);
    expect(liteCookieOn("")).toBe(false);
  });
  it("switches through the server's /lite/on and /lite/off and comes back here, as the full app", () => {
    expect(liteToggleHref(true)).toBe("/lite/on?next=%2Fsettings%3Flite%3D0#network");
    expect(liteToggleHref(false)).toBe("/lite/off?next=%2Fsettings%3Flite%3D0#network");
  });
});
