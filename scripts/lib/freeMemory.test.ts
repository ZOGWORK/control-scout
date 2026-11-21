// Memory a run can have (scripts/lib/freeMemory.mjs): macOS's vm_stat read as what it can take back at once.
import { describe, expect, it } from "vitest";
import { freeMb, vmStatMb } from "./freeMemory.mjs";

// vm_stat on amelia (Apple M4, 16 GB), 2026-11-17, while os.freemem() said 2,516 MB.
const AMELIA = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   155129.
Pages active:                                 335945.
Pages inactive:                               356815.
Pages speculative:                              6773.
Pages throttled:                                   0.
Pages wired down:                             144804.
Pages purgeable:                                4972.
"Translation faults":                      812345678.
Pages copy-on-write:                        12345678.
`;

describe("vmStatMb", () => {
  it("counts free, inactive, speculative and purgeable pages: what macOS gives back at once", () => {
    // (155129 + 356815 + 6773 + 4972) pages of 16 KB.
    expect(vmStatMb(AMELIA)).toBe(8183);
    // Active and wired pages are in use: never counted.
    expect(vmStatMb(AMELIA.replace("Pages active:                                 335945.", "Pages active:                                 1."))).toBe(8183);
  });
  it("reads 4 KB pages (Intel Macs), and is null for anything that isn't vm_stat's output", () => {
    expect(vmStatMb("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 262144.\nPages inactive: 262144.")).toBe(2048);
    expect(vmStatMb("")).toBeNull();
    expect(vmStatMb("vm_stat: command not found")).toBeNull();
  });
});

describe("freeMb", () => {
  it("is a whole number of MB on this computer", () => {
    expect(Number.isInteger(freeMb()) && freeMb() > 0).toBe(true);
  });
});
