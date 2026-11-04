// @vitest-environment jsdom
// Bruno's written answer on /search (./BrunoAnswer.tsx): asked once a question settles and the results are in,
// shown labelled as his only once he has answered (never a placeholder that could vanish); nothing for a name or a
// number, with the switch off, or when he has no answer; an older question's answer never shows for a newer one.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
// The streamed ask (lib/brunoStream): "fail" breaks at once (the plain ask takes over, as every older test expects);
// "hold" keeps it open for the test to stream parts into, finish, or break.
type Part = { text: string; points?: string[] } | null;
const streams: { url: string; part: (p: Part) => void; resolve: (v: Part) => void; reject: (e: Error) => void }[] = [];
let streamMode: "fail" | "hold" = "fail";
vi.mock("../../lib/brunoStream", () => ({
  streamBrunoAnswer: (url: string, part: (p: Part) => void) => streamMode === "fail"
    ? Promise.reject(new Error("no stream"))
    : new Promise((resolve, reject) => streams.push({ url, part, resolve, reject })),
}));
const flags = { brunoAnswers: true };
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: (n: keyof typeof flags) => flags[n] }));

const { BrunoAnswer, BRUNO_SETTLE_MS } = await import("./BrunoAnswer");

const Q = "how many times did 4215 go to states";
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); flags.brunoAnswers = true; });
afterEach(() => { cleanup(); pending.length = 0; streams.length = 0; streamMode = "fail"; vi.useRealTimers(); });
const settle = () => act(async () => { vi.advanceTimersByTime(BRUNO_SETTLE_MS + 5); });
const answer = (text: string | null, points?: string[]) => act(async () => { pending.shift()!.resolve(text ? { text, points } : null); });

describe("Bruno's answer on /search", () => {
  it("asks once the question settles and the results are in, then shows his answer, labelled", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} ready={false} />);
    await settle();
    expect(pending).toHaveLength(0);
    rerender(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(pending.map((p) => p.url)).toEqual([`/api/search/bruno?q=${encodeURIComponent(Q)}`]);
    // Asked, not answered yet: no card at all (no placeholder that could vanish).
    expect(screen.queryByRole("note")).toBeNull();
    await answer("Hypnotic Robotics (4215) went to states 3 times since 2023–24.");
    const note = screen.getByRole("note", { name: "Bruno AI's answer" });
    expect(note.textContent).toContain("Bruno AI");
    expect(note.textContent).toContain("went to states 3 times since 2023–24.");
    expect(note.textContent).toContain("Written by Bruno AI from Control Point, from the records below");
    // The credit sits on the card itself, in its header.
    expect(note.querySelector("p")!.textContent).toBe("Bruno AI from Control Point");
  });
  it("shows his points as a bulleted list under the sentence", async () => {
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await answer("Hypnotic Robotics (4215) went to states 2 times since 2023–24.", ["2023–24: ranked #3, OPR 111.5", "2024–25: ranked #7"]);
    const items = screen.getByRole("note", { name: "Bruno AI's answer" }).querySelectorAll("ul > li");
    expect([...items].map((li) => li.textContent)).toEqual(["2023–24: ranked #3, OPR 111.5", "2024–25: ranked #7"]);
  });
  it("asks with the page's own preferred teams", async () => {
    render(<BrunoAnswer q={Q} prefer="team:4215,team:6980" ready />);
    await settle();
    expect(pending[0].url).toBe(`/api/search/bruno?q=${encodeURIComponent(Q)}&prefer=${encodeURIComponent("team:4215,team:6980")}`);
  });
  it("an answer read with other preferred teams never shows under new ones", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} prefer="team:4215" ready />);
    await settle();
    await answer("Hypnotic Robotics (4215) went to states 3 times.");
    rerender(<BrunoAnswer q={Q} prefer="team:6980" ready />);
    expect(screen.queryByRole("note")).toBeNull();
    await settle();
    expect(pending[0].url).toContain(encodeURIComponent("team:6980"));
  });
  it("shows nothing when he has no answer", async () => {
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(screen.queryByRole("note")).toBeNull();
    await answer(null);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("shows nothing for an empty answer or when asking fails", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} ready />);
    await settle();
    await act(async () => { pending.shift()!.resolve({ text: "   ", points: ["2023–24: ranked #3"] }); });
    expect(screen.queryByRole("note")).toBeNull();
    rerender(<BrunoAnswer q="when did 23268 go to worlds" ready />);
    await settle();
    await act(async () => { pending.shift()!.resolve(Promise.reject(new Error("502"))); });
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("with a summary: the summary alone while he writes, then his card around it once he answers", async () => {
    render(<BrunoAnswer q={Q} ready><span>3 states trips</span></BrunoAnswer>);
    await settle();
    expect(screen.getByRole("note", { name: "Summary" }).textContent).toContain("3 states trips");
    expect(screen.queryByRole("note", { name: "Bruno AI's answer" })).toBeNull();
    await answer("Hypnotic Robotics (4215) went to states 3 times.");
    const note = screen.getByRole("note", { name: "Bruno AI's answer" });
    expect(note.textContent).toContain("3 states trips");
    expect(note.textContent).toContain("went to states 3 times.");
    expect(screen.queryByRole("note", { name: "Summary" })).toBeNull();
  });
  it("never asks for a name or a number, or with the switch off", async () => {
    const { rerender } = render(<BrunoAnswer q="4215" ready />);
    await settle();
    rerender(<BrunoAnswer q="hypnotic opr" ready />);
    await settle();
    flags.brunoAnswers = false;
    rerender(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(pending).toHaveLength(0);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("an older question's answer never shows under a newer one", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} ready />);
    await settle();
    const first = pending.shift()!;
    rerender(<BrunoAnswer q="when did 23268 go to worlds" ready />);
    await act(async () => { first.resolve({ text: "Old answer." }); });
    expect(screen.queryByText("Old answer.")).toBeNull();
    await settle();
    await answer("Ultraviolet (23268) went to Worlds 2 times.");
    expect(screen.getByText("Ultraviolet (23268) went to Worlds 2 times.")).toBeTruthy();
  });
});

describe("read as a stream, shown only once he's done", () => {
  const note = () => screen.getByRole("note", { name: "Bruno AI's answer" });
  const part = (p: Part) => act(async () => { streams[0].part(p); });
  it("shows no card while he writes, then his finished answer with its label", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(streams[0].url).toBe(`/api/search/bruno?q=${encodeURIComponent(Q)}&stream=1`);
    await part({ text: "Hypnotic Robotics (4215) went to", points: [] });
    expect(screen.queryByRole("note")).toBeNull();
    await part({ text: "Hypnotic Robotics (4215) went to states 2 times.", points: ["2023–24: ranked #3"] });
    expect(screen.queryByRole("note")).toBeNull();
    await act(async () => { streams[0].resolve({ text: "Hypnotic Robotics (4215) went to states 2 times.", points: ["2023–24: ranked #3", "2024–25: ranked #7"] }); });
    expect(note().querySelectorAll("ul > li")).toHaveLength(2);
    expect(note().textContent).toContain("Written by Bruno AI");
    expect(pending).toHaveLength(0);
  });
  it("parts that end in a dropped answer (a number not in the facts) never show anything", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await part({ text: "Hypnotic Robotics went to states", points: [] });
    expect(screen.queryByRole("note")).toBeNull();
    await part(null);
    await act(async () => { streams[0].resolve(null); });
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("a stream that breaks part-way asks the plain way and shows his answer once", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await part({ text: "Hypnotic Robotics (4215) went", points: [] });
    await act(async () => { streams[0].reject(new Error("stream ended early")); });
    expect(pending.map((p) => p.url)).toEqual([`/api/search/bruno?q=${encodeURIComponent(Q)}`]);
    expect(screen.queryByRole("note")).toBeNull();
    await answer("Hypnotic Robotics (4215) went to states 2 times.");
    expect(note().querySelectorAll("p.font-medium")).toHaveLength(1);
    expect(note().textContent!.match(/Hypnotic Robotics/g)).toHaveLength(1);
    expect(note().textContent).toContain("went to states 2 times.");
  });
  it("a newer question drops the older stream's parts", async () => {
    streamMode = "hold";
    const { rerender } = render(<BrunoAnswer q={Q} ready />);
    await settle();
    const first = streams.shift()!;
    rerender(<BrunoAnswer q="when did 23268 go to worlds" ready />);
    await act(async () => { first.part({ text: "Old part", points: [] }); first.resolve({ text: "Old answer." }); });
    expect(screen.queryByText("Old part")).toBeNull();
    expect(screen.queryByText("Old answer.")).toBeNull();
  });
});
