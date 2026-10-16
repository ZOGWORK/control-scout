// Template validation (shared by the server's save and the editor): field by field, never all-or-nothing.
import { describe, expect, it } from "vitest";
import { cleanField, cleanFields, newFieldId, parseWorkspaceTemplateId, TEMPLATE_LIMITS, workspaceTemplateId } from "./scoutTemplate";

describe("cleanField", () => {
  it("clamps numbers and drops unknown properties", () => {
    expect(cleanField({ id: "a", label: "A", type: "counter", phase: "auto", max: 1e9, min: 5000, extra: 1 }, "match"))
      .toEqual({ field: { id: "a", label: "A", type: "counter", phase: "auto", max: TEMPLATE_LIMITS.counterMax, min: TEMPLATE_LIMITS.counterMax - 1 } });
    expect(cleanField({ id: "r", label: "R", type: "rating", phase: "overall", max: 1 }, "match")).toEqual({ field: { id: "r", label: "R", type: "rating", phase: "overall", max: 2 } });
    expect(cleanField({ id: "t", label: "T", type: "toggle", phase: "pit", options: ["x"], max: 4 }, "pit")).toEqual({ field: { id: "t", label: "T", type: "toggle", phase: "pit" } });
  });
  it("refuses what can't be used", () => {
    expect(cleanField({ id: "1bad", label: "A", type: "toggle", phase: "auto" }, "match")).toEqual({ reason: "bad id" });
    expect(cleanField({ id: "a", label: "   ", type: "toggle", phase: "auto" }, "match")).toEqual({ reason: "no label" });
    expect(cleanField({ id: "a", label: "A", type: "slider", phase: "auto" }, "match")).toEqual({ reason: "unknown type" });
    expect(cleanField({ id: "a", label: "A", type: "toggle", phase: "auto" }, "pit")).toEqual({ reason: "phase doesn't fit this kind" });
    expect(cleanField({ id: "a", label: "A", type: "choice", phase: "auto", options: ["One", "one"] }, "match")).toEqual({ reason: "a choice needs at least two options" });
  });
});

describe("cleanFields", () => {
  it("keeps the good fields when one is bad, and the first of a repeated id", () => {
    const r = cleanFields([
      { id: "a", label: "A", type: "toggle", phase: "auto" },
      null,
      { id: "a", label: "Again", type: "toggle", phase: "auto" },
      { id: "b", label: "B", type: "text", phase: "endgame" },
    ], "match");
    expect(r.fields.map((f) => f.id)).toEqual(["a", "b"]);
    expect(r.dropped).toEqual([{ index: 1, id: undefined, reason: "not a field" }, { index: 2, id: "a", reason: "repeated id" }]);
  });
  it("caps the number of fields; anything that isn't a list is empty", () => {
    const many = Array.from({ length: TEMPLATE_LIMITS.fields + 2 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: "toggle", phase: "pit" }));
    const r = cleanFields(many, "pit");
    expect(r.fields).toHaveLength(TEMPLATE_LIMITS.fields);
    expect(r.dropped).toHaveLength(2);
    expect(cleanFields("nope", "pit")).toEqual({ fields: [], dropped: [] });
  });
});

describe("ids", () => {
  it("workspace template ids round-trip; built-in ids aren't workspace ones", () => {
    expect(parseWorkspaceTemplateId(workspaceTemplateId("901", 2025, "pit"))).toEqual({ workspaceId: "901", season: 2025, kind: "pit" });
    expect(parseWorkspaceTemplateId("match-2025")).toBeNull();
    expect(parseWorkspaceTemplateId(undefined)).toBeNull();
  });
  it("new field ids never collide", () => {
    const first = newFieldId([], () => 0.5);
    expect(newFieldId([first], () => 0.5)).not.toBe(first);
  });
});
