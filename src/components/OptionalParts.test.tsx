// @vitest-environment jsdom
import { lazy } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OptionalParts } from "./OptionalParts";

afterEach(() => vi.restoreAllMocks());

describe("OptionalParts", () => {
  it("skips a part whose download fails and keeps the rest of the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const Fine = lazy(() => Promise.resolve({ default: () => <p>sync ready</p> }));
    render(
      <main>
        <h1>Home</h1>
        <OptionalParts>
          <Broken />
          <Fine />
        </OptionalParts>
      </main>,
    );
    expect(await screen.findByText("sync ready")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
  });
  it("mounts nothing until the page has loaded and gone idle: its chunks never share the start with the page's own", async () => {
    const Part = () => <p>part</p>;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    try {
      render(<OptionalParts><Part /></OptionalParts>);
      await new Promise((r) => setTimeout(r, 300));
      expect(screen.queryByText("part")).toBeNull();
      window.dispatchEvent(new Event("load"));
      expect(await screen.findByText("part")).toBeTruthy();
    } finally { delete (document as { readyState?: unknown }).readyState; }
  });
});
