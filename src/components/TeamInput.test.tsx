// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamInput } from "./TeamInput";

afterEach(cleanup);

describe("TeamInput", () => {
  it("marks the field invalid and points it at the error message", () => {
    render(<TeamInput label="Your team number" value="" onChange={() => {}} error="Enter a team number." />);
    const input = screen.getByRole("textbox", { name: "Your team number" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = screen.getByRole("alert");
    expect(msg.textContent).toBe("Enter a team number.");
    expect(msg.className).toContain("text-destructive");
    expect(input.getAttribute("aria-describedby")).toBe(msg.id);
  });
  it("is not invalid without an error", () => {
    render(<TeamInput label="Add a team" value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Add a team" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
