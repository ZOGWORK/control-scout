// The owner console's Packs & offline section: the offline pack manifest this server publishes
// (packs/latest.json: version, built, data as of, engine), each file with its size and SHA-256, and the
// rebuild behind a confirmation (OpsCards). There is no delete here: a pack saved on a device stays until
// that device updates it, and the server keeps its last few releases so a download in progress finishes.
import { useCallback, useState } from "react";
import { AlertTriangle, Check, Copy, Cpu, Database, FileArchive, HardDriveDownload, Layers, PackageOpen } from "lucide-react";
import { EmptyState, Section } from "../page";
import { StatTile } from "../StatTile";
import { Async } from "../states";
import { Badge } from "../ui/basic";
import { cn } from "../cn";
import { markStale, useApi } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { ago, seasonLabel } from "../../lib/format";
import { fmtBytes } from "../../lib/recordings";
import type { OwnerPacks, PackFileRow } from "../../shared/ownerData";
import { OpsCards } from "./OpsCards";

const PACKS = "/api/owner/packs";
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export function PacksPanel() {
  const state = useApi<OwnerPacks>(PACKS);
  const onDone = useCallback(() => { markStale(PACKS); markStale("/api/owner/data"); }, []);
  return (
    <>
      <Async state={state}>
        {(p) => (
          <>
            {!p.serving && (
              <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-warning/50 bg-warning/[0.10] p-4 max-sm:mb-4">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Offline packs are switched off.</span> Every pack URL answers "paused" until the switch is back on (Features). Packs already saved on devices keep working.</p>
              </div>
            )}
            <Section title="Pack manifest" description="What devices download for offline use: one lite pack (every team's rating, enough to predict any match) and one full database per season. Devices check the manifest on each visit.">
              {p.manifest ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile tone="violet" icon={PackageOpen} label="Version" value={<span className="break-all text-2xl">{p.manifest.version}</span>} hint={`Format ${p.manifest.format}`} />
                  <StatTile tone="sky" icon={HardDriveDownload} label="Built" value={ago(p.manifest.builtAt)} hint={when(p.manifest.builtAt)} />
                  <StatTile tone="emerald" icon={Database} label="Data as of" value={p.manifest.dataAsOf ? ago(p.manifest.dataAsOf) : "—"} hint={when(p.manifest.dataAsOf)} />
                  <StatTile tone="accent" icon={Cpu} label="Engine" value={p.manifest.engineVersion} hint={`${fmtBytes(p.totalBytes)} in ${p.files.length} files`} />
                </div>
              ) : (
                <EmptyState icon={PackageOpen} title="No offline packs on this server yet" description={p.unavailable ?? "Rebuild below to build the first set. Until then the Download page says packs aren't ready."} />
              )}
              {p.versionsOnDisk.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Layers className="size-3.5" aria-hidden /> Releases kept on this server:
                  {p.versionsOnDisk.map((v) => <Badge key={v} variant={v === p.manifest?.version ? "soft" : "secondary"} className="tabular-nums">{v}</Badge>)}
                </p>
              )}
            </Section>
            {p.files.length > 0 && (
              <Section title="Files" description="Each file as the manifest lists it. A device checks the SHA-256 after downloading, so a file that doesn't match is never used.">
                <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Pack files">
                  {p.files.map((f) => <FileRow key={f.name} f={f} />)}
                </ul>
              </Section>
            )}
          </>
        )}
      </Async>
      <OpsCards ops={["packs"]} title="Rebuild" description="Builds a new release from the current data. Nothing is deleted from devices: each keeps the packs it saved until it updates them." onDone={onDone} />
    </>
  );
}

function FileRow({ f }: { f: PackFileRow }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(f.sha256, "SHA-256 copied", "Couldn't copy the SHA-256", f.sha256)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  const title = f.kind === "lite" ? "Lite: ratings" : f.season != null ? seasonLabel(f.season) : "Full";
  return (
    <li className="grid gap-x-4 gap-y-2 p-4 sm:grid-cols-[minmax(0,14rem)_6rem_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5">
          <FileArchive className={cn("size-4 shrink-0", f.kind === "lite" ? "text-violet-600 dark:text-violet-400" : "text-info")} aria-hidden />
          <span className="font-medium text-foreground">{title}</span>
          <Badge variant={f.kind === "lite" ? "soft" : "info"}>{f.kind === "lite" ? "Lite" : "Full"}</Badge>
          {!f.onDisk && <Badge variant="destructive">Missing on disk</Badge>}
        </p>
        <p className="mt-0.5 break-all text-xs text-muted-foreground">{f.kind === "lite" ? `Seasons ${f.seasons.map(seasonLabel).join(", ")}` : f.name}</p>
      </div>
      <p className="text-sm tabular-nums text-foreground sm:text-right"><span className="text-muted-foreground sm:hidden">Size </span>{fmtBytes(f.bytes)}</p>
      <div className="flex min-w-0 items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground" aria-label={`SHA-256 of ${title}`}>{f.sha256}</code>
        <button type="button" onClick={() => void copy()} aria-label={`Copy SHA-256 of ${title}`}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground">
          {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
    </li>
  );
}
