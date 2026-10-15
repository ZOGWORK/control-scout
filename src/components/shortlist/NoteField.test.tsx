// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoteField } from "./NoteField";

afterEach(cleanup);

/** Like the personal store: the value updates in memory even when this device can't store it. */
function Parent({ results, onSave }: { results: boolean[]; onSave: (t: string) => void }) {
  const [value, setValue] = useState("");
  return <NoteField team={4215} value={value} onSave={(t) => { onSave(t); setValue(t.trim()); return results.shift() ?? true; }} />;
}

const field = () => screen.getByRole("textbox", { name: "Private note on team 4215" }) as HTMLInputElement;

describe("NoteField", () => {
  it("shows an inline, linked error when the note can't be stored, keeps the text, and retries", () => {
    const onSave = vi.fn();
    render(<Parent results={[false, true]} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "fast auto" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSave).toHaveBeenLastCalledWith("fast auto");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    const err = screen.getByRole("alert");
    expect(err.textContent).toMatch(/Not saved/);
    expect(field().getAttribute("aria-describedby")).toBe(err.id);
    expect(field().value).toBe("fast auto");
    // The store echoed the unsaved text back as `value`; it still isn't saved, so Enter sends it again.
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Escape after a failure puts the stored note back, in the field and the store", () => {
    const onSave = vi.fn();
    render(<Parent results={[false]} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "fast auto" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onSave).toHaveBeenLastCalledWith("");
    expect(field().value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("typing back the stored text after a failure replaces the failed edit in the store", () => {
    const onSave = vi.fn();
    render(<Parent results={[false]} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "fast auto" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("");
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has no error state when saving works", () => {
    const onSave = vi.fn();
    render(<Parent results={[true]} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "ok" } });
    fireEvent.blur(field());
    expect(onSave).toHaveBeenCalledOnce();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });
});
