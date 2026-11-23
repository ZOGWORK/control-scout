// @vitest-environment jsdom
// The owner console's Discord bot panel: a server without a cap reads "No cap", a blank save means no cap (it clears
// the server's row instead of writing an own-cap row with nothing in it), a 409 means someone else already cleared it
// and the panel refreshes, and the cap form stays up even when no server is listed.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDiscordLimits } from "../../shared/discordLimits";
import { ApiError } from "../../lib/api";

const GUILD = "111111111111111111";
const NO_CAP: OwnerDiscordLimits = {
  servers: [{ guild: GUILD, perHour: null, perDay: null, custom: false, usedHour: 0, usedDay: 0, follows: 2, lastAsk: null, updatedBy: null, updatedAt: null }],
  defaultLimit: { perHour: null, perDay: null },
};
const h = vi.hoisted(() => ({
  data: null as unknown as OwnerDiscordLimits,
  reload: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
const apiFetch = vi.fn();

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: h.data, error: undefined, loading: false, reload: h.reload }),
  apiFetch: (url: string, init?: unknown) => apiFetch(url, init),
  prime: vi.fn(),
}));
vi.mock("../ui/sonner", () => ({ toast: { success: h.success, error: h.error } }));

const { DiscordPanel } = await import("./DiscordPanel");

beforeEach(() => {
  h.data = NO_CAP;
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(NO_CAP);
  for (const fn of [h.reload, h.success, h.error]) fn.mockClear();
});
afterEach(cleanup);

const fillAndSave = (hour: string, day: string) => {
  render(<DiscordPanel />);
  fireEvent.change(screen.getByLabelText("Server id"), { target: { value: GUILD } });
  fireEvent.change(screen.getByLabelText("Chats an hour"), { target: { value: hour } });
  fireEvent.change(screen.getByLabelText("Chats a day"), { target: { value: day } });
  fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
};
const lastCall = () => apiFetch.mock.calls[0] as [string, { method?: string; json?: unknown }];

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
    const [url, init] = lastCall();
    expect(url).toBe(`/api/owner/discord/limits/${GUILD}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.json).toEqual({});
  });

  it("sets a cap when either window has a number", async () => {
    fillAndSave("60", "");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [url, init] = lastCall();
    expect(url).toBe(`/api/owner/discord/limits/${GUILD}`);
    expect(init?.method).toBe("PUT");
    expect(init?.json).toEqual({ perHour: 60, perDay: null });
  });

  it("turns a 409 on a blank save into the success it asked for, refreshes and clears the form", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "That server has no cap of its own"));
    fillAndSave("", "");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("That server already has no cap."));
    expect(h.error).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalled();
    expect((screen.getByLabelText("Server id") as HTMLInputElement).value).toBe("");
  });

  it("keeps the cap form when no server is listed: clearing the last cap must not take the way to set one", () => {
    h.data = { servers: [], defaultLimit: { perHour: null, perDay: null } };
    render(<DiscordPanel />);
    expect(screen.getByText("No servers yet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Give a server its own cap" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save cap" })).toBeTruthy();
  });
});
