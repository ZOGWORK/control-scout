// @vitest-environment jsdom
// The globe's clicks (its own file: the world loads once per module, and the other AtlasMap tests load an empty one).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AtlasMap from "./AtlasMap";
import type { CountryTotal } from "../../shared/home";

describe("AtlasMap clicks", () => {
  // One small country in view at the globe's starting rotation.
  const topo = { type: "Topology", arcs: [[[-100, 30], [-100, 40], [-90, 40], [-90, 30], [-100, 30]]], objects: { countries: { type: "GeometryCollection", geometries: [{ type: "Polygon", id: "840", arcs: [[0]], properties: { name: "United States" } }] } } };
  const us = { code: "US", numeric: "840", name: "United States", listings: 9000, withResults: 0 } as unknown as CountryTotal;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => topo })));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("a mouse click on a country chooses it; a drag that ends on one doesn't", async () => {
    const onSelect = vi.fn();
    render(<AtlasMap mode="globe" countries={[us]} selected={null} onSelect={onSelect} onLoaded={() => {}} onError={() => {}} />);
    const globe = await screen.findByRole("img");
    const country = await waitFor(() => { const p = globe.querySelector("path title")?.parentElement; if (!p) throw new Error("not drawn"); return p; });
    fireEvent.pointerDown(globe, { pointerType: "mouse", button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(globe, { pointerType: "mouse" });
    fireEvent.click(country);
    expect(onSelect).toHaveBeenCalledWith("US");
    onSelect.mockClear();
    fireEvent.pointerDown(globe, { pointerType: "mouse", button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(globe, { pointerType: "mouse", clientX: 180, clientY: 150 });
    fireEvent.pointerUp(globe, { pointerType: "mouse" });
    fireEvent.click(country);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
