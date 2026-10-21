// "Control Scout in Discord" (My teams): add the bot to a server, then follow your teams in a channel with the
// exact command ready to copy, and every command the bot knows. Hidden until the bot has an invite link
// (src/shared/discord.ts). The bot does the following itself (bot/follows.ts): no account linking needed.
import { useState } from "react";
import { Check, Copy, ExternalLink, MessageSquare } from "lucide-react";
import { BOT_COMMANDS, discordInviteUrl } from "../shared/discord";
import { copyText } from "../lib/clipboard";
import { Button } from "./ui/button";

export function DiscordCard({ teams }: { teams: number[] }) {
  const invite = discordInviteUrl();
  if (!invite) return null;
  return (
    <section aria-labelledby="discord-card-h" className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-discord-card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 id="discord-card-h" className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-[#5865f2]/15 text-[#7983f5]" aria-hidden><MessageSquare className="size-4" /></span>
            Match alerts in your Discord
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add Control Scout to your team's server, then follow your team in a channel. It posts the evening before each event, the team's schedule with win odds once it's out, 15 minutes before each match, every result with whether the call was right, and a recap at the end of each day.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <a href={invite} target="_blank" rel="noreferrer noopener" data-discord-invite><ExternalLink /> Add to a Discord server</a>
        </Button>
      </div>
      {teams.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">Then, in the channel you want the posts in (needs Manage Server):</p>
          <ul className="mt-2 flex flex-wrap gap-2">{teams.map((t) => <li key={t}><CopyCommand text={`/follow team:${t}`} /></li>)}</ul>
        </div>
      )}
      <details className="group mt-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground hover:text-accent-text">Everything the bot can do</summary>
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {BOT_COMMANDS.map((c) => (
            <div key={c.usage} className="contents">
              <dt className="font-mono text-xs text-foreground sm:pt-0.5">{c.usage}</dt>
              <dd className="text-muted-foreground max-sm:mb-1">{c.what}{c.admin && <span className="text-xs"> · Manage Server</span>}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function CopyCommand({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => { if (await copyText(text, "Command copied: paste it in Discord", "Couldn't copy the command", text)) { setDone(true); setTimeout(() => setDone(false), 1500); } };
  return (
    <button type="button" onClick={copy} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 font-mono text-sm hover:border-accent/50" aria-label={`Copy ${text}`}>
      {text}{done ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5 text-muted-foreground" aria-hidden />}
      <span className="sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </button>
  );
}
