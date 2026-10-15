import { describe, expect, it } from "vitest";
import { dragPosition, targetBoxes, targetIndex, type Box } from "./useReorder";

// Three rows, the middle one opened (taller), 0px gap.
const rows: Box[] = [
  { left: 0, top: 100, width: 600, height: 50 },
  { left: 0, top: 150, width: 600, height: 200 },
  { left: 0, top: 350, width: 600, height: 50 },
];
const list: Box = { left: 0, top: 100, width: 600, height: 300 };

describe("targetBoxes", () => {
  it("stacks rows in the new order from the first row's top, keeping each row's height", () => {
    const t = targetBoxes(rows, [1, 2, 3], [3, 1, 2], true, 0);
    expect(t.get(3)!.top).toBe(100);
    expect(t.get(1)!.top).toBe(150);
    expect(t.get(2)!.top).toBe(200);
  });

  it("gives each card the slot it moves to", () => {
    const cards: Box[] = [
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 120, top: 0, width: 100, height: 100 },
      { left: 0, top: 120, width: 100, height: 100 },
    ];
    const t = targetBoxes(cards, [7, 8, 9], [9, 7, 8], false, 0);
    expect(t.get(9)).toMatchObject({ left: 0, top: 0 });
    expect(t.get(7)).toMatchObject({ left: 120, top: 0 });
    expect(t.get(8)).toMatchObject({ left: 0, top: 120 });
  });
});

describe("targetIndex", () => {
  const at = (b: Box, top: number) => ({ ...b, top });
  it("passes a row once its leading edge crosses that row's middle", () => {
    expect(targetIndex(rows, 0, at(rows[0], 100), true)).toBe(0);
    expect(targetIndex(rows, 0, at(rows[0], 210), true)).toBe(1); // bottom 260 > 250, the opened row's middle
    expect(targetIndex(rows, 2, at(rows[2], 240), true)).toBe(1); // top 240 < 250
  });
});

describe("every pick is reachable with the drag held inside the list", () => {
  // Equal rows: the lowest a row can go is the last row's own place.
  const even: Box[] = [0, 1, 2, 3].map((i) => ({ left: 0, top: 100 + i * 60, width: 600, height: 50 }));
  const evenList: Box = { left: 0, top: 100, width: 600, height: 230 };
  const to = (bs: Box[], bounds: Box, from: number, top: number) => targetIndex(bs, from, { ...bs[from], ...dragPosition({ left: 0, top }, bs[from], bounds, true) }, true);

  it("the first row reaches the last pick, and the last row the first", () => {
    expect(to(even, evenList, 0, 9999)).toBe(3);
    expect(to(even, evenList, 3, -9999)).toBe(0);
  });

  it("an opened (taller) row reaches both ends", () => {
    expect(to(rows, list, 1, -9999)).toBe(0);
    expect(to(rows, list, 1, 9999)).toBe(2);
  });
});

describe("targetBoxes with an opened card", () => {
  // Two columns of 100px cards, 20px gaps; C is opened and spans both columns.
  const cards: Box[] = [
    { left: 0, top: 0, width: 100, height: 100 },
    { left: 120, top: 0, width: 100, height: 100 },
    { left: 0, top: 120, width: 220, height: 300 },
  ];
  it("puts a full-width card on a row of its own, never in a single column", () => {
    const t = targetBoxes(cards, [1, 2, 3], [2, 3, 1], false, 0);
    expect(t.get(2)).toMatchObject({ left: 0, top: 0 });
    expect(t.get(3)).toMatchObject({ left: 0, top: 120, width: 220 });
    expect(t.get(1)).toMatchObject({ left: 0, top: 440 });
  });
});

describe("dragPosition", () => {
  const me = rows[0];
  it("keeps a row in its column: no sideways movement", () => {
    expect(dragPosition({ left: 250, top: 200 }, me, list, true)).toEqual({ left: 0, top: 200 });
  });

  it("never lets a row leave the top or bottom of the list", () => {
    expect(dragPosition({ left: 0, top: -500 }, me, list, true).top).toBe(100);
    expect(dragPosition({ left: 0, top: 5000 }, me, list, true).top).toBe(350);
  });

  it("keeps a card inside the grid on every side", () => {
    const grid: Box = { left: 0, top: 0, width: 340, height: 220 };
    const card: Box = { left: 0, top: 0, width: 100, height: 100 };
    expect(dragPosition({ left: -80, top: -80 }, card, grid, false)).toEqual({ left: 0, top: 0 });
    expect(dragPosition({ left: 900, top: 900 }, card, grid, false)).toEqual({ left: 240, top: 120 });
  });

  it("an opened row taller than the rest still stays inside", () => {
    expect(dragPosition({ left: 40, top: 900 }, rows[1], list, true)).toEqual({ left: 0, top: 200 });
  });
});
