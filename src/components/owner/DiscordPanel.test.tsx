// @vitest-environment jsdom
// The owner console's Discord bot panel: a server without a cap reads "No cap", a blank save means no cap (it clears
// the server's row instead of writing an own-cap row with nothing in it), a 409 means someone else already cleared it
// and the panel refreshes, and the cap form stays up even when no server is listed.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDiscordLimits } from "../../shared/discordLimits";
import { ApiError } from "../../lib/api";

const GUILD = "111111111111111111";
const USAGE = { servers: 1, asksToday: 3, asksWeek: 9, answeredPct: 89, chatPct: 67, medianMs: 1200, postsToday: 2, votesUp: 4, votesDown: 1 };
const NO_CAP: OwnerDiscordLimits = {
  servers: [{ guild: GUILD, name: "Austin Robotics", perHour: null, perDay: null, custom: false, usedHour: 0, usedDay: 0, follows: 2, lastAsk: null, updatedBy: null, updatedAt: null }],
  defaultLimit: { perHour: null, perDay: null },
  usage: USAGE,
  unanswered: [],
};
const CAPPED: OwnerDiscordLimits = {
  servers: [{ guild: GUILD, name: "Austin Robotics", perHour: 60, perDay: 300, custom: true, usedHour: 1, usedDay: 1, follows: 1, lastAsk: null, updatedBy: "owner@example.test", updatedAt: "2026-11-22T00:00:00Z" }],
  defaultLimit: { perHour: null, perDay: null },
  usage: USAGE,
  unanswered: [{ question: "how did our alliance do at worlds", count: 4, step: "no-match", lastAt: "2026-11-22T00:00:00Z", servers: 2 }],
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
    // Empty boxes suggest no cap, not the old 30/100 defaults.
    expect(screen.getByLabelText("Chats an hour").getAttribute("placeholder")).toBe("No cap");
    expect(screen.getByLabelText("Chats a day").getAttribute("placeholder")).toBe("No cap");
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

  it("reports any other failure as an error and keeps what was typed", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(500, "Something broke"));
    fillAndSave("60", "300");
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Something broke"));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Chats an hour") as HTMLInputElement).value).toBe("60");
    expect((screen.getByLabelText("Server id") as HTMLInputElement).value).toBe(GUILD);
    // A transient failure leaves the panel usable: the button is back and the same save can be retried.
    const save = screen.getByRole("button", { name: "Save cap" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(h.success).toHaveBeenCalled());
  });

  it("doesn't read a failed blank save as already uncapped, and keeps the server id", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(500, "Something broke"));
    fillAndSave("", "");
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Something broke"));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Server id") as HTMLInputElement).value).toBe(GUILD);
  });

  it("doesn't read a 409 on a real cap as already uncapped", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "That server has no cap of its own"));
    fillAndSave("60", "300");
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("That server has no cap of its own"));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Chats an hour") as HTMLInputElement).value).toBe("60");
  });

  it("reports a failed clear as an error, without claiming the cap is gone", async () => {
    h.data = CAPPED;
    apiFetch.mockRejectedValueOnce(new ApiError(500, "Something broke"));
    render(<DiscordPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Back to default" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Something broke"));
    expect(h.success).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    // The row's clear button is usable again, so the owner can retry.
    await waitFor(() => expect((screen.getByRole("button", { name: "Back to default" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("allows one cap write at a time: the other controls wait for it", async () => {
    h.data = CAPPED;
    let settle!: (v: OwnerDiscordLimits) => void;
    apiFetch.mockImplementationOnce(() => new Promise<OwnerDiscordLimits>((r) => { settle = r; }));
    render(<DiscordPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Back to default" }));
    expect((screen.getByRole("button", { name: "Save cap" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Clearing…" }) as HTMLButtonElement).disabled).toBe(true);
    settle(CAPPED);
    await waitFor(() => expect((screen.getByRole("button", { name: "Save cap" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: "Back to default" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns a 409 on Back to default into already cleared, and refreshes the table", async () => {
    h.data = CAPPED;
    apiFetch.mockRejectedValueOnce(new ApiError(409, "That server has no cap of its own"));
    render(<DiscordPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Back to default" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("That server already has no cap."));
    expect(h.error).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalled();
  });

  it("shows the server's name, the bot's numbers and the questions it couldn't answer", () => {
    h.data = CAPPED;
    render(<DiscordPanel />);
    expect(screen.getByText("Austin Robotics")).toBeTruthy();
    expect(screen.getByText("Chats today")).toBeTruthy();
    // Bruno answered 67% of 89% answered: 22% fell back to the card, said plainly.
    expect(screen.getByText("22% fell back to the card")).toBeTruthy();
    expect(screen.getByText("how did our alliance do at worlds")).toBeTruthy();
    expect(screen.getByText("×4")).toBeTruthy();
  });

  it("keeps the cap form when no server is listed: clearing the last cap must not take the way to set one", () => {
    h.data = { servers: [], defaultLimit: { perHour: null, perDay: null }, usage: { ...USAGE, servers: 0 }, unanswered: [] };
    render(<DiscordPanel />);
    expect(screen.getByText("No servers yet")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Give a server its own cap" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save cap" })).toBeTruthy();
  });
});
