// This visit's data: the browser's own transferSize, summed; nothing claimed where the browser doesn't measure it.
import { afterEach, describe, expect, it } from "vitest";
import { addEntries, dataUsed, resetDataUse } from "./dataUse";

afterEach(resetDataUse);

describe("data used this visit", () => {
  it("sums the page load and every file and request", () => {
    addEntries([{ transferSize: 12_000 } as PerformanceEntry & { transferSize: number }, { transferSize: 0 } as never, { transferSize: 1_188_000 } as never]);
    expect(dataUsed()).toBe(1_200_000);
  });
  it("says nothing when the browser gives no sizes", () => {
    addEntries([{ name: "x" } as PerformanceEntry]);
    expect(dataUsed()).toBeNull();
  });
});
