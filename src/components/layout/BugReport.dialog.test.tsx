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

const { BugReportButton, PUBLIC_NOTE } = await import("./BugReport");
const { issueLinkOk, waitForIssue } = await import("./BugReportForm");

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
    // The public warning was for before sending: once it's filed it's gone.
    expect(screen.queryByText(PUBLIC_NOTE)).toBeNull();
    expect(screen.queryByTestId("bug-private-note")).toBeNull();
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

  it("the button names both: report a bug or request a feature", () => {
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    const button = screen.getByTestId("bug-report-button");
    expect(button.getAttribute("aria-label")).toBe("Report a bug or request a feature");
    expect(button.getAttribute("title")).toBe("Report a bug or request a feature");
  });

  it("sends a bug's optional title with it, and no title when it's left empty", async () => {
    filing = { state: "failed" };
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    fireEvent.click(await screen.findByText("Something broken"));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "  Rankings jump  " } });
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "The rankings table jumps when I scroll." } });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, post it publicly" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ kind: "bug", category: "broken", title: "Rankings jump" });
    cleanup(); posted = null;
    await sendReport();
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.title).toBeUndefined();
  });

  it("switches to a feature request: its own heading and prompts, no problem kinds, sent as a feature", async () => {
    filing = { state: "failed" };
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    const bug = await screen.findByRole("radio", { name: "Report a bug" });
    expect((bug as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("What kind of problem?")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Request a feature" }));
    expect(screen.getByRole("heading", { name: "Request a feature" })).toBeTruthy();
    expect(screen.queryByText("What kind of problem?")).toBeNull();
    expect(screen.queryByText("Something broken")).toBeNull();
    const ask = screen.getByLabelText(/What would you like\?/) as HTMLTextAreaElement;
    expect(ask.placeholder).toBe("What should it do, and why would it help?");
    // Screenshots stay optional.
    expect(screen.getByText(/Screenshots or a video/).textContent).toContain("(optional)");
    expect((screen.getByRole("link", { name: "sushil.m@icloud.com" }) as HTMLAnchorElement).href).toContain(encodeURIComponent("Control Scout feature request"));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Compare two teams" } });
    fireEvent.change(ask, { target: { value: "Pick two teams and see their stats side by side." } });
    // No category needed: the first Send asks the public question straight away.
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, post it publicly" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ kind: "feature", title: "Compare two teams", message: "Pick two teams and see their stats side by side." });
    expect(posted).not.toHaveProperty("category");
  });

  it("switching back to a bug brings the problem kinds back and needs one again", async () => {
    render(<MemoryRouter><BugReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("bug-report-button"));
    fireEvent.click(await screen.findByRole("radio", { name: "Request a feature" }));
    fireEvent.click(screen.getByRole("radio", { name: "Report a bug" }));
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "The rankings table jumps when I scroll." } });
    fireEvent.click(screen.getByRole("button", { name: /Send report/ }));
    expect(await screen.findByText("Choose what kind of problem it is.")).toBeTruthy();
    expect(screen.queryByTestId("bug-confirm")).toBeNull();
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
