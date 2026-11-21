# Control Scout v8: full design revamp brief

**Status: approved 2026-11-18, building.** Answers: Q1 dark only first; Q2 faint white fill; Q3 90% is the new 100%; Q4 wave order as written; Q5 no page transition (Sushil: use the recommendation if a fade slows things down; it does).

Guided by Emil Kowalski's design-engineering approach (the `emil-design-eng` skill) and by what the sample home already taught us (`/preview/home`, PRs #1966–#1969).

---

## 1. Why, and what "done" looks like

Control Scout works. It needs to *feel* like one product, made with care, on every page. Two lessons from the sample home:

- **90% zoom looks better.** The sample home looked best at 90% browser zoom: tighter type and smaller controls, so the content breathes instead of the chrome. v8 is sized for that from the start (see 3.2), so nobody has to zoom out.
- **Calm beats loud.** The sample home looks better with:
  - near-black surfaces and one wash at the top;
  - white and grey type;
  - one soft accent, used sparingly;
  - red only for live;
  - plain buttons.

**Done means:**
- Every page uses the same tokens, components and motion.
- No page still looks like the old yellow app.
- Nothing about the data, the URLs or what a page can do is lost.

## 2. Principles (how every decision is judged)

1. **Unseen details compound.** Most of v8 is things nobody will notice one at a time: buttons that answer a press, menus that grow from what you clicked, numbers that line up, a hover that doesn't stick on a phone. Together, they make the site feel right.
2. **The data is the hero.** This is a scouting tool. Numbers, names and match calls get the contrast; frames, borders and labels step back.
3. **One accent, earned.** Mint marks the one thing on a screen that is "yours" or "best" (progress, the #1 rank, the selected tab).
   - It is never a button fill.
   - Red means live or the red alliance; blue means the blue alliance. Nothing else uses them.
4. **Motion only when it explains something.** How often you see a thing decides whether it moves at all (section 4). The site is a crisp dashboard, not a playful toy.
5. **Good defaults beat options.** Fewer settings that each look great. A new component ships with good defaults, so a page can't get it wrong.
6. **Cohesion.** Type, spacing, radius, colour and motion all say the same thing: quiet, fast, precise.
7. **Every state is designed.** Loading, empty, error, offline, signed out, no team, huge numbers, long names. Each one gets designed on purpose; nothing is left to whatever happens to render.

## 3. Foundations

### 3.1 Colour

| Token | Value (dark) | Use |
|---|---|---|
| `bg` | `#0a0a0b` | Page |
| `surface-1` | `#0e0e10` | Sidebar, cards |
| `surface-2` | `#141416` | Menus, popovers, raised rows |
| `surface-3` | `#1b1b1e` | Inputs, hover fill |
| `line` | `white / 6%` | Hairlines between things |
| `line-strong` | `white / 12%` | Inputs, outlined buttons |
| `text` | `#f4f4f5` | Names, numbers, headings |
| `text-muted` | `#a1a1aa` | Labels, secondary lines |
| `text-faint` | `#71717a` | Captions, units (OPR, "played") |
| `accent` (mint) | `#7fd1ae` | See principle 3 |
| `live` | `#f2555a` | Live dot and live icons only |
| `red-alliance` / `blue-alliance` | as now | Alliance only |
| `success` / `warning` / `danger` | quieter versions of today's | Status text and icons, not fills |

- **Yellow (`#ffc700`) is retired.** Today there are 313 `bg-accent` uses. Most become neutral (a white/8% fill, or nothing at all). Only a handful become mint.
- **The wash:** each top-level page gets the dusky slate-to-mauve wash at the top, at the sample-home strength. Inner pages (team, event, match) get a shorter, fainter wash, so content starts high.
- **Hard-coded colours:** today there are 80 hex colours in components. Every one becomes a token.

### 3.2 Type and size (the "90%" scale)

- **Root size:** v8's root is 90% of today's, so 1rem ≈ 14.4px on a default browser. Everything is in rem, so the user's text-size setting and the big-screen steps (1.1× from 2100px, 1.23× from 2500px) still multiply on top.
- **Fonts:**
  - Inter for everything.
  - Space Grotesk only for the wordmark and big numbers (team numbers, scores, the hero figure).
  - JetBrains Mono only for match codes and keyboard hints.
- **Scale (at the v8 root):**

| Role | Size / line height | Weight |
|---|---|---|
| Caption | 11 / 14 | 500 |
| Small | 12 / 16 | 400–500 |
| Body | 14 / 20 | 400 |
| Body strong | 14 / 20 | 500 |
| Title | 16 / 22 | 600 |
| Page title | 22 / 28 | 600, tight tracking |
| Hero number | 32–40 | Space Grotesk 600 |

- **Numbers:** every number is `tabular-nums`, so columns line up and live updates don't jiggle.
- **Pixel sizes:** the 314 `text-[Npx]` uses are replaced by the scale above.

### 3.3 Space, radius, borders

- **Space:** a 4px grid. Cards have 16–20px padding; rows are 44px tall (the tap target stays 44px even when a row looks smaller).
- **Radius:** today there are six radius sizes in use (sm, md, lg, xl, 2xl, full). v8 has three:
  - 8px for controls and rows;
  - 14px for cards, menus and dialogs;
  - full for pills, avatars and round buttons.
- **Depth:** separation comes from surface steps plus hairlines. There are no big shadows; menus and dialogs get one soft shadow.

### 3.4 Icons

- **Library:** Lucide, at 16px in rows and buttons and 18px in the sidebar and round buttons, with stroke 1.75.
- **Colour:** icons inherit the text colour. They are never coloured for decoration.

## 4. Motion system

### 4.1 Tokens (in `index.css`, used everywhere)

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* things entering, presses, menus */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* things moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* phone sheets and the phone sidebar */
--dur-press: 150ms; --dur-small: 150ms; --dur-menu: 180ms; --dur-panel: 240ms; --dur-sheet: 380ms;
```

The rule: no `ease-in` anywhere, and nothing over 300ms except sheets, dialogs and toasts.

### 4.2 What moves, and what never does

| Thing | How often you see it | v8 motion |
|---|---|---|
| Search open (Ctrl K, `/`) | Constantly | **None.** It opens instantly, with no fade. |
| Page change | Constantly | **None.** The new page just appears (Q5). No skeleton flash under 150ms. |
| Hover on rows, links, chips | Constantly | Colour only, 150ms `ease`, and only on devices that can hover. |
| Pressing any button, chip or row | Often | Shrinks to 0.97, 150ms `--ease-out` (no shrink under reduced motion). |
| Menus, selects, popovers | Often | Fade plus 0.97 → 1, grown from the trigger (Radix origin), 180ms. Closing is faster (120ms). |
| Tooltips | Often | 150ms after a short delay; **instant** when moving from one tooltip to the next. |
| Tabs | Often | The selected marker slides 200ms `--ease-in-out`, via `transform`, not width or left. |
| Dialogs | Occasional | Fade plus 0.96 → 1 from the centre, 220ms; the backdrop fades 200ms. |
| Phone sheets and the sidebar on phones | Occasional | Slide by their own size (`translateY(100%)`), 380ms `--ease-drawer`. Drag to dismiss, and a flick is enough. |
| Toasts (Sonner) | Occasional | Sonner's own 400ms `ease`, kept as it is. |
| Live dot | Always on screen | A slow red ring every 2s. It's the one constant animation, and it's hidden under reduced motion. |
| Numbers changing live (scores, odds) | When data updates | A quick 200ms crossfade with a 2px blur; no counting up. |
| Lists and cards on first load | Once per visit | One gentle entrance per container, 30–60ms uneven stagger, never blocking clicks. Only on Home and search results. |
| Loading spinners | Rare | Spin faster (0.6s). A fast spinner makes the wait feel shorter. |

**Clean-up this implies:**
- The 6 `transition-all` uses become exact properties.
- The 11 Motion `layout`/`layoutId` animations move to CSS `transform`. We're on Motion 12, so they run on the main thread and stutter while a page loads.
- The bouncing search icon (`SearchBox` `animate-bounce`) goes.
- Pulsing skeletons calm down to a slow shimmer, or none at all.

**Reduced motion:** opacity and colour changes stay; anything that moves, scales or slides is dropped.

## 5. Components (built once in `src/components/ui`, used everywhere)

- **Buttons.** No coloured fills, ever. One primary per screen at most.
  - *Plain:* icon plus label, no fill, a white/6% hover. This is the default, as on the sample's Pick your team.
  - *Outline:* a `line-strong` border, for a second action beside a plain one.
  - *Primary:* white text on a white/10% fill with a hairline (open question Q2).
  - *Danger:* red text, plain.
  - *Round icon:* 36px.
  - Every button gets the 0.97 press and a visible keyboard focus ring (mint at 60%), with no ring on mouse focus.
- **Inputs and search.** A `surface-3` fill with a `line-strong` hairline and a mint focus ring. The big search keeps the sample-home size, with the Ctrl K hint inside.
- **Chips.** Pill-shaped with a hairline, used for Try examples, filters and season toggles. The selected chip has white text on white/10%; there is no mint chip.
- **Cards.** `surface-1`, 14px radius, a hairline, and a header row (icon, title, a quiet count on the right). The footer link sits at the bottom.
- **Tables** (rankings, records, matches, the scout pick list):
  - a sticky header in `text-faint` caps-free small text;
  - 44px rows with hairlines between them;
  - numbers right-aligned in tabular figures;
  - the sorted column marked by its header only;
  - the row hover is a fill, not a lift.
  - Virtualised lists stay as they are.
- **Match row.** One shared design everywhere: red side and blue side, scores in big tabular numbers, the winner bolder, and the call (chance to win) as a slim two-colour bar. It's used on the team, event, Home, Predict and Scout pages.
- **Tabs.** An underline marker that slides. Labels go from muted to white.
- **Menus, popovers, dialogs, sheets.** These share one surface (`surface-2`, 14px radius, one soft shadow) and the motion in 4.2. On a phone, menus with more than about six items become sheets.
- **Tooltips.** Small, `surface-2`, 125–150ms, instant on the next one. On touch, a tap shows them (this exists today as `TapTooltip`).
- **Toasts.** Sonner, restyled to the surfaces. Undo stays.
- **Status.**
  - *Live:* a red dot with the ring.
  - *Provisional or unofficial:* a quiet outlined pill.
  - *Offline:* a slim bar under the top of the page.
- **Empty, loading and error states.** One pattern: icon, one line of what's going on, and one plain action. Skeletons match the real layout, so nothing jumps when data arrives (CLS stays near zero).
- **Charts.** Follow the existing search-viz rules (zero-based bars, no gratuitous bar graphs). Restyled to the tokens, with mint used as the single highlight series.

## 6. The shell (every page)

- **Desktop (≥ 768px).** The sample-home sidebar becomes the app's sidebar.
  - At the top: the mark, "Control Scout" and the round fold button. The page list sits below; nothing sits at the foot.
  - Folding is remembered and animated with `--ease-out` over 200ms.
  - Top-right on every page: the inbox and your profile picture, which opens the profile menu (name, Settings, What's new, Owner console for the owner, Sign out).
  - There is no top bar.
  - The page title sits at the top of the content with the page's own actions on its right.
- **Phone (< 768px).** A slim top row: the menu button (top-left, as today), the mark, and the inbox and picture on the right.
  - The menu opens the same sidebar as a sheet from the left, with the drawer curve, drag to close.
  - The search button stays reachable on every page.
- **Report a bug** stays the quiet corner circle.
- **Venue light mode (`/lite`) and the pit display** keep their own stripped-down layouts, restyled to the tokens.

## 7. Pages

**Order of work:** the pages people use most come first. Each page keeps every feature it has today. For each one: what it's for, and what v8 changes.

### Wave 1: the core (most visits)
1. **Home (`/`).** The sample home becomes the real Home: search in the centre, then three cards (live, top teams, your teams). The old Home is removed.
2. **Search results (`/search`).** The answer comes first, in one card with a big number or table; related results below as plain rows. Follow-ups become chips. It has the only entrance stagger besides Home.
3. **Team (`/teams/:n`).**
   - *Header:* a big team number, the name, place and rookie year, with Follow and Compare as plain buttons.
   - *Season summary:* a row of stat tiles (rank, record, OPR and its standing).
   - *Below that:* tabs for Matches, Events, Stats and Highlights.
   - The collapsed sections stay collapsed.
4. **Event (`/events/:season/:code`).**
   - *Header:* name, place, dates, a live badge and the stream link.
   - *Tabs:* Rankings, Matches, Playoffs, Alliances and Highlights.
   - The playoff bracket is redrawn with hairlines and the shared match row.
5. **Match report (`…/match/:id`).** Two columns on wide screens, the match on the left and the call on the right (already built in 4.8.9), restyled. The score breakdown uses paired bars in alliance colours.

### Wave 2: tools
6. **Predict.** Three modes, kept. The win chance is the hero number, with the factor sheet below in a quiet table.
7. **Scout.** Built for a crowded venue, so everything is big and thumb-first.
   - *The event bar* stays on top.
   - *Forms:* 48px controls; the 0.97 press matters most here.
   - *Saving and syncing* are shown with small text, not banners.
8. **My teams, Shortlist, Compare.** Lists of team rows, plus Compare's side-by-side table.
9. **Events browse and This weekend.** Shared `EventBrowse`, in a calmer list, with live events on top marked by the red dot.
10. **Rankings and records (`/teams`, region, conference, power rankings, leagues).** All share the table component and the rankings sub-nav, which become tabs.

### Wave 3: reading pages
11. **How it works, Rules, FAQ, Methodology, FTC One Search docs.** One long-form reading layout:
    - a 680px measure and 16px body;
    - headings with anchor links;
    - a quiet table of contents on wide screens.
12. **Settings.** Grouped sections in cards. Themes and text size stay (see Q1).
13. **Highlights, contributors, supporters, donate, download, status, contact, legal.** These use the reading layout or the card grid; there's nothing new to invent.

### Wave 4: special
14. **Owner console.** Same tokens, with dense tables allowed. It's for one person, so it gets function over polish.
15. **Pit display and bundle pages.** Big numbers, high contrast, readable across a room.
16. **Shutdown and maintenance screens.** Already in the v8 look (#1942), so these just get checked.

## 8. How we build it (so nothing breaks)

1. **Foundations PR.** Tokens, the root size, motion tokens, and the shared components restyled behind `data-theme-next`, with no page switched over yet. It comes with a `/preview/kit` page showing every component and state.
2. **Shell PR.** The new sidebar, profile corner and phone sheet behind the same switch.
3. **One PR per page or page group, in wave order.** Each PR:
   - flips that page to v8;
   - removes its old styles;
   - carries desktop and phone screenshots (`npm run shots`);
   - gets a `review-animations` pass and a `break-ui` worst-case pass.
4. **Flip the switch.** Once wave 1 is in, v8 becomes the default. The old look stays one release behind the switch, then is deleted.
5. **Figma.** Each page is captured from code into the "Control Scout v8" file as it ships (the method already works for Home). Figma follows the code; it doesn't lead it.

These are big, mostly visual PRs. Each one gets Loopy 5/5, and merges are spaced as usual.

## 9. Quality bar (checked on every page before it ships)

- **Motion:**
  - motion follows section 4;
  - no `transition-all`, no `ease-in`;
  - no layout properties animated (except a measured accordion);
  - reduced motion respected.
- **Tap and hover:** every tap target is at least 44px; hover styles are gated to devices that can hover.
- **Accessibility:** contrast AA for text (muted text at least 4.5:1 on its surface), and keyboard focus visible everywhere.
- **Layout stability:** no layout shift on load (CLS under 0.05 on the shots).
- **Worst-case data:** long team names, five-digit numbers, zero events, an offline state and a signed-out state all look intentional.
- **Sizing:** it looks right at 100% zoom on a 1440px laptop and on a 390px phone, and grows cleanly at 2560px.

## 10. Open questions for Sushil

- **Q1. Themes.** Today there are Light, Dim, Dark, Midnight and System.
  - **(a)** v8 is dark-only at first; Light comes back later as a v8 version.
  - **(b)** Keep all five and restyle each.
  - My pick: **(a)**. Five themes multiply every design decision by five.
- **Q2. The one primary button** ("Predict this match", "Follow", "Save").
  - **(a)** White text on a white/10% fill with a hairline.
  - **(b)** A solid white fill with black text, used once per screen at most.
  - **(c)** Plain everywhere.
  - My pick: **(a)**.
- **Q3. Root size.** Are you happy with the "90%" root as the new 100%, or would you rather keep today's size and only tighten the sample home?
- **Q4. Order.** Is wave 1 (Home, Search, Team, Event, Match) the right order to start?
- **Q5. Page transitions.** I'm proposing none. Pages appear instantly because you move between them constantly. Are you OK with that, or do you want a subtle fade?
