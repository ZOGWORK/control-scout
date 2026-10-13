# Self-audit report

**Result: all green in one clean run** (2026-10-13). [AUDIT.md](AUDIT.md) logs
28 findings: 19 from the audit itself and 9 from code review of the audit PR.
26 are defects, fixed and re-checked. One (A2) was investigated and is not a
defect. One (T1) was a tooling issue, fixed at its root cause. Runbook: [docs/self-audit.md](docs/self-audit.md).

## The clean run

One pass on the final code, with nothing changed between steps:

| Check | Result |
|---|---|
| `npm run lint` (tsc) | clean |
| `npm test` | 81/81 (was 66 before the audit: + accounts end to end, + search preference ranking, + pack lock cases) |
| `npm run build` | ok; the build emits a versioned `sw.js` that precaches 46 files |
| `npm run audit`: 25 routes × desktop 1440×900 + mobile 390×844, plus forced loading and API-down states (`/api` and `/packs` slowed and refused; every data page must show a loading indicator and an error message) | **0 findings**. No console errors or warnings, no failed requests, no horizontal scroll, no unnamed controls, nothing blank, no mock text, a loading state everywhere, and an error state with a way forward everywhere when the API is down. |
| `npm run audit:flows`: 10 click-throughs | **10/10**, and no servers left on the tool ports afterwards |
| Clean clone following only the README | install, lint, tests, build, sync, stats, boot, search: ok |

## What was checked, by runbook section

**§0 Setup.** A fresh clone booted from the README alone, after the README fix
(A1). Both viewports, every route, console watched throughout (the sweep fails
on any console error or warning).

**§1 Functionality, used for real:**
- **Search:** "X Drvie" → X Drive; keyboard to the result. Number prefixes
  work, and tracked teams now rank first after an exact number (S1).
- **Team page:** OPR cards, trends, season switcher, events, awards and
  matches. My team, Track, Shortlist and Compare do what they say, and the
  Control Point link is there.
- **Event pages:** schedule, results, rankings, bracket and odds.
- **Prediction lab:** win %, predicted scores with ranges, top 3 factors and
  a tier. The advancement simulator works for any team at any event.
- **Track record:** real ledger data, Brier score and calibration, with live
  and backtest kept separate.
- **Compare** two teams (U1).
- **Shortlist and My team**, signed out and signed in. Sign-in, sync and the
  first-sign-in merge are covered by `auth.test.ts` (F1).
- **Download:** manifest valid; every pack's size and sha256 verified.
- **Settings:** 8 sections; theme, density and background apply instantly.
- **Scouting:** create (offline), edit, delete, export JSON and CSV, and
  import round-trip.
- **Video:** recorded with a camera and kept on the device, with **zero
  uploads** seen on the network. YouTube links embed.

**§2 Three states.** Loading (API delayed 4 s) shows skeletons on every route.
Empty: a team with no matches this season, an event with no data yet, and a
fresh visitor with no shortlist; each has a helpful state with a next step
(U3). Error: with every API call refused, every route says so and offers a way
forward; nothing is blank and nothing spins forever (A3, A4).

**§3 Integrity.**
- No mock data. The sweep checks for mock-looking text.
- Team 99999 is FIRST's real demo team, not mock data.
- The confidence tier is now visible on every prediction surface, including
  match rows and the Home "Next" card (P1).
- Hand-verified Brisbane South Q1 against the real result (see AUDIT.md).
- Control Point runs the same engine 1.1.0. Its PR (#243) passed its suite
  with no visible UI change before merging overnight.

**§4 UI/UX**, with both viewports' screenshots reviewed:
- Event headers now lead with what visitors come for (U2).
- Empty first visits are filled with useful next steps (U3).
- The selected season is finally visible (U4).
- Mobile: no horizontal scroll, and the selected tab stays in view (M1–M4).
- Every control has an accessible name; the sweep checks this.
- Keyboard: search opens with ⌘/Ctrl K, and results open with the arrow keys
  and Enter.

**§5 Robustness.**
- **API-down drill:** passes, as described in §2.
- **Offline (O1, O2):** the production app now opens with no signal (service
  worker) and still predicts from the lite pack.
- **Upgrades (R1, R2):** a new build reaches existing visitors, and tabs still
  on the old build keep their cached files.
- **Performance (production build):** data on screen in 150–330 ms per page.
  The very first request after a server boot is ~3 s while ratings warm. The
  Monte Carlo runs on the server, never on the UI thread.

## Blocked / unverified (said plainly)

- **Real phones.** Mobile was checked with Chromium's mobile emulation at
  390×844 (touch on), not on an iPhone or Android device. The camera recording
  used Chromium's fake camera.
- **Real sign-in email.** The account flow was verified over HTTP with the
  mailer swapped in tests. A real Resend email to a real inbox was not sent
  during the audit.
- **Google sign-in** is built but off until keys exist; untested end to end.
- **Colour contrast** was reviewed by eye on the screenshots. No automated
  contrast tool (axe or Lighthouse) was run; none is installed and none was
  added for one check.
- **Production (Render) with real data.** The service is live but waits for
  its Turso database and secrets, which Sushil adds. The audit ran against
  local servers with the real synced data. The live site needs a re-check
  once its data is connected.
- **Control Point's production deploy of engine 1.1.0** could not be confirmed
  from here: CI polling was not permitted overnight.
- **Light theme** was switched in the flow test and screenshotted earlier, but
  not swept route by route at both sizes.
