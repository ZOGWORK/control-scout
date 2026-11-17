// @vitest-environment jsdom
// The profile picture: the picture when there is one, the first initial when there isn't or it fails to load, and
// a video credit shows it next to the contributor's name.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserAvatar } from "./UserAvatar";
import { VideoCredit } from "./contributors/VideoCredit";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null }) }));
vi.mock("./AccountSetup", () => ({ useAccountSetup: () => ({ ensure: async () => true }) }));
vi.mock("./layout/AccountMenu", () => ({ useOpenSignIn: () => () => {} }));

afterEach(cleanup);

describe("UserAvatar", () => {
  it("shows the picture, then the initial when it can't load", () => {
    const { container } = render(<UserAvatar url="/api/avatars/7/abc" name="parthiv" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/avatars/7/abc");
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("P");
  });

  it("shows the initial with no picture, hidden from screen readers unless labelled", () => {
    const { container } = render(<UserAvatar name="ada" />);
    expect(container.textContent).toBe("A");
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    render(<UserAvatar name="ada" label="Your profile picture" />);
    expect(screen.getByRole("img", { name: "Your profile picture" })).toBeTruthy();
  });
});

describe("VideoCredit", () => {
  it("puts the contributor's picture next to their name", () => {
    const { container } = render(
      <MemoryRouter>
        <VideoCredit c={{ id: 1, name: "Parthiv", verified: true, profile: "/contributors/parthiv", avatar: "/api/avatars/3/xyz", likes: 2, liked: false, mine: false }} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-video-credit] img")?.getAttribute("src")).toBe("/api/avatars/3/xyz");
    expect(container.textContent).toContain("Video by Parthiv");
  });
});
