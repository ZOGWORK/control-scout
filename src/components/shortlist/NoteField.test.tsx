// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoteField } from "./NoteField";

afterEach(cleanup);

/**
 * Like the personal store: a save always updates the note in memory (`value`), and reaches the
 * device's storage (`stored`) only when the write isn't refused. `writes` lists each write's fate.
 */
function Store({ writes, onSave, memory = "", disk = "" }: { writes: boolean[]; onSave: (t: string) => void; memory?: string; disk?: string }) {
  const [value, setValue] = useState(memory);
  const [stored, setStored] = useState(disk);
  return <NoteField team={4215} value={value} stored={stored} onSave={(t) => { onSave(t); setValue(t.trim()); if (writes.shift() !== false) setStored(t.trim()); }} />;
}

const field = () => screen.getByRole("textbox", { name: "Private note on team 4215" }) as HTMLInputElement;
const type = (text: string) => { fireEvent.change(field(), { target: { value: text } }); fireEvent.keyDown(field(), { key: "Enter" }); };

describe("NoteField", () => {
  it("shows an inline, linked error when the note isn't stored, keeps the text, and retries", () => {
    const onSave = vi.fn();
    render(<Store writes={[false, true]} onSave={onSave} />);
    type("fast auto");
    expect(onSave).toHaveBeenLastCalledWith("fast auto");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    const err = screen.getByRole("alert");
    expect(err.textContent).toMatch(/Not saved/);
    expect(field().getAttribute("aria-describedby")).toBe(err.id);
    expect(field().value).toBe("fast auto");
    // Same text, still not stored: Enter sends it again, and this time it's stored.
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("typing back the stored text after a failure writes it over the failed edit", () => {
    const onSave = vi.fn();
    render(<Store writes={[false, true]} onSave={onSave} />);
    type("fast auto");
    type("");
    expect(onSave).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Escape after a failure puts the stored note back, in the field and in memory", () => {
    const onSave = vi.fn();
    render(<Store writes={[false, true]} onSave={onSave} memory="slow" disk="slow" />);
    type("fast auto");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onSave).toHaveBeenLastCalledWith("slow");
    expect(field().value).toBe("slow");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Escape shows what's really stored even when its own write is refused (memory then matches storage)", () => {
    render(<Store writes={[false, false]} onSave={() => {}} memory="slow" disk="slow" />);
    type("fast auto");
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("slow");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a fresh field (List/Grid switch, sign-in) shows a refused note from the store and can restore or retry it", () => {
    // The store's memory holds an edit the device refused; its storage still has the old note.
    const onSave = vi.fn();
    render(<Store writes={[true]} onSave={onSave} memory="fast auto" disk="slow" />);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(field(), { key: "Enter" }); // retry the unchanged text
    expect(onSave).toHaveBeenLastCalledWith("fast auto");
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(<Store writes={[true]} onSave={onSave} memory="fast auto" disk="slow" />);
    fireEvent.keyDown(field(), { key: "Escape" }); // or go back to what's stored
    expect(onSave).toHaveBeenLastCalledWith("slow");
    expect(field().value).toBe("slow");
  });

  it("with storage unreadable (stored unknown) it tracks nothing, and Escape never erases the note", () => {
    const onSave = vi.fn();
    render(<NoteField team={4215} value="fast auto" stored={undefined} onSave={onSave} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(field().value).toBe("fast auto");
  });

  it("has no error state when saving works", () => {
    const onSave = vi.fn();
    render(<Store writes={[true]} onSave={onSave} />);
    fireEvent.change(field(), { target: { value: "ok" } });
    fireEvent.blur(field());
    expect(onSave).toHaveBeenCalledOnce();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });
});
