// Owner portal › Streams: set the YouTube stream an event page plays in its Watch live section
// (server/portal/streams.ts). The list of events with one, and a form to add, change or remove one. A link
// that isn't a usable YouTube video is refused here first and again by the server; nothing is saved then.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { MonitorPlay } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { dateRange } from "../../lib/format";
import { STREAM_HELP, parseStreamUrl } from "../../shared/stream";
import type { OwnerStreamRow } from "../../shared/api";

const PATH = "/api/owner/streams";

export function StreamsPanel() {
  const state = useApi<{ streams: OwnerStreamRow[] }>(PATH);
  const current = useMeta()?.currentSeason ?? new Date().getFullYear();
  const [season, setSeason] = useState<string>("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const save = async (s: number, c: string, link: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ stream: unknown; streams: OwnerStreamRow[] }>(`${PATH}/${s}/${encodeURIComponent(c)}`, { method: "PUT", json: { url: link } });
      prime(PATH, { streams: r.streams });
      toast.success(link ? `Stream set for ${c}.` : `Stream removed from ${c}.`);
      if (link) { setCode(""); setUrl(""); }
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const s = Number(season || current), c = code.trim().toUpperCase();
    if (!c) { setError("Enter the event's code (it's in the event page's address)."); return; }
    const p = parseStreamUrl(url);
    if (!p.ok) { setError(p.error); return; }
    void save(s, c, url.trim());
  };

  return (
    <Section title="Event streams" description="The YouTube stream an event page shows in its Watch live section, with live predictions beside it. Events with a stream also get a LIVE dot in the events list while they're on.">
      <form onSubmit={submit} className="mb-6 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[6rem_10rem_minmax(0,1fr)_auto] sm:items-end" noValidate>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Season</span>
          <Input inputMode="numeric" value={season} placeholder={String(current)} onChange={(e) => setSeason(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </label>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Event code</span>
          <Input value={code} placeholder="USCAFFQ1" onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 40))} autoCapitalize="characters" spellCheck={false} />
        </label>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Stream link</span>
          <Input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setUrl(e.target.value)} aria-describedby={`${id}-help ${id}-err`} aria-invalid={!!error} />
        </label>
        <Button type="submit" disabled={busy}>Save stream</Button>
        <p id={`${id}-help`} className="text-xs text-muted-foreground sm:col-span-4">{STREAM_HELP}</p>
        {error && <p id={`${id}-err`} role="alert" className="text-sm text-danger sm:col-span-4">{error}</p>}
      </form>
      <Async state={state} empty={(d) => !d.streams.length && <EmptyState icon={MonitorPlay} title="No streams set" description="Add one above: it shows on the event page within a minute or so." />}>
        {({ streams }) => (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Dates</TableHead><TableHead>Stream</TableHead><TableHead className="w-0" /></TableRow></TableHeader>
            <TableBody>
              {streams.map((s) => (
                <TableRow key={`${s.season}:${s.code}`}>
                  <TableCell><Link to={`/events/${s.season}/${s.code}`} className="font-medium hover:underline">{s.name ?? s.code}</Link><span className="ml-2 font-mono text-xs text-muted-foreground">{s.code}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dateRange(s.start, s.end)}</TableCell>
                  <TableCell className="max-w-[18rem] truncate"><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-muted-foreground hover:text-foreground" title={s.url}>{s.url}</a></TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={() => { setSeason(String(s.season)); setCode(s.code); setUrl(s.url); setError(null); }}>Edit</Button>{" "}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(s.season, s.code, "")} aria-label={`Remove the stream from ${s.code}`}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Async>
    </Section>
  );
}
