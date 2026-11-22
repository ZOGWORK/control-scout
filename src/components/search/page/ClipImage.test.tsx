// @vitest-environment jsdom
// A clip's picture: its own storyboard tile, cropped out of the sheet; the video's thumbnail when there's none or the
// sheet won't load.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClipImage } from "./ClipImage";

afterEach(cleanup);
const still = { src: "https://i.ytimg.com/sb/zDyuEfqXA7w/storyboard3_L3/M172.jpg?sigh=x", col: 1, row: 2, cols: 3, rows: 3 };

describe("ClipImage", () => {
  it("the tile, the sheet moved so it fills the frame", () => {
    const img = render(<ClipImage v={{ videoId: "zDyuEfqXA7w", still }} />).container.querySelector("[data-clip-still] img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(still.src);
    expect([img.style.width, img.style.height, img.style.left, img.style.top]).toEqual(["300%", "300%", "-100%", "-200%"]);
  });
  it("no tile, or a sheet that won't load: the video's thumbnail", () => {
    const a = render(<ClipImage v={{ videoId: "zDyuEfqXA7w" }} />).container;
    expect(a.querySelector("[data-clip-thumb]")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/zDyuEfqXA7w/hqdefault.jpg");
    cleanup();
    const b = render(<ClipImage v={{ videoId: "zDyuEfqXA7w", still }} />).container;
    fireEvent.error(b.querySelector("[data-clip-still] img")!);
    expect(b.querySelector("[data-clip-still]")).toBeNull();
    expect(b.querySelector("[data-clip-thumb]")).not.toBeNull();
  });
});
