// @vitest-environment jsdom
// The owner console's Discord bot panel: a server without a cap reads "No cap", and a blank save means no cap —
// it clears the server's row instead of writing an own-cap row with nothing in it (a P2 from review).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnerDiscordLimits } from "../../shared/discordLimits";

const GUILD = "111111111111111111";
const DATA: OwnerDiscordLimits = {
  servers: [{ guild: GUILD, perHour: null, perDay: null, custom: false, usedHour: 0, usedDay: 0, follows: 2, lastAsk: null, updatedBy: null, updatedAt: null }],
  defaultLimit: { perHour: null, perDay: null },
};
const apiFetch = vi.fn(async (_url: string, _init?: { method?: string; json?: unknown }) => DATA);

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: DATA, error: undefined, loading: false, reload: () => {} }),
  apiFetch: (url: string, init?: { method?: string; json?: unknown }) => apiFetch(url, init),
  prime: vi.fn(),
}));
vi.mock("../ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DiscordPanel } = await import("./DiscordPanel");

afterEach(() => { cleanup(); apiFetch.mockClear(); });

const fillAndSave = (hour: string, day: string) => {
  render(<DiscordPanel />);
  fireEvent.change(screen.getByLabelText("Server id"), { target: { value: GUILD } });
  fireEvent.change(screen.getByLabelText("Chats an hour"), { target: { value: hour } });
  fireEvent.change(screen.getByLabelText("Chats a day"), { target: { value: day } });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
};

describe("the owner console's Discord bot panel", () => {
  it("reads a server without a cap as No cap, with nothing to clear", () => {
    render(<DiscordPanel />);
    expect(screen.getByText("No cap")).toBeTruthy();
    expect(screen.queryByText("Back to default")).toBeNull();
    expect(screen.getByRole("heading", { name: "Discord bot" })).toBeTruthy();
  });

  it("saves a blank pair as no cap: it clears the row instead of writing an empty own cap", async () => {
    fillAndSave("", "");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe(`/api/owner/discord/limits/${GUILD}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.json).toEqual({});
  });

  it("sets a cap when either window has a number", async () => {
    fillAndSave("60", "");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe(`/api/owner/discord/limits/${GUILD}`);
    expect(init?.method).toBe("PUT");
    expect(init?.json).toEqual({ perHour: 60, perDay: null });
  });
});
