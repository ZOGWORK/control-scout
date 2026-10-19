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
});
