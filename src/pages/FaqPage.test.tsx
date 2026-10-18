// @vitest-environment jsdom
// The FAQ page: every topic and question shows; search narrows them and opens the matches; nothing matching
// offers the contact form; a question's link (/faq#id) opens that answer.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FAQ, FAQ_ITEMS } from "../shared/faq";

vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
const { default: FaqPage, faqMatches } = await import("./FaqPage");
const mount = (url = "/faq") => render(<MemoryRouter initialEntries={[url]}><FaqPage /></MemoryRouter>);
afterEach(cleanup);

describe("FAQ page", () => {
  it("lists every topic and question, closed", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 2 }).slice(0, FAQ.length).map((h) => h.textContent)).toEqual(FAQ.map((g) => g.title));
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(FAQ_ITEMS.length);
  });

  it("opens and closes an answer", () => {
    mount();
    const q = screen.getByRole("button", { name: "Do I need an account?" });
    fireEvent.click(q);
    expect(q.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Browsing, search and predictions all work without signing in/)).toBeTruthy();
    fireEvent.click(q);
    expect(q.getAttribute("aria-expanded")).toBe("false");
  });

  it("search narrows to the matching questions and opens them", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search the FAQ"), { target: { value: "wifi venue" } });
    expect(screen.getByRole("button", { name: "Does it work without wifi at a venue?", expanded: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "What is OPR?" })).toBeNull();
    expect(screen.getByText(/questions? match/)).toBeTruthy();
  });

  it("offers the contact form when nothing matches", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search the FAQ"), { target: { value: "zebra unicorn" } });
    expect(screen.getByText("No question matches “zebra unicorn”")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ask a question/ }).getAttribute("href")).toBe("/contact");
  });

  it("opens the answer a link points to", () => {
    mount("/faq#opr");
    expect(screen.getByRole("button", { name: "What is OPR?" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("ignores a malformed or unknown link instead of breaking", () => {
    mount("/faq#%");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Frequently asked questions");
    cleanup();
    mount("/faq#no-such-question");
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(FAQ_ITEMS.length);
  });

  it("matches every word, ignoring case and accents", () => {
    const item = { id: "x", q: "Où est l'équipe?", a: ["Team [link](/x) info"] };
    expect(faqMatches(item, "EQUIPE team")).toBe(true);
    expect(faqMatches(item, "equipe robot")).toBe(false);
    expect(faqMatches(item, "link")).toBe(true);
  });
});
