// The owner console's Discord bot panel (Product): the per-server chat caps (bot/quota.ts) and the control to give one
// server a cap — or take it away again (server/portal/discordLimits.ts). No server is capped until it is given one here.
// The bot stores no server names, so each row is a server id (in Discord: right-click the server → Copy Server ID). A
// blank box, or 0, is no cap for that window; either write starts that server's counters afresh.
import { useState, type FormEvent } from "react";
import { Bot } from "lucide-react";
import { EmptyState, Section } from "../page";
import { Async } from "../states";
import { Badge, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import type { OwnerDiscordLimits } from "../../shared/discordLimits";

const PATH = "/api/owner/discord/limits";
const GUILD = /^\d{15,22}$/;
const MAX_CAP = 100_000;

/** A cap in words: "30 an hour, 100 a day", whichever windows it has, or "none". */
const capWords = (l: { perHour: number | null; perDay: number | null }) =>
  [l.perHour == null ? null : `${l.perHour} an hour`, l.perDay == null ? null : `${l.perDay} a day`].filter(Boolean).join(", ") || "none";

/** A cap from a box: blank or 0 is no cap, a whole count is that cap, anything else is refused (undefined). */
const fromBox = (v: string): number | null | undefined => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CAP ? (n === 0 ? null : n) : undefined;
};

export function DiscordPanel() {
  const state = useApi<OwnerDiscordLimits>(PATH);
  const [guild, setGuild] = useState("");
  const [hour, setHour] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const g = guild.trim();
    if (!GUILD.test(g)) { toast.error("That isn't a Discord server id (a long number). In Discord: right-click the server → Copy Server ID."); return; }
    const perHour = fromBox(hour), perDay = fromBox(day);
    if (perHour === undefined || perDay === undefined) { toast.error(`A cap is a whole number up to ${MAX_CAP.toLocaleString()}; blank or 0 is no cap.`); return; }
    // Both blank (or 0) is no cap, so it clears the server's row rather than writing one that says nothing: the panel
    // then reads "No cap", as the hint says, instead of "Own cap · none".
    const none = perHour == null && perDay == null;
    setBusy("save");
    try {
      const next = none
        ? await apiFetch<OwnerDiscordLimits>(`${PATH}/${g}`, { method: "DELETE", json: {} })
        : await apiFetch<OwnerDiscordLimits>(`${PATH}/${g}`, { method: "PUT", json: { perHour, perDay } });
      prime(PATH, next);
      toast.success(none ? "That server has no cap. Its counters start afresh." : `Saved that server's cap: ${capWords({ perHour, perDay })}. Its counters start afresh.`);
      setGuild(""); setHour(""); setDay("");
    } catch (err) {
      // Already uncapped (another owner got there first): that is the state the blank save asked for, so show it and
      // refresh, so the table can't keep showing a cap someone else has taken away.
      if (none && (err as ApiError).status === 409) {
        toast.success("That server already has no cap.");
        setGuild(""); setHour(""); setDay("");
        void state.reload();
      } else toast.error((err as ApiError).message);
    } finally { setBusy(null); }
  };

  const backToDefault = async (g: string) => {
    setBusy(g);
    try {
      prime(PATH, await apiFetch<OwnerDiscordLimits>(`${PATH}/${g}`, { method: "DELETE", json: {} }));
      toast.success("Cap removed. That server's counters start afresh.");
    } catch (err) {
      toast.error((err as ApiError).message);
    } finally { setBusy(null); }
  };

  return (
    <Section title="Discord bot"
      description="No server is capped by default. Give one a cap in chats an hour and a day (counted in UTC windows) and it replaces both windows for that server; take it away again whenever you like. Either write starts that server's counters afresh. At a cap, /ask and a mention say when it resets; the site and the server's follow posts keep working.">
      {/* The form stays outside the empty state: clearing the last known server's cap must not take the way to set it. */}
      <Async state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.servers.length ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Server</TableHead>
                    <TableHead className="text-right">Follows</TableHead>
                    <TableHead className="text-right">This hour</TableHead>
                    <TableHead className="text-right">Today</TableHead>
                    <TableHead>Cap</TableHead>
                    <TableHead>Last asked</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.servers.map((s) => (
                    <TableRow key={s.guild}>
                      <TableCell className="max-w-[14rem] truncate font-mono text-xs" title={s.guild}>{s.guild}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.follows}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.usedHour}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.usedDay}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {s.custom ? (
                          <span className="flex items-center gap-2"><Badge variant="secondary">Own cap</Badge>{capWords(s)}</span>
                        ) : (
                          <span className="text-muted-foreground">No cap</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{s.lastAsk ? ago(s.lastAsk) : "never"}</TableCell>
                      <TableCell className="text-right">
                        {s.custom && (
                          <Button size="sm" variant="ghost" disabled={busy === s.guild} onClick={() => void backToDefault(s.guild)}>
                            {busy === s.guild ? "Clearing…" : "Back to default"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            ) : (
              <EmptyState icon={Bot} title="No servers yet" description="A server appears here once its people ask the bot something or follow a team. You can still give one a cap by its id below." />
            )}

            <form onSubmit={save} className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-medium">Give a server its own cap</h3>
              <p className="mt-1 text-sm text-muted-foreground">Replaces both windows. Leave a box blank (or 0) for no cap in that window; leave both blank to keep the server uncapped.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="block min-w-0 text-sm">
                  <span className="mb-1 block text-muted-foreground">Server id</span>
                  <Input value={guild} onChange={(e) => setGuild(e.target.value)} placeholder="123456789012345678" inputMode="numeric" className="font-mono max-sm:h-10" />
                </label>
                <label className="block min-w-0 text-sm">
                  <span className="mb-1 block text-muted-foreground">Chats an hour</span>
                  <Input value={hour} onChange={(e) => setHour(e.target.value)} placeholder="30" inputMode="numeric" className="tabular-nums max-sm:h-10" />
                </label>
                <label className="block min-w-0 text-sm">
                  <span className="mb-1 block text-muted-foreground">Chats a day</span>
                  <Input value={day} onChange={(e) => setDay(e.target.value)} placeholder="100" inputMode="numeric" className="tabular-nums max-sm:h-10" />
                </label>
                <Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save cap"}</Button>
              </div>
            </form>
          </div>
        )}
      </Async>
    </Section>
  );
}
