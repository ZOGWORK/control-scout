// @vitest-environment jsdom
// Enter on a follow-up ("who beat them?", "and last season?") asks about the team the last answer was about, so the
// results page answers it instead of reading a question with no subject (./thread.ts); a question of its own is asked
// as typed.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../../shared/api";

const t = (ref: string): SearchHit => ({ kind: "team", ref, title: `${ref} | Bad Wolf`, subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" });

// No answer ever arrives: what Enter opens is the box's own reading of the question, never a result.
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: () => new Promise(() => {}) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox } = await import("./SearchBox");
const { forgetTurn, rememberTurn } = await import("./thread");

beforeEach(() => { forgetTurn(); Element.prototype.scrollIntoView = () => {}; });
afterEach(cleanup);

function mount() {
  const onPick = vi.fn();
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  act(() => input.focus());
  return { input, onPick };
}

/** Type a question and press Enter, as a visitor does. */
async function ask(input: HTMLInputElement, q: string) {
  fireEvent.change(input, { target: { value: q } });
  await act(async () => {});
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("the box keeps the thread", () => {
  it("asks a follow-up about the team the last question named", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t("6980")] });
    const { input, onPick } = mount();
    await ask(input, "who beat them?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=who%20beat%206980%3F");
  });

  it("fills a bare follow-up in: \"and last season?\" is last season of that team", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t("6980")] });
    const { input, onPick } = mount();
    await ask(input, "and last season?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=6980%20last%20season%3F");
  });

  it("leaves a question of its own alone: nothing is carried into a team or a place it names", async () => {
    rememberTurn({ q: "6980 worlds", hits: [t("6980")] });
    const { input, onPick } = mount();
    await ask(input, "and 4215?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=and%204215%3F");
  });

  it("carries nothing when the last answer was about many teams", async () => {
    rememberTurn({ q: "teams in new jersey", hits: [t("6980"), t("4215")] });
    forgetTurn();
    rememberTurn({ q: "teams in new jersey", hits: [t("6980"), t("4215")] });
    const { input, onPick } = mount();
    await ask(input, "who beat them?");
    expect(onPick.mock.calls[0][0].href).toBe("/search?q=who%20beat%20them%3F");
  });
});
