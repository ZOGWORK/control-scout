// @vitest-environment jsdom
// The Report a bug dialog end to end against a stubbed server: it says plainly the issue is public, sends the message
// sanitized, and after sending shows only the truth: "filed as #N" with the real link, "something went wrong" when a
// try failed, and "saved, we'll file it" (no link) when there's no issue yet. A link to anything but this
// repository's issue with that number is never shown.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BugFiling } from "../../shared/bugReport";

vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ palette: "dark", theme: "dark" }) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: { id: 7, email: "ada@scout.test" }, providers: {}, state: { myTeam: null }, syncReady: false }) }));

const { BugReportButton, issueLinkOk, PUBLIC_NOTE, waitForIssue } = await import("./BugReport");

let posted: Record<string, unknown> | null = null;
let filing: BugFiling = { state: "pending" };
beforeEach(() => {
  posted = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/bug-reports") && init?.method === "POST") { posted = JSON.parse(String(init.body)); return Response.json({ id: 12, token: "t" }); }
    if (url.endsWith("/api/bug-reports/12/done")) return Response.json({ ok: true });
    if (url.endsWith("/api/bug-reports/12/status")) return Response.json(filing);
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function sendReport(message = "The rankings table jumps when I scroll.") {
  // StrictMode, as in development: effects mount, unmount and mount again, and the wait must still report back.
  render(<StrictMode><MemoryRouter initialEntries={["/teams/4215"]}><BugReportButton /></MemoryRouter></StrictMode>);
  fireEvent.click(screen.getByTestId("bug-report-button"));
  fireEvent.click(await screen.findByText("Something broken"));
  fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
  // The second confirmation.
  fireEvent.click(await screen.findByRole("button", { name: "Yes, post it publicly" }));
}

describe("Report a bug dialog", () => {
  it("says plainly that it files a public GitHub issue, and never fills in the email itself", async () => {
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    const note = await screen.findByTestId("bug-public-note");
    expect(note.textContent).toContain("This files a public GitHub Issue on ZOGWORK/control-scout. Anyone can see it.");
    expect(note.textContent).toContain("Want it private? Email sushil.m@icloud.com instead.");
    expect((screen.getByRole("link", { name: "sushil.m@icloud.com" }) as HTMLAnchorElement).href).toMatch(/^mailto:sushil\.m@icloud\.com\?subject=/);
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/shown on the public issue/)).toBeTruthy();
  });

  it("shows the real issue number and link once it's filed", async () => {
    filing = { state: "filed", number: 1520, url: "https://github.com/ZOGWORK/control-scout/issues/1520" };
    await sendReport();
    expect(await screen.findByText("Thanks — filed as #1520")).toBeTruthy();
    const link = screen.getByTestId("bug-issue-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/ZOGWORK/control-scout/issues/1520");
    expect(link.textContent).toContain("#1520 — https://github.com/ZOGWORK/control-scout/issues/1520");
    expect(screen.getByText(PUBLIC_NOTE)).toBeTruthy();
    expect(screen.getByTestId("bug-private-note")).toBeTruthy();
  });

  it("a failed try: says something went wrong and the report is saved, with no link", async () => {
    filing = { state: "failed" };
    await sendReport();
    expect(await screen.findByText("Something went wrong — your report is saved, we'll try again")).toBeTruthy();
    expect(screen.queryByTestId("bug-issue-link")).toBeNull();
  });

  it("asks a second time before sending, and Go back sends nothing", async () => {
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    fireEvent.click(await screen.findByText("Something broken"));
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "The rankings table jumps when I scroll." } });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    expect((await screen.findByTestId("bug-confirm")).textContent).toContain("Send this as a public issue?");
    expect(posted).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Go back/ }));
    expect(screen.queryByTestId("bug-confirm")).toBeNull();
    expect(posted).toBeNull();
    // Focus goes back to Send report, not to the page.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Send report/ })));
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, post it publicly" }));
    await waitFor(() => expect(posted).not.toBeNull());
  });

  it("only Yes sends: submitting the form again while asked just asks, and an edit asks again", async () => {
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    fireEvent.click(await screen.findByText("Something broken"));
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "The rankings table jumps when I scroll." } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "coach@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    // A typed email is public too, and the question says so.
    expect((await screen.findByTestId("bug-confirm")).textContent).toContain("Anyone can read it, including your email.");
    // Enter in a field submits the form: that must not send.
    fireEvent.submit(screen.getByTestId("bug-report-form"));
    await new Promise((r) => setTimeout(r, 50));
    expect(posted).toBeNull();
    expect(screen.getByTestId("bug-confirm")).toBeTruthy();
    // Changing what was asked about closes the question.
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "" } });
    await waitFor(() => expect(screen.queryByTestId("bug-confirm")).toBeNull());
    expect(posted).toBeNull();
  });

  it("sends the message sanitized", async () => {
    filing = { state: "failed" };
    await sendReport("It broke for me@family.example with github_pat_11ABCDEFG0123456789_abcdefghijklmnop");
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.message).toBe("It broke for [redacted] with [redacted]");
  });
});

describe("waitForIssue", () => {
  it("gives up with 'saved' (no issue) when the report isn't filed in time", async () => {
    filing = { state: "pending" };
    expect(await waitForIssue(12, "t", () => false, 30, 10)).toEqual({ state: "saved" });
  });
  it("never accepts a link that isn't this repository's issue with that number", async () => {
    for (const bad of [
      { state: "filed", number: 1520, url: "https://github.com/ZOGWORK/control-scout/issues/1521" },
      { state: "filed", number: 1520, url: "https://evil.example/ZOGWORK/control-scout/issues/1520" },
      { state: "filed", number: 0, url: "https://github.com/ZOGWORK/control-scout/issues/0" },
    ] as BugFiling[]) {
      expect(issueLinkOk(bad)).toBe(false);
      filing = bad;
      expect(await waitForIssue(12, "t", () => false, 30, 10)).toEqual({ state: "saved" });
    }
    expect(issueLinkOk({ state: "filed", number: 7, url: "https://github.com/ZOGWORK/control-scout/issues/7" })).toBe(true);
  });
});
