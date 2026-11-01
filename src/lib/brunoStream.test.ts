// Bruno's streamed answer, read in the browser (./brunoStream.ts): lines and characters split across reads join up,
// parts reach the page in order, the answer is the `done` line's; a whole answer reads as the plain reply; a stream
// that ends early or answers an error throws, so the page asks the plain way.
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamBrunoAnswer, type BrunoAnswerBody } from "./brunoStream";

const enc = new TextEncoder();
/** An NDJSON response from these lines, cut every `every` bytes (so lines and multi-byte characters span reads). */
const ndjson = (lines: unknown[], every = 7, end = true) => {
  const bytes = enc.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return new Response(new ReadableStream({
    start(c) { for (let i = 0; i < bytes.length; i += every) c.enqueue(bytes.slice(i, i + every)); if (end) c.close(); else c.error(new TypeError("network error")); },
  }), { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
};
const serve = (res: Response) => vi.stubGlobal("fetch", vi.fn(async () => res));
afterEach(() => vi.unstubAllGlobals());

const ANSWER = { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3 · OPR 111.5"] };

describe("reading Bruno's streamed answer", () => {
  it("joins lines and characters split across reads, sends each part in order, and answers the done line", async () => {
    serve(ndjson([{ p: { text: "Hypnotic Robotics (4215) went", points: [] } }, { p: { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3"] } }, { done: ANSWER }], 5));
    const parts: (BrunoAnswerBody | null)[] = [];
    expect(await streamBrunoAnswer("/api/search/bruno?q=x&stream=1", (p) => parts.push(p))).toEqual(ANSWER);
    expect(parts).toEqual([{ text: "Hypnotic Robotics (4215) went", points: [] }, { text: "Hypnotic Robotics (4215) went to states 2 times since 2023–24.", points: ["2023–24: ranked #3"] }]);
  });
  it("passes a withdrawn part on as null, and a done null as no answer", async () => {
    serve(ndjson([{ p: { text: "He went", points: [] } }, { p: null }, { done: null }]));
    const parts: (BrunoAnswerBody | null)[] = [];
    expect(await streamBrunoAnswer("/x", (p) => parts.push(p))).toBeNull();
    expect(parts).toEqual([{ text: "He went", points: [] }, null]);
  });
  it("reads a whole answer (cached) as the plain reply, and a 204 as none", async () => {
    serve(new Response(JSON.stringify(ANSWER), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await streamBrunoAnswer("/x", () => {})).toEqual(ANSWER);
    serve(new Response(null, { status: 204 }));
    expect(await streamBrunoAnswer("/x", () => {})).toBeNull();
  });
  it("throws when the stream ends early, breaks, or the server answers an error", async () => {
    serve(ndjson([{ p: { text: "He went", points: [] } }]));
    await expect(streamBrunoAnswer("/x", () => {})).rejects.toThrow("stream ended early");
    serve(ndjson([{ p: { text: "He went", points: [] } }], 7, false));
    await expect(streamBrunoAnswer("/x", () => {})).rejects.toThrow();
    serve(new Response('{"error":"Too many requests"}', { status: 429, headers: { "content-type": "application/json" } }));
    await expect(streamBrunoAnswer("/x", () => {})).rejects.toThrow("429");
  });
});
