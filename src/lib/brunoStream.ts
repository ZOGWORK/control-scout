// Bruno's answer on /search, streamed (GET /api/search/bruno?stream=1, server/app.ts): `onPreview` gets each checked
// part as he writes it (null: drop what's shown), and the result is his answer, the same one the plain call gives.
// An answer that comes whole (cached, or nothing to show before it) is read as the plain call's own reply. Throws
// when the stream can't be read or ends without its answer: the caller then asks the plain way (BrunoAnswer.tsx).

export interface BrunoAnswerBody { text: string; points?: string[] }

export async function streamBrunoAnswer(url: string, onPreview: (p: BrunoAnswerBody | null) => void, signal?: AbortSignal): Promise<BrunoAnswerBody | null> {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Bruno answered ${res.status}`);
  if (!/application\/x-ndjson/.test(res.headers.get("content-type") ?? "")) return (await res.json()) as BrunoAnswerBody | null;
  if (!res.body) throw new Error("no stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const l of lines) {
      if (!l.trim()) continue;
      const o = JSON.parse(l) as { p?: BrunoAnswerBody | null; done?: BrunoAnswerBody | null };
      if ("done" in o) { reader.cancel().catch(() => {}); return o.done ?? null; }
      if ("p" in o) onPreview(o.p ?? null);
    }
    if (done) throw new Error("stream ended early");
  }
}
