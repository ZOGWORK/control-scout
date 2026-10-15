// Match video, shown inline in a match's details: record on this device
// (never uploaded) or attach a YouTube link.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, CircleStop, Download, Link2, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { FieldError, Input } from "./ui/basic";
import { toast } from "./ui/sonner";
import { usePersonal } from "../lib/personal";
import { youtubeId } from "../shared/personal";
import { CHANGED, deleteRecording, fmtBytes, listRecordings, pickMime, saveRecording, type Recording } from "../lib/recordings";
import { cn } from "./cn";

export function useRecordings(matchRef?: string) {
  const [list, setList] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { listRecordings(matchRef).then(setList, (e) => setError(e.message)); }, [matchRef]);
  useEffect(() => { refresh(); window.addEventListener(CHANGED, refresh); return () => window.removeEventListener(CHANGED, refresh); }, [refresh]);
  return { list, error };
}

/** How many YouTube links are saved for a match (for the row's video mark). */
export function useVideoLinkCount(matchRef: string) {
  const { state } = usePersonal();
  return state.videoLinks[matchRef]?.length ?? 0;
}

/** Video for one match, inline (no dialog): YouTube links, record on this device, saved recordings. */
export function VideoPanel({ matchRef, label }: { matchRef: string; label: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Recordings stay on this device — Control Scout never uploads or hosts video. YouTube links are saved to your list (and account, if signed in).</p>
      <Tabs defaultValue="links" className="mt-3">
        <TabsList><TabsTrigger value="links">YouTube</TabsTrigger><TabsTrigger value="record">Record</TabsTrigger><TabsTrigger value="saved">On this device</TabsTrigger></TabsList>
        <TabsContent value="links" className="mt-4"><Links matchRef={matchRef} /></TabsContent>
        <TabsContent value="record" className="mt-4"><Recorder matchRef={matchRef} label={label} /></TabsContent>
        <TabsContent value="saved" className="mt-4"><SavedList matchRef={matchRef} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Links({ matchRef }: { matchRef: string }) {
  const { state, update } = usePersonal();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const links = state.videoLinks[matchRef] ?? [];
  const add = () => {
    const fail = (msg: string) => { setError(msg); input.current?.focus(); };
    if (!youtubeId(url)) return fail("That isn't a YouTube video link. Paste one like https://youtu.be/… or https://www.youtube.com/watch?v=…");
    const stored = update("videoLinks", (v) => ({ ...v, [matchRef]: [...(v[matchRef] ?? []).filter((l) => l.url !== url), { url, title: null, addedAt: Date.now() }] }));
    if (!stored) return fail("Couldn't save the link on this device: storage is full or blocked.");
    setUrl(""); setError(null);
  };
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <div className="flex gap-2">
          <Input ref={input} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://youtu.be/…" aria-label="YouTube link" className="h-10"
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
          <Button type="submit" variant="secondary" disabled={!url}><Link2 /> Add</Button>
        </div>
        <FieldError id={errorId}>{error}</FieldError>
      </form>
      {!links.length ? <p className="text-sm text-muted-foreground">No links for this match yet.</p> : links.map((l) => (
        <div key={l.url} className="space-y-1.5">
          <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
            <iframe className="size-full" src={`https://www.youtube-nocookie.com/embed/${youtubeId(l.url)}`} title="Match video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => update("videoLinks", (v) => ({ ...v, [matchRef]: (v[matchRef] ?? []).filter((x) => x.url !== l.url) }))}><Trash2 /> Remove link</Button>
        </div>
      ))}
    </div>
  );
}

function Recorder({ matchRef, label }: { matchRef: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const [state, setState] = useState<"idle" | "preview" | "recording" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const stopAll = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  // Unmounted (e.g. the video section closed): a camera that's still starting must be stopped when it arrives.
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; rec.current?.state === "recording" && rec.current.stop(); stopAll(); }; }, []);
  const startCamera = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: true });
      if (gone.current) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
      setState("preview");
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow it in your browser's site settings to record." : "Couldn't start the camera on this device.");
    }
  };
  const start = () => {
    if (!stream.current) return;
    const mime = pickMime();
    chunks.current = [];
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      setState("saving");
      const blob = new Blob(chunks.current, { type: r.mimeType || mime || "video/webm" });
      try {
        await saveRecording({ matchRef, label, blob, mime: blob.type, durationMs: Date.now() - started.current });
        toast.success(`Saved on this device (${fmtBytes(blob.size)}) — not uploaded`);
      } catch (e: any) {
        setError(e?.name === "QuotaExceededError" ? "This device is out of space for recordings. Delete some in Settings → Offline & data." : "Couldn't save the recording on this device.");
      }
      setState("preview");
    };
    rec.current = r;
    started.current = Date.now();
    r.start(1000);
    setState("recording");
  };
  const stop = () => rec.current?.state === "recording" && rec.current.stop();
  if (!supported) return <p className="text-sm text-muted-foreground">This browser can't record video. Try Chrome, Edge, Firefox or Safari 14.1+.</p>;
  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
        <video ref={video} muted playsInline className={cn("size-full object-cover", state === "idle" && "hidden")} />
        {state === "idle" && <div className="flex size-full items-center justify-center text-sm text-white/60">Camera off</div>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {state === "idle" && <Button onClick={startCamera}><Camera /> Start camera</Button>}
        {state === "preview" && <Button onClick={start}><span className="size-2.5 rounded-full bg-red-500" /> Record</Button>}
        {state === "recording" && <Button variant="destructive" onClick={stop}><CircleStop /> Stop & save</Button>}
        {state === "saving" && <Button disabled>Saving…</Button>}
        {state !== "idle" && state !== "recording" && <Button variant="ghost" onClick={() => { stopAll(); setState("idle"); }}>Turn camera off</Button>}
      </div>
      <p className="text-xs text-muted-foreground">The recording is stored in this browser on this device. It isn't uploaded, synced or shared — download it if you want a copy elsewhere.</p>
    </div>
  );
}

function RecordingItem({ r }: { r: Recording }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const u = URL.createObjectURL(r.blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [r.blob]);
  const ext = r.mime.includes("mp4") ? "mp4" : "webm";
  return (
    <li className="space-y-1.5 rounded-xl border border-border bg-card p-3">
      {url && <video src={url} controls playsInline className="aspect-video w-full rounded-lg bg-black" />}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{r.label}</span>
        <span>{new Date(r.createdAt).toLocaleString()} · {fmtBytes(r.size)} · {Math.round(r.durationMs / 1000)}s</span>
        <span className="ml-auto flex gap-1">
          {url && <Button variant="ghost" size="sm" asChild><a href={url} download={`${r.label.replace(/[^\w-]+/g, "_")}.${ext}`}><Download /> Download</a></Button>}
          <Button variant="ghost" size="sm" onClick={() => deleteRecording(r.id)}><Trash2 /> Delete</Button>
        </span>
      </div>
    </li>
  );
}

function SavedList({ matchRef }: { matchRef: string }) {
  const { list, error } = useRecordings(matchRef);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!list) return <div className="skeleton h-24 rounded-xl" />;
  if (!list.length) return <p className="text-sm text-muted-foreground">No recordings of this match on this device.</p>;
  return <ul className="space-y-3">{list.map((r) => <RecordingItem key={r.id} r={r} />)}</ul>;
}

/** Every recording and link (Scout page). */
export function Recordings() {
  const { list, error } = useRecordings();
  const { state } = usePersonal();
  const links = Object.entries(state.videoLinks);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  return (
    <div className="space-y-4">
      {!list ? <div className="skeleton h-24 rounded-xl" /> : !list.length ? <p className="text-sm text-muted-foreground">No recordings on this device. Open any match (camera icon on a match row) to record one.</p> : <ul className="grid gap-3 md:grid-cols-2">{list.map((r) => <RecordingItem key={r.id} r={r} />)}</ul>}
      {links.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">YouTube links ({links.reduce((s, [, l]) => s + l.length, 0)})</p>
          <ul className="space-y-1 text-sm">{links.flatMap(([ref, ls]) => ls.map((l) => <li key={ref + l.url} className="truncate"><span className="font-mono text-xs text-muted-foreground">{ref.split(":").slice(1, 2).join("")} {ref.split(":").slice(2).join(":")}</span> · <a href={l.url} target="_blank" rel="noreferrer noopener" className="hover:underline">{l.url}</a></li>))}</ul>
        </div>
      )}
    </div>
  );
}
