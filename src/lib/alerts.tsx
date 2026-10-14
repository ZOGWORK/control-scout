// In-tab alerts (Settings → Notifications). While Control Scout is open, every
// few minutes: my team's / tracked teams' matches starting within 30 minutes
// (with the odds), upsets involving tracked teams, and tracked events starting
// today. Browser notifications when permitted, otherwise an in-app toast.
// Each alert fires once (remembered on this device).
import { useEffect, useRef } from "react";
import { apiFetch } from "./api";
import { usePersonal } from "./personal";
import { useCurrentSeason } from "./meta";
import { toast } from "../components/ui/sonner";
import { oddsPct } from "./format";
import type { EventSummary, EventListItem, MatchView } from "../shared/api";

const SENT = "cs-alerts-sent";
const POLL_MS = 5 * 60_000;
const LEAD_MS = 30 * 60_000;

function sent(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(SENT) ?? "[]")); } catch { return new Set(); } }
function remember(id: string) { const s = sent(); s.add(id); try { localStorage.setItem(SENT, JSON.stringify([...s].slice(-500))); } catch { /* ignore */ } }

function notify(id: string, title: string, body: string, url: string) {
  if (sent().has(id)) return;
  remember(id);
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
    const n = new Notification(title, { body, tag: id, icon: "/icon-192.png" });
    n.onclick = () => { window.focus(); location.assign(url); };
  } else {
    toast(title, { description: body, action: { label: "Open", onClick: () => location.assign(url) } });
  }
}

const sideOf = (m: MatchView, team: number) => (m.red.teams.some((t) => t.number === team) ? "red" : m.blue.teams.some((t) => t.number === team) ? "blue" : null);

export function AlertsRunner() {
  const { state } = usePersonal();
  const season = useCurrentSeason();
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const s = ref.current;
      const n = s.settings.notify;
      const tracked = n.trackedTeams || n.upsets ? s.tracked.teams : [];
      const teams = [...new Set([...(n.myTeamMatches && s.myTeam ? [s.myTeam] : []), ...tracked])].slice(0, 200);
      if (teams.length && !stopped) {
        // One request for every tracked team (the server picks the matches that matter now).
        const r = await apiFetch<{ matches: MatchView[] }>(`/api/alerts-feed?season=${season}&teams=${teams.join(",")}`).catch(() => null);
        const now = Date.now();
        for (const m of r?.matches ?? []) {
          for (const team of teams) {
            const side = sideOf(m, team);
            if (!side) continue;
            const mine = team === s.myTeam;
            const url = `/events/${m.season}/${m.code}?team=${team}`;
            const start = m.startsAt ? Date.parse(m.startsAt) : NaN;
            if (!m.played && (mine ? n.myTeamMatches : n.trackedTeams) && start > now && start - now <= LEAD_MS) {
              const p = m.prediction ? (side === "red" ? m.prediction.pRed : 1 - m.prediction.pRed) : null;
              notify(`soon:${m.code}:${m.key}:${team}`, `${team} plays ${m.label} in ${Math.max(1, Math.round((start - now) / 60_000))} min`, `${m.code}${p != null ? ` · ${oddsPct(p)} to win (${m.prediction!.tier})` : ""}`, url);
            }
            if (m.played && n.upsets && m.prediction && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total) {
              const redWon = m.red.score.total > m.blue.score.total;
              if ((m.prediction.pRed > 0.5) !== redWon) {
                const won = (side === "red") === redWon;
                notify(`upset:${m.code}:${m.key}`, `Upset: ${team} ${won ? "won" : "lost"} ${m.label}`, `${m.red.score.total}–${m.blue.score.total} · they were ${oddsPct(side === "red" ? m.prediction.pRed : 1 - m.prediction.pRed)} before the match (${m.prediction.tier})`, url);
              }
            }
          }
        }
      }
      if (n.eventStart && s.tracked.events.length && !stopped) {
        const today = new Date().toISOString().slice(0, 10);
        const r = await apiFetch<{ events: EventListItem[] }>(`/api/events?season=${season}&from=${today}&to=${today}`).catch(() => null);
        for (const e of r?.events ?? []) {
          if (s.tracked.events.includes(`${e.season}:${e.code}`) && e.start === today) notify(`start:${e.season}:${e.code}`, `${e.name} starts today`, `${e.teams} teams · live odds on the event page`, `/events/${e.season}/${e.code}`);
        }
      }
    };
    const anyOn = () => { const n = ref.current.settings.notify; return n.myTeamMatches || n.trackedTeams || n.upsets || n.eventStart; };
    const run = () => { if (anyOn()) tick().catch(() => {}); };
    const first = setTimeout(run, 10_000);
    const t = setInterval(run, POLL_MS);
    return () => { stopped = true; clearTimeout(first); clearInterval(t); };
  }, [season]);
  return null;
}
