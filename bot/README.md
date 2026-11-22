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

`bot/ask.ts` takes the same path `/search` does, in the bot's own process, with the chat first:

1. `searchAnswer(q, { learn: false })`: the deterministic facts Bruno reads, always. Numbers only from stored data.
   Its answer is also the card that stands in when no chat replies.
2. Every ask, when the bot's `discordBruno` switch is on and Control Point is configured: Bruno's chat (below). His
   reply is the post; search's rewrite isn't asked for first.
3. Only when that chat gives nothing: `refine(q)` for a weak answer (`did-you-mean`, `recovery`), and (for callers
   without the chat) `brunoAnswer(q)`, his one sentence from search's facts, dropped by the site's `grounded()` check
   if any number isn't in them.

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

Pace: none per person — every message is answered, so two in a row get two answers. Only the same question within
a minute is the answer already given (one lookup, whoever asks). Every ask is logged as the command, the step, whether Bruno helped
and the time, never who asked. The bot reads the site's search index and never writes it.

**Per-server limits: built, none set.** `bot/quota.ts` holds a server's cap (chats per UTC hour and per UTC day,
table `discord_limits`) and counts usage (`discord_chat_usage`) only once a server has one. A server with no row —
every server today — is unlimited: nothing is counted, nothing is written and nothing is refused. At a cap, `/ask`
and a mention get a plain note with when it resets, while the site and the server's follow posts keep working.
`setGuildLimit(guild, { perHour, perDay }, by)` sets or clears one; a zero or a null is no cap.

**What a server teaches it.** `bot/memory.ts` (migration 100) keeps three things per server, so answers get smarter the
longer it's there: `discord_guild_teams`, the teams its people ask about (a 3 to 5 digit number that could be one —
years are skipped, so "who won decode 2025" teaches nothing), most asked first; `discord_people`, the name each person
goes by there; and `discord_threads`, a reply thread's last 6 turns, kept 14 days. Every chat gets two lines the model
reads — the server's teams ("when a question doesn't name a team, it means one of these, and say which one you
picked") and the asker's name — so "what was our auto OPR last event" resolves to the team the server keeps asking
about, and an answer can use the person's name. The answer style asks for one short suggested next question the facts
can answer ("Also want 4215's record?"), so a good answer offers the follow-up instead of waiting to be asked. Both
tables are private: a Discord id, the name Discord already shows, and nothing else.

**@mention answers: a chat with Bruno.** `@Control Scout who won decode` or `@Control Scout hi bruno` goes to Control
Point's Bruno chat (`POST /internal/bruno/discord-chat`) with the facts the website's search found for it, and his
reply posts as plain text, like a chat: a greeting gets a greeting, a records question gets the answer, with the
answer's video and a small "more on controlscout.org" link only when the records answer it. An explanation question
("explain a coaxial swerve") gets a short structured answer — a one-line **bold** summary, then a couple of short
paragraphs or up to five `- ` bullets, key terms in bold, about 600 to 1,200 characters — where a records question
stays the number first and a line or two: the shape is one more instruction sent with his facts (`answerStyle()` in
`bot/productFacts.ts`), inside Control Point's 400-character line cap. Replying to his answer
carries the thread on (the bot remembers its last 2,000 threads in memory, up to 6 turns each, and keeps them in the
database, so a restart carries on where the conversation was: `bot/memory.ts`). `/ask` answers the same way, with the question quoted. Every number in his reply must be in the facts, the
message or the thread, or the website's answer card posts instead, as it does when Bruno is off (`discordBruno`),
unconfigured, slow (45 s: a model reply takes about 11 s on the live deployment, and a structured explanation longer)
or failing. Same cache and 3-second
pace as every command. While a mention waits, the typing indicator is kept up.

**Why a chat didn't happen** is in the bot's log, never the message or the key: `[bot] chat off: Control Point isn't
configured (…)`, `[bot] chat off: the discordBruno switch is off`, `[bot] chat failed: Control Point answered 404` (or
a timeout), `[bot] chat dropped: numbers not in the facts: …`, `[bot] chat empty: Bruno sent no reply`. Control Point
caps one fact line at 400 characters and refuses the whole packet past it, so every fact is cut to that before it's
sent.

**One honest fallback.** A short message that isn't a records question and that no chat answered ("hi", "who are
you", "who's your favourite person here", "thanks") gets one line from `bot/smallTalk.ts`, credited to Control Scout
rather than Bruno. There are no keyword replies, so it never guesses a favourite or invents a fact instead of answering
in character. A message with a record number in it (a team, a season, a score), or a longer one search couldn't
answer, is still a real question and keeps the honest card.

A **ratio or a measurement** is not a record number, and a **working question** (a mechanism, maths, an angle, a unit)
is not a records question however long it is: `bot/smallTalk.ts`'s `RECORD_NUMBER` (no `42:15`, `1:1`, `12.4 OPR`,
`35 degrees`, `42 mm`) and `WORKING` (a ratio, or gearing, turret, motor, drivetrain, cosine, sine, tangent, angle,
radians, volts, torque…). Two things follow. The model's own numbers in an explanation are never refused as a record
claim because the message had digits in it — the screenshot's "should I use a 42:15 gear reduction on my robot turret"
was answered "Sorry — I can't answer that yet. I read it as: Team 12499 Gear Up" because of exactly that. And when no
chat answers a working question, it gets the one plain line instead of search's guess at a team: a gearing question has
nothing to do with team 12499, and "the cosine of pi radians" nothing to do with team 6570 Piradians.

**It answers the channel's own questions.** `answerScope()` (`bot/productFacts.ts`) goes with every chat: answer any
question the channel asks — a cosine, a gear ratio, a rule, a design trade-off — concretely, and never refuse just
because it isn't about the records. FTC numbers still come only from the facts sent with the message, so "smarter"
never means inventing a team's OPR.

Which line it is depends on the chat, not on luck: a chat that is off, unconfigured or switched off says so — it can't
chat right now, its AI answers aren't reachable, and it can still read the records. A chat that is there and gave
nothing about this one message (a reply with a number the facts haven't, an empty one, a failure) says only that this
message got no answer, and still offers the records: claiming the AI is unreachable there would contradict the answer
it posted a moment earlier in the same channel.

Only a message from a person in a
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
  asking for the same match cost one lookup. Nobody is paced per person: every command and every mention is
  answered, however fast it follows the last. Autocomplete reads the event list once a minute and returns at
  most 25 choices.
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
| `CONTROL_POINT_INTERNAL_URL`, `CONTROL_POINT_INTERNAL_KEY` | Required for Bruno's chat (and his query rewrite and one-sentence answer): `http://127.0.0.1:3000` on the VM, and the same secret as Control Point's `CONTROL_SCOUT_INTERNAL_KEY`. The bot reads the site's own `.env` (systemd `EnvironmentFile`), so when Control Point sign-in works on controlscout.org these are already set. Unset: every mention gets the card, and the log says `chat off: Control Point isn't configured`. |
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
