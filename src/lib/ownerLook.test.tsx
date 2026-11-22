// @vitest-environment jsdom
// The classic look is the owner's alone (src/lib/ownerLook.tsx): a device in it goes back to the new look once the
// server has said the visitor isn't the owner, never before, never on the offline copy, never for the owner.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const who = vi.hoisted(() => ({ user: null as { isOwner?: true } | null, accountAnswered: true, offlineAccount: false }));
const look = vi.hoisted(() => ({ v8: false, setV8: vi.fn() }));
vi.mock("./personal", () => ({ usePersonal: () => who }));
vi.mock("./v8", () => ({ isV8: () => look.v8, setV8: look.setV8 }));
const { OwnerOnlyClassicLook, withoutLookParam } = await import("./ownerLook");

afterEach(() => { cleanup(); sessionStorage.clear(); look.setV8.mockClear(); look.v8 = false; Object.assign(who, { user: null, accountAnswered: true, offlineAccount: false }); });

describe("OwnerOnlyClassicLook", () => {
  it("turns a visitor's or a signed-in non-owner's classic look back into the new one", () => {
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).toHaveBeenCalledWith(true, "/");
    cleanup(); look.setV8.mockClear(); sessionStorage.clear();
    Object.assign(who, { user: {} });
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).toHaveBeenCalledWith(true, "/");
  });

  it("leaves the owner's classic look alone", () => {
    Object.assign(who, { user: { isOwner: true } });
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).not.toHaveBeenCalled();
  });

  it("waits for the server's answer, and never acts on the offline copy", () => {
    Object.assign(who, { accountAnswered: false });
    render(<OwnerOnlyClassicLook />);
    cleanup();
    Object.assign(who, { accountAnswered: true, offlineAccount: true });
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).not.toHaveBeenCalled();
  });

  it("does nothing in the new look", () => {
    look.v8 = true;
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).not.toHaveBeenCalled();
  });

  it("reloads without ?v8= (index.html obeys it on every load: with ?v8=0 left on, the page reloaded forever)", () => {
    expect(withoutLookParam("https://controlscout.org/events?v8=0")).toBe("/events");
    expect(withoutLookParam("https://controlscout.org/events?season=2025&v8=0&q=x#top")).toBe("/events?season=2025&q=x#top");
    expect(withoutLookParam("https://controlscout.org/teams/16236")).toBe("/teams/16236");
  });

  it("tries once per tab, so nothing can ever make it a loop", () => {
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).toHaveBeenCalledTimes(1);
    cleanup();
    render(<OwnerOnlyClassicLook />);
    expect(look.setV8).toHaveBeenCalledTimes(1);
  });
});
