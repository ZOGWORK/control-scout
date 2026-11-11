// @vitest-environment jsdom
// /get-verified: the questions in order with the five agreements, sending only once all five are ticked, each field's
// own error from the server, Review Pending with nothing to edit; and /contributors/<username> for an unknown name.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import { AGREEMENTS, PENDING_TEXT, type MyContributorStatus } from "../shared/contributors";

const h = vi.hoisted(() => ({
  user: { id: 5 } as null | { id: number },
  me: undefined as MyContributorStatus | undefined,
  apply: vi.fn(),
  profileError: undefined as unknown,
}));
vi.mock("../components/NotFoundView", () => ({ NotFoundView: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, state: { myTeam: null, tracked: { teams: [], events: [] } } }) }));
vi.mock("../components/layout/AccountMenu", () => ({ useOpenSignIn: () => () => {} }));
vi.mock("../components/AccountSetup", () => ({ useAccountSetup: () => ({ ready: true, ensure: async () => true, open: () => {} }) }));
vi.mock("../lib/contributors", async (orig) => ({
  ...(await orig<typeof import("../lib/contributors")>()),
  useMyContributorStatus: () => ({ data: h.me, reload: async () => {} }),
  applyForVerification: h.apply,
}));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, error: h.profileError, loading: false, reload: async () => {} }) }));

const { default: GetVerifiedPage } = await import("./GetVerifiedPage");
const { default: ContributorPage } = await import("./ContributorPage");
const status = (over: Partial<MyContributorStatus> = {}): MyContributorStatus => ({ status: "none", source: null, teams: [], pending: null, rejected: null, ready: true, credit: "Video by Sam Lee", ...over });

beforeEach(() => { h.user = { id: 5 }; h.me = status(); h.apply.mockReset(); });
afterEach(cleanup);

describe("Get Verified", () => {
  it("asks the questions in order, previews the credit, and sends only once all five agreements are ticked", () => {
    render(<MemoryRouter><GetVerifiedPage /></MemoryRouter>);
    const labels = [...document.querySelectorAll("form [class*='font-semibold']")].map((x) => x.textContent ?? "").filter((t) => /^\d\./.test(t));
    expect(labels.map((t) => t.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(document.querySelector("[data-credit-preview]")?.textContent).toBe("Will show as: Video by Sam Lee");
    const send = screen.getByRole("button", { name: "Send application" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    for (const [k] of AGREEMENTS) fireEvent.click(document.querySelector(`[data-agreement=${k}]`)!);
    expect(send.disabled).toBe(false);
    for (const [, text] of AGREEMENTS) expect(screen.getByText(text)).toBeTruthy();
  });

  it("shows each field's own error from the server", async () => {
    h.apply.mockRejectedValue(Object.assign(new ApiError(400, "Some answers need a fix."), { body: { error: "Some answers need a fix.", errors: { why: "Tell us a little more — at least a sentence", teamNumber: "There's no FTC team 99999." } } }));
    render(<MemoryRouter><GetVerifiedPage /></MemoryRouter>);
    for (const [k] of AGREEMENTS) fireEvent.click(document.querySelector(`[data-agreement=${k}]`)!);
    fireEvent.click(screen.getByRole("button", { name: "Send application" }));
    expect(await screen.findByText("Tell us a little more — at least a sentence")).toBeTruthy();
    expect(screen.getByText("There's no FTC team 99999.")).toBeTruthy();
  });

  it("shows Review Pending with nothing to edit while it waits", () => {
    h.me = status({ status: "pending", pending: { since: "2026-11-10T12:00:00Z", source: "application" } });
    render(<MemoryRouter><GetVerifiedPage /></MemoryRouter>);
    expect(screen.getByText(PENDING_TEXT)).toBeTruthy();
    expect(document.body.textContent).toMatch(/You can't edit this while it's being reviewed/);
    expect(document.querySelector("[data-application-form]")).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw application" })).toBeTruthy();
  });
});

describe("contributor profile", () => {
  it("is the page not found for an unknown username", () => {
    h.profileError = new ApiError(404, "No such contributor");
    render(<MemoryRouter initialEntries={["/contributors/nobody_here"]}><Routes><Route path="/contributors/:username" element={<ContributorPage />} /></Routes></MemoryRouter>);
    expect(screen.getByText("No such contributor")).toBeTruthy();
  });
});
