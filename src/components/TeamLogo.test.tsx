// @vitest-environment jsdom
// The team logo (src/components/TeamLogo.tsx): nothing at all while the owner's teamLogos switch is off; a fixed,
// lazy, decorative square from /api/team-logos while it's on.
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TeamLogo, WithTeamLogo } from "./TeamLogo";

afterEach(() => act(() => resetFlags({ ...DEFAULT_FLAGS }, true)));

describe("TeamLogo", () => {
  it("starts off: no image, no request, the number drawn as before", () => {
    expect(DEFAULT_FLAGS.teamLogos).toBe(false);
    const { container } = render(<p><TeamLogo team={4215} /><WithTeamLogo team={4215}><span>4215</span></WithTeamLogo></p>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toBe("<p><span>4215</span></p>");
  });

  it("switched on: a lazy, decorative, fixed-size image of the team's logo", () => {
    act(() => resetFlags({ ...DEFAULT_FLAGS, teamLogos: true }, true));
    const { container } = render(<WithTeamLogo team={4215} size={14}><span>4215</span></WithTeamLogo>);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/team-logos/4215");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["14", "14"]);
    expect(container.textContent).toBe("4215");
  });

  it("a picture that failed is hidden, and a different team in the same place tries again", () => {
    act(() => resetFlags({ ...DEFAULT_FLAGS, teamLogos: true }, true));
    const { container, rerender } = render(<TeamLogo team={1} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")!.classList.contains("invisible")).toBe(true);
    rerender(<TeamLogo team={2} />);
    expect(container.querySelector("img")!.classList.contains("invisible")).toBe(false);
  });
});
