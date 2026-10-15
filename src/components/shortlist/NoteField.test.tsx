// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoteField } from "./NoteField";

afterEach(cleanup);

describe("NoteField", () => {
  it("shows an inline, linked error when the note can't be stored, keeps the text, and retries", () => {
    const onSave = vi.fn<(text: string) => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<NoteField team={4215} value="" onSave={onSave} />);
    const input = screen.getByRole("textbox", { name: "Private note on team 4215" });
    fireEvent.change(input, { target: { value: "fast auto" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("fast auto");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const err = screen.getByRole("alert");
    expect(err.textContent).toMatch(/Not saved/);
    expect(input.getAttribute("aria-describedby")).toBe(err.id);
    expect((input as HTMLInputElement).value).toBe("fast auto");
    // The same text again: still unsaved, so it's sent again (and this time it's stored).
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has no error state when saving works", () => {
    const onSave = vi.fn(() => true);
    render(<NoteField team={1} value="" onSave={onSave} />);
    const input = screen.getByRole("textbox", { name: "Private note on team 1" });
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledOnce();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
});
