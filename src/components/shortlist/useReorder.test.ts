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
  it("counts the other rows whose middle is above the dragged row's middle", () => {
    expect(targetIndex(rows, 0, { x: 300, y: 120 }, true)).toBe(0);
    expect(targetIndex(rows, 0, { x: 300, y: 260 }, true)).toBe(1);
    expect(targetIndex(rows, 0, { x: 300, y: 390 }, true)).toBe(2);
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
