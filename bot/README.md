# Control Scout Discord bot

A public bot any FTC team can add to its own Discord server. Slash commands, each answering with
an embed that links back to controlscout.org:

| Command | What it shows |
| --- | --- |
| `/team number:` | Location, season record, OPR (total and auto / TeleOp / endgame), world ranking, next event (or the last one) |
| `/predict event: match:` | The lineup, the favourite's win chance (or "Even call"), the predicted score and its confidence for a qualification match. Once it's played: the score, and the call against it (called, upset, or an even call) |
| `/event code:` | Dates, place, status, matches played, top 5 by OPR, and the winning alliance once it's over |
| `/rankings` | The world top 10 by rating, with movement since last week |
| `/follow team: channel:` | Automatic posts in a channel: the evening before each event, the schedule once posted, 15 minutes before each match, each result, and a recap at the end of each day. Manage Server only |
| `/unfollow team: channel:` | Stop them (every channel if none is given). Manage Server only |
| `/following` | The server's followed teams and where each posts (up to 10 per server) |
| `/ask question:` | Anything in plain words, answered with the website's own search answer (below) |
| `@Control Scout question` | Chat with Bruno AI, as a reply; reply to his answer to keep talking |
| `/help` | Every command, from the same list the site shows (`BOT_COMMANDS` in `src/shared/discord.ts`) |

## /ask

`bot/ask.ts` takes the same path `/search` does, in the same order, in the bot's own process:

1. `searchAnswer(q, { learn: false })`: the deterministic answer, always. Numbers only from stored data.
2. Only when that answer is weak (`did-you-mean`, `recovery`), the bot's `discordBruno` switch is on and Control
   Point is configured: `refine(q)`. Bruno rewrites the query; search runs again on his words.
3. Every ask (/ask is a question however it's typed; sent with a "?" so the site's question check passes),
   `discordBruno` on and Control Point configured:
   `brunoAnswer(q)`. A sentence from search's facts; dropped by the site's `grounded()` check if any number isn't in them.

**Bruno is the bot's own switch.** `discordBruno` (owner console, "Bruno AI in the Discord bot", on by default) is
the only one /ask reads. The website's `brunoSearch` and `brunoAnswers` only ever affect /search, so Bruno can
answer in Discord while the website stays search-only.

**Short by design.** The answer only: a stat's headline alone when it has one ("who won decode" is one line: the
champions and the finals scores), else its first block cut at 3 rows; a card's headline and 3 lines; 3 top results.
About 500 characters as read at most. Everything else (more blocks, the source) is behind the link. The embed also
carries Bruno's sentence quoted, and a link to the same answer on controlscout.org. Questions it
can't answer get "Sorry — I can't answer that yet", what was read, and questions that work as copyable
`/ask question: …` text (no buttons). An answer Bruno helped with carries **Bruno AI, from Control Point** in the
footer above Control Scout's line; a deterministic one never does. Bruno off, unconfigured, failing or slow: the
deterministic answer posts anyway.

Pace: the same as every command (one per person every 3 seconds, no longer wait for /ask); the same question
within a minute is the answer already given. Every ask is logged as the command, the step, whether Bruno helped
and the time, never who asked. The bot reads the site's search index and never writes it.

**@mention answers: a chat with Bruno.** `@Control Scout who won decode` or `@Control Scout hi bruno` goes to Control
Point's Bruno chat (`POST /internal/bruno/discord-chat`) with the facts the website's search found for it, and his
reply posts as plain text, like a chat: a greeting gets a greeting, a records question gets the answer, with the
answer's video and a small "more on controlscout.org" link only when the records answer it. Replying to his answer
carries the thread on (the bot remembers its last 2,000 threads in memory, up to 6 turns each; a restart forgets
them). `/ask` answers the same way, with the question quoted. Every number in his reply must be in the facts, the
message or the thread, or the website's answer card posts instead, as it does when Bruno is off (`discordBruno`),
unconfigured, slow (15 s) or failing. Same cache and 3-second pace as every command. Only a message from a person in a
server that mentions the bot itself, or replies to its post: not @everyone or a role. Discord sends a bot the text of
messages that mention it (a reply pings it) without the Message Content intent, so the bot reads nothing else; a
reply that arrives without its text is left alone.

`event` and `code` autocomplete over events on now, coming up, or finished in the last 3 days (name or
code; you can also type a code yourself).

## How it works

- **Its own process.** `bot/index.ts` runs under its own systemd unit, `control-scout-bot`. A bot crash,
  restart or deploy never touches the site, and the other way round.
- **Same data, no API.** It imports the site's own modules (`server/api/teams.ts`, `events.ts`,
  `rankings.ts`, the prediction engine) and reads the same database, so its numbers are the site's. It
  never calls the site over HTTP and never runs migrations; it writes only its own tables
  (`discord_follows`, `discord_posts`, migration 35, created by the site's deploy), plus its `service_heartbeats` row
  once a minute while connected, which the site's /status page reads (`server/uptime.ts`, migration 86).
- **Automatic posts** (`bot/follows.ts`): every minute it reads the follows, the followed teams' matches at
  events on today, and posts what's due: a reminder within 15 minutes of a start, a result within 6 hours of
  it. Only matches starting after the follow (no backlog). Each post is claimed in `discord_posts` before it's
  sent, so nothing posts twice; a passing failure retries, a channel that's gone is dropped after 5 failures.
- **Load protection.** One answer per command and arguments for 60 seconds (`bot/guard.ts`): fifty people
  asking for the same match cost one lookup. One command per person every 3 seconds (a private "Slow
  down" reply). Autocomplete reads the event list once a minute and returns at most 25 choices.
- **Always answers.** Replies are deferred before any lookup, so nothing dies with "The application did
  not respond". Every failure is a short embed; unexpected ones (the database busy or down) say "Try
  again in a minute" and are logged with the command and arguments, never shown.
- **Commands register on boot**, and only when they changed (a restart is a no-op; registration is a
  bulk overwrite, so nothing is ever registered twice).

## Discord developer portal setup (once)

1. Go to <https://discord.com/developers/applications> → **New Application**, name it "Control Scout".
   Add the icon from `brand/`.
2. **General Information:** copy the **Application ID**. This is the client ID: put it in
   `DISCORD_CLIENT_ID` in `src/shared/discord.ts` (it's public) and the FAQ answer and footer link appear.
3. **Bot:** **Reset Token** and copy it into the server's env file as `DISCORD_BOT_TOKEN` (never commit it,
   never paste it anywhere else). Leave **Public Bot** on so any team can add it. No privileged intents
   are needed (the bot only uses the `Guilds` intent).
4. **Installation:** set the install link to "None" (the site's invite link is used instead), or to the
   same scopes and permissions as below.

## Invite link

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=2147502080
```

- Scopes: `bot` and `applications.commands`.
- Permissions `2147502080` = Send Messages (2048) + Embed Links (16384) + Use Application Commands
  (2147483648). Nothing else: the bot never reads messages, manages anything or joins voice.

`discordInviteUrl()` in `src/shared/discord.ts` builds exactly this link.

## Environment

| Variable | |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Required. Missing or wrong: the bot logs one line and exits with code 78, which systemd doesn't restart. |
| `DISCORD_DEV_GUILD_ID` | Optional. A test server's ID (Discord: Developer Mode → right-click the server → Copy Server ID). Commands register there instantly instead of globally (global registration can take up to an hour to appear). |
| `DATABASE_URL`, `DATA_DIR`, `CANONICAL_URL` … | The site's own settings, read from the same `.env` (links use `CANONICAL_URL`, controlscout.org in production). |

## Run it locally

```bash
npm install
# .env: DISCORD_BOT_TOKEN=… and DISCORD_DEV_GUILD_ID=<your test server>
npm run bot
```

It reads the local database (`.data/scout.db`, the same one `npm run dev` uses); run the site once first
so the shipped snapshot is restored. On ready it logs `ready as Control Scout#1234 in N servers` and
whether the commands were registered or unchanged.

Tests: `npx vitest run bot`.

### See every message in a test server

```bash
# .env: a TEST application's DISCORD_BOT_TOKEN, DISCORD_DEV_GUILD_ID, and DISCORD_TEST_CHANNEL_ID (a channel there)
npm run bot:test-post          # every post design, from the real Nov 7, 2026 meet (bot/fixtures)
npm run bot:test-post -- tick  # the real minute tick on the local database: posts once, nothing with the bot off
```

It refuses to post unless the channel belongs to `DISCORD_DEV_GUILD_ID`. Never point it at a live server.
For `tick`, sync the meet first: `npm run sync -- --event 2026:USNJNEM3`.

## How the messages read

- **One story, told once, in the description.** Fields only for lists (schedule lines, the eve's teams,
  the top 5). Every team number in a description or list value is a link to its page (field names can't
  hold links; the schedule's lines name each team as `10243 Gear Grinders` instead, in a monospace match/time
  column, and a long schedule continues in the next field).
- **Result:** the score line (winner bold), then the story: `Called it ✅ — Red 68% (predicted 72–58), won by
  22.` / `Upset ❌ — Blue was 71% (predicted 55–74), Red won by 18.` / `Even call — predicted Red by 4, Red won
  by 16.`, then `Next: Q21 · 5:10 PM · Match · Event` when the followed team has another match (else just the
  event link).
- **Pride borders.** Every embed sent (posts, answers, errors) takes one of the pride flag's six colours,
  picked from its title (`pride` in `bot/views.ts`).
- **A favourite needs 55%.** A call that reads 45–55% is an even call: no verdict, and it isn't counted in the
  day recap's `Calls: N of M right`.
- **Reminder:** the followed team's side, partner and time, then the lineup and the call with its confidence
  in plain words once. No win bars.
- **Footer:** `Control Scout • controlscout.org`, plus the call's kind only when it isn't live: `Replayed call`
  or `From today's ratings`.
- **Budgets** (tested on the real Q16/Q17): a result is at most 4 blocks (title + description lines + fields)
  and 600 characters as read; a reminder 3 blocks and 400; a field never past Discord's 1,024 characters
  (a schedule continues in the next field, at most 15 matches, then `…and N more`).

## On the VM

`deploy/oracle-vm-setup.sh` (run by every deploy) writes `/etc/systemd/system/control-scout-bot.service`:
the same user, release directory and `.env` as the site, `Restart=always` except on exit 78, a 1.5 GB
Node heap under a 2 GB memory cap (768 MB gave Node about 380 MB, which the bot outgrew with the full data) and a
lower CPU priority than the site. When `DISCORD_BOT_TOKEN` is set in
`/opt/control-scout/shared/.env` the deploy enables and restarts it after the site; without one the unit is
disabled. A bot that fails to start never fails a deploy.

```bash
sudo systemctl status control-scout-bot
sudo journalctl -u control-scout-bot -f
sudo systemctl restart control-scout-bot   # after adding or changing the token
```

On SIGTERM (a stop or restart) it disconnects from Discord and exits within a few seconds.
