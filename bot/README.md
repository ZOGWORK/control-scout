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
| `/follow event: channel:` | The same for a whole event instead of a team: the evening before it starts, its schedule once posted (a line per competition day), and a recap at the end of each day. Manage Server only |
| `/unfollow team: event: channel:` | Stop them (every channel if none is given). Manage Server only |
| `/following` | What the server follows — teams and events — and where each posts (up to 10 in all) |
| `/ask question:` | Anything in plain words, answered with the website's own search answer (below), with buttons for what to ask next |
| `@Control Scout question` | Chat with Bruno AI, as a reply; reply to his answer to keep talking, and 👍/👎 an answer |
| `/config` | What the bot is and can do here, read live: the release it runs, the account it is and how many servers it is in, the season, the site it talks to, chat on (or why it isn't) and the chat limit this server has, report filing, the follow posts, whether its commands are registered globally or only in the test server, and when it last reached Discord. Private, Manage Server only |
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
buttons instead. An answer Bruno helped with carries **Bruno AI, from Control Point** in the footer above Control
Scout's line; a deterministic one never does. Bruno off, unconfigured, failing or slow: the deterministic answer
posts anyway.

**The answer's buttons** (`bot/buttons.ts`). Every answer with something to offer carries one row of questions and
one row of links: up to three questions to ask next (search's own suggestions for a question it couldn't answer, else
the answer's related ones), a link button to the same answer on controlscout.org, and a link button per video. A
question lives in the bot's process for an hour, not in the button's custom id (Discord allows 100 characters, which
is not a question), so a button clicked within the hour asks it as `/ask` would — same cache, same limit, same
server memory — and one clicked later, or after a restart, says it has expired and names `/ask`. Follows are
deliberately not buttons: a button would let anyone follow without Manage Server.

**👍 and 👎** (`bot/reactions.ts`). The bot adds both to every answer it posts; a click is counted on that one answer
and nowhere else, with no record of who clicked. The owner console shows the totals beside the bot's other numbers.

**What it was asked** (`bot/asks.ts`, migration 104). Every ask is recorded — the words as typed with personal data
redacted, the step search answered it at, whether Bruno's chat answered it, and how long it took; never who asked,
only the server. The owner console lists the questions it couldn't answer, most asked first. A **records question**
search couldn't answer and no chat did is also fed to the site's own failed-search queue
(`server/searchFailures.ts`, `noteBotSearch`: one slot per question, so a server's questions never supersede each other
and none spends a website visitor's hourly report cap), so the phrasings people actually use in Discord reach the
website's search work list too; the bot flushes that queue once a minute from its own process. A greeting, an answer
search gave, and a chat that answered it are not failed searches and are never filed.

Pace: none per person — every message is answered, so two in a row get two answers. Only the same question within
a minute is the answer already given (one lookup, whoever asks). Every ask is logged as the command, the step, whether Bruno helped
and the time, never who asked. The bot reads the site's search index and never writes it.

**Per-server chat limits: built, off by default.** `bot/quota.ts` caps a server at `perHour` chats a UTC hour and
`perDay` a UTC day, counted in UTC windows, but no server has a cap until one is set: the default (`DEFAULT_LIMIT`) is
none in either window, and an uncapped chat is allowed at once and writes nothing. A server with a row in
`discord_limits` has that cap instead; a row replaces both windows, and a zero or a null there is no cap for that
window, while `clearGuildLimit(guild)` deletes the row and leaves the server uncapped again. Both are the owner
console's write (Product › Discord bot, `server/portal/discordLimits.ts`): it lists every server the bot knows with its
cap and what it has used today, and sets or clears one server's cap, every change in the audit log. Either write
deletes that server's usage, so its counters start with its cap: nothing it asked earlier counts against it. At a cap,
`/ask` and a mention get a plain note with when it resets, while the site and the server's follow posts keep working.
`/config` says which limit the server it was asked in has — `none` until the owner sets one.

**"Report this to ControlScout"** (`bot/report.ts`): a message with those words — any case, `Control Scout` or
`ControlScout` — files one GitHub issue titled `Discord type issue`, through the site's own GitHub path
(`server/errorReports.ts` `gh`, `GITHUB_REPORT_TOKEN`, the same token and client the site's error reports use, so no
second secret). The issue carries the message that asked, the turns of the thread it replies to, the server, channel and
user ids, the asker's display name, the bot's last 20 log lines and the release. The bot answers with the issue number
and link, and **one message files one issue**: asking again for the same message (even twice at once) points at that
issue, while two members' different reports are two issues, each keyed by its own message. A report that can't be filed
(no token, GitHub refusing) says so in the channel and logs the reason, never throws; over the cap — `REPORT_LIMITS`,
3 an hour per person and 8 per server, through the site's own `takeReportSlot` — it says that instead, and nothing is
filed. The phrase is the only gate: any member can report, which is the point of it. A report is never counted as a
chat, so a server at its cap can still report a bug.

Whether reporting is wired up is said once at startup (`report filing on: GITHUB_REPORT_TOKEN is set`, or `report
filing off: …`), so the journal answers it — `journalctl -u control-scout-bot | grep 'report filing'` — without filing
a test issue. It says whether the variable is set, never its value; a token added later shows on the next restart.

**What it is and can do, at startup** (`bot/config.ts`): nine lines starting `config:`, said once the database is open —

```
config: release 8f6f706044289bd4fa632aaa84a9b1d15434c1c8
config: bot Control Scout#1234 in 4 servers
config: season 2025 (2025–26 DECODE)
config: site http://127.0.0.1:3000 (its own API, on loopback)
config: slash commands globally (no DISCORD_DEV_GUILD_ID)
config: chat on: Control Point is configured and the discordBruno switch is on
config: report filing on: GITHUB_REPORT_TOKEN is set
config: follow posts on — 12 follows in 4 servers (a tick a minute while connected)
config: discord not connected now (last connected 2 minutes ago)
```

`/config` adds a tenth line for the server it was asked in: `config: chat limit none (the default: no cap)` — or
`config: chat limit 60 an hour, 300 a day (set for this server)`, or that the limit couldn't be read.

so `journalctl -u control-scout-bot | grep 'config:'` answers "what can this bot do here, and what is it missing?" in
one look: the chat says `off —` with the reason ask.ts itself gives (Control Point unconfigured, or the switch off), the
follows are counted (or it says none yet, or that they couldn't be read), the commands are placed (`globally`, or `in
server <id> only (DISCORD_DEV_GUILD_ID)`), and no line ever carries a secret's value. The release is the commit
`/api/health` reports (the `RELEASE` file the deploy writes; `development` without one). The bot line is the ready
line's two facts — its Discord tag and how many servers it is in (`guilds.cache`, updated as it is added or removed);
the gateway only knows them once it reports ready, so before that (the startup block, or a bot that hasn't connected)
the line says so rather than claiming 0 servers. The Discord line is when this process reached the gateway, or —
before it has, as at startup — the last heartbeat it wrote (`service_heartbeats`, once a minute while connected),
which outlives a restart. `/config` (Manage Server, answered privately) shows the same nine lines in Discord, read
live — same function, so the two can't disagree — plus the chat limit of the server it was asked in, which the startup
block has no server to know, with the times as Discord timestamps (`<t:…:R>`), so "3 minutes ago" is in each reader's
own clock.

The issue is as public as the repository's issues: it posts what
the channel said, which is the point of the request — with an `@mention` and a `#123` neutralised, since it's filed
under the bot's own GitHub identity and a member must not be able to ping a stranger or cross-reference an issue with it.

**What a server teaches it.** `bot/memory.ts` (migration 100) keeps three things per server, so answers get smarter the
longer it's there: `discord_guild_teams`, the teams its people ask about (a 3 to 5 digit number that could be one —
years are skipped, so "who won decode 2025" teaches nothing), most asked first; `discord_people`, the name each person
goes by there; and `discord_threads`, a reply thread's last 6 turns, kept 14 days. Every chat gets two lines the model
reads — the server's teams ("when a question doesn't name a team, it means one of these, and say which one you
picked") and the asker's name — so "what was our auto OPR last event" resolves to the team the server keeps asking
about, and an answer can use the person's name. The answer style asks for one short suggested next question the facts
can answer ("Also want 4215's record?"), so a good answer offers the follow-up instead of waiting to be asked. Both
tables are private: a Discord id, the name Discord already shows, and nothing else. All of it is deleted when the bot
is removed from a server (`bot/forget.ts`): the follows and the posts they sent, the chat limit and its usage, the
teams, the names and the reply threads — which is why a thread records its server now (migration 102). A server that is
only unreachable (`GuildDelete` with `available: false`, a Discord outage) is not a removal, and keeps everything.

The owner console's Discord bot panel lists each server by the name Discord shows (kept on join, on a rename and once
at startup) beside its id, and shows the bot's own numbers: chats today and this week, the share answered and the share
Bruno answered (the rest fell back to the card), the middle answer time, the follow posts sent today and the thumbs. A
name Discord hasn't sent since names were kept reads "Name not known yet" rather than a guess.

**His name is Bruno, and he's a golden retriever in spirit.** `brunoPersona()` (`bot/productFacts.ts`) goes with every
chat: friendly, loyal, eager to help, a little goofy, never pushy — a light touch, not a paragraph of self-introduction,
and software rather than a real dog or a person. `brunoMethod()` goes with it: work out what is really being asked (a
follow-up leans on the thread and the channel's teams), pick the fact that answers it, show a calculation's steps
briefly, and say what's missing rather than guess. Both sit inside Control Point's 400-character fact cap, like every
other line sent with a chat.

**@mention answers: a chat with Bruno.** `@Control Scout who won decode` or `@Control Scout hi bruno` goes to Control
Point's Bruno chat (`POST /internal/bruno/discord-chat`) with the facts the website's search found for it, and his
reply posts as plain text, like a chat: a greeting gets a greeting, a records question gets the answer, with the
answer's video and a small "more on controlscout.org" link only when the records answer it. An explanation question
("explain a coaxial swerve") gets a short structured answer — a one-line **bold** summary, then a couple of short
paragraphs or up to five `- ` bullets, key terms in bold, about 600 to 1,200 characters — where a records question
stays the number first and a line or two: the shape is one more instruction sent with his facts (`answerStyle()` in
`bot/productFacts.ts`), inside Control Point's 400-character line cap. A request to explain how to build something
("write a detailed guide on making a coaxial swerve drive") is a third shape: a one-line answer, then three to six
numbered steps with the parts, sizes and numbers it takes — it used to fall between the two and come back as two
sentences plus an OPR question. That closing records question ("Also want 4215's record?") is asked only on a records
answer now, never on a guide or an explanation.

**A message that asks several things** is looked up part by part before he answers (`bot/tools.ts`): the message is
split where another question starts — "what is like the best team rn, where are they from and what is their auto opr"
is three parts, while "4215 and 6980 opr" stays whole because the words after "and" aren't a question — filler words
like "like" and "rn" are dropped, each part is searched on its own with learning off, and every part's facts are sent
after the message's own, up to three parts and eighteen lines, each part keeping its share so a broad board can't crowd
out the follow-up's records. A part that finds nothing adds nothing; his method line then says to answer each part the
facts cover and name the part they don't. The board a "best team" question answers with carries where the team is and
its OPR phases (`server/api/searchBrunoAnswer.ts`), so "where are they from" and "their auto opr" are answered by the
same answer.

**A part that leans on an earlier one** is asked with its subject, never as the dead fragment nobody can search: a
pronoun takes the team the earlier part's answer names — after a board whose #1 is 23268, "where are they from" asks
"where are 23268 from" and "what is their auto opr" asks "what is 23268 auto opr" — and a part with nothing but its own
frame is asked as the thing it asks about, so "…and who is by" after "what is the bio buzz world record" is
"bio buzz world record", the record's card naming the alliance that set it. That's the same question typed into
controlscout.org/search, and the same answer comes back.

**The records post beside his words.** When search found the records a chat is about, the answer posts as Bruno's text
*and* the site's card: the same board or record card `/search` shows, its video and its "ask next" buttons, linked to the
part's own answer rather than the whole message search. A message search couldn't read, and Control Scout's own
fallback for a greeting, post as text alone — never a "Sorry" card next to a good answer.

**A reply of "yes"** to the question he ends an answer with — "Also want 4215's record?" — asks that question (`bot/ask.ts`
`affirmative`/`offeredQuestion`): the offer is read from his last turn in the thread, the answer is searched as
"4215's record", and the post quotes that rather than the word so the thread carries on from it. Without an offer the
message is asked as typed. **A reply of "no"** to that offer declines it — "No problem — I'll leave 4215's record for
now" — with nothing searched, since the word alone is no more a question than "yes" was; a no with a question after it
("no, what about 6980") is asked as typed.

Replying to his answer
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
  (`discord_follows`, `discord_posts` from migrations 35 and 104, `discord_guilds`, `discord_asks` and
  `discord_answers` from 104, all created by the site's deploy), plus its `service_heartbeats` row
  once a minute while connected, which the site's /status page reads (`server/uptime.ts`, migration 86). Its missed
  records questions go into the site's `search_failures` through the site's own `noteBotSearch`.
- **Automatic posts** (`bot/follows.ts`): every minute it reads the follows, the followed teams' matches at
  events on today, and posts what's due: a reminder within 15 minutes of a start, a result within 6 hours of
  it. Only matches starting after the follow (no backlog). Each post is claimed in `discord_posts` before it's
  sent, so nothing posts twice; a passing failure retries, a channel that's gone is dropped after 5 failures.
  A follow is a team (`team:4215`) or an event (`event:USTXAUQ`) by its `target` key, so the two never collide; an
  event follow posts the event's evening-before, schedule and day recaps, keyed `event:` and never a per-match post.
  An event follow also carries the season it was made in: codes repeat, so last season's `event:USTXAUQ` never ticks
  this season's event of the same code, and following that code again this season moves the follow forward.
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
   are needed and none is switched on in the portal: the bot asks for `Guilds`, `GuildMessages`,
   `GuildMessageReactions` and `DirectMessageReactions`, all of them non-privileged. The reaction intents are
   what deliver a 👍/👎 on an answer; without them the bot adds the emoji and never hears the click.
4. **Installation:** set the install link to "None" (the site's invite link is used instead), or to the
   same scopes and permissions as below.

## Invite link

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=2147502144
```

- Scopes: `bot` and `applications.commands`.
- Permissions `2147502144` = Send Messages (2048) + Embed Links (16384) + Add Reactions (64) + Use Application
  Commands (2147483648). Nothing else: the bot never reads messages, manages anything or joins voice. A server that
  invited the bot before 7.9.2 has no Add Reactions, so its answers get no 👍/👎 until the bot is re-invited with this
  link; nothing else changes for it.

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
