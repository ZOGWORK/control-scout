# v8 page guide: how each page moves to v8

Read `docs/design/v8-revamp-brief.md` first. That's the design. This file covers how a page gets built.

## The switch
- v8 is on when `<html data-v8>` is set. Turn it on in a browser with `?v8=1` on any URL; `?v8=0` turns it off.
- Style a page for v8 **only with the `v8:` Tailwind variant** (for example `v8:bg-white/10`, `v8:hidden`), or with `isV8()` / `useIsV8()` from `src/lib/v8.ts` when the markup itself must differ. **The old look must not change.** Tests and screenshots with v8 off must stay as they are.
- These are already done; don't redo them:
  - tokens (surfaces, slate-blue accent, radii, strong easing, the 90% root);
  - shared components (`src/components/ui/*`: Button, Tabs, chips, menus, dialogs, sheets, tooltips, table head, skeleton);
  - the shell (sidebar, profile corner, wash, page fade off).
  - See `/preview/kit` for all of them.

## A redesign, not a recolour: page plan first
v8 rebuilds each page around what the visitor came for. Before coding, write a **Page plan** at the top of your PR description, then build to it:
- **The job:** who comes here and the question they want answered (one sentence).
- **First screen:** what's above the fold, in order. The answer to the job comes first, on a phone too.
- **What moves down or collapses:** detail, advanced tools, explanations behind a disclosure.
- **What's removed or merged:** repeated numbers, boxes that say the same thing twice, equal-weight button rows.
  - At most one primary action and one or two outline ones; the rest go in a "More" menu.
- **Where anything dropped went,** so nothing useful disappears silently.

If a page changes with state (live, finished or upcoming; signed in or out; has a team or not), plan the first screen for each state.

## Rules for every page (brief §2–§5, short form)
- **Colour:**
  - No yellow, no coloured buttons. Use `Button`'s variants; the default variant is the one primary per screen.
  - The accent (`accent`, the wash's light slate blue) only for: the #1 rank, progress, the picked tab or line, "yours". Never as a fill behind text.
  - Red and blue only for alliances; `live` red only for live.
  - Stat tiles, cards and badges are neutral (`bg-card`, `border-line`). Drop coloured tile backgrounds, coloured borders and coloured icon chips in v8.
- **Type:**
  - Inter for UI; `font-display` only for big numbers (team number, score, hero figure). Numbers get `tabular-nums`.
  - Uppercase tracked eyebrow labels become sentence-case `text-xs text-text-faint`.
  - Px text sizes (`text-[13px]`) on things you restyle get a `v8:text-[…rem]` override, so they scale with the root.
- **Layout:**
  - Cards are `bg-card border border-line rounded-xl` (14px in v8), padded 16–20px. Rows are 44px. Hairlines rather than boxes inside cards.
  - The page title sits at the top of the content (`text-[1.375rem] font-semibold tracking-tight`), with the page's actions on its right.
- **Motion (brief §4):**
  - No new animation on page change, hover lifts, or anything seen constantly.
  - Presses get `active:scale-[0.97]`, with `motion-reduce:active:scale-100`.
  - Never `transition-all`; never animate width, height, top or left (except a measured accordion).
  - Motion `layout` / `layoutId` on this page: render without them in v8.
- **States:** loading (skeletons the same shape as the content), empty (icon, one line, one plain action), error, offline, and signed out all designed. Run the `break-ui` idea yourself: long names, 5-digit numbers, zero rows.

## Process
1. **Worktree.** Create one from `origin/claude/v8-shell`:
   - `git worktree add -q --no-track -b claude/v8-<page> ../wt-v8-<page> origin/claude/v8-shell`
   - Then junction `node_modules` from the main checkout: `cmd /c mklink /J`.
   - **Watch out:** `push.default=upstream`. Always push with `git push -u origin HEAD:refs/heads/claude/v8-<page>`.
2. **Touch only your page's files** and the components that belong to that page alone. Shared files owned by another wave session are listed in your brief; don't edit them.
3. **Tests.** Add `<Page>.v8.test.tsx` (jsdom, set `document.documentElement.setAttribute("data-v8","")` in `beforeEach` and remove it in `afterEach`). Assert the v8 classes or markup and that v8-off is unchanged. Run your page's suites and `npx tsc --noEmit -p .`.
4. **Check it yourself in a real browser.** Use headless Playwright, not the in-app browser pane:
   - API: `CS_NO_SCHEDULER=1 PORT=<free port> npx tsx server/index.ts`
   - Web: `PORT=<that port> npx vite --port <free port> --strictPort`, both from your worktree.
   - Set `localStorage cs-v8=1` with `addInitScript`.
   - Take screenshots at 1440×900 and 390×844 (deviceScaleFactor 2). Look at them as a user and fix what's off.
   - Kill your servers by matching your worktree path in the process command line.
5. **Commit and open the PR.**
   - Commit as the repo's git user. **No `Co-Authored-By: Claude`, no Claude author, no "Generated with Claude Code" in the PR body.**
   - PR: `gh pr create --base claude/v8-shell --label no-changelog`, with screenshots attached via `--attach "path#alt"`. Then turn the image markdown into `<img width="640">` (desktop) or `<img width="300">` (phone).
   - Body: what changed for the user, in plain words.
6. **Review.**
   - Comment `@loopy review` and fix findings until the bot's comment says **5/5** for your latest head SHA.
   - **Don't merge.** Report back "READY #<n>" with the PR number, branch and head SHA.
7. **Clean up.** Remove your worktree when done: remove the `node_modules` junction with `cmd /c rmdir` first.
