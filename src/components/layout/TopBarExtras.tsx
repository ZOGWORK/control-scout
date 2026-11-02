// Top bar, right side: the clock and the weather in your team's town (only
// once you've set My team; nothing otherwise). The theme is chosen in Settings only.
// Same as Control Point's top bar: "3:42 PM · 72° · Sunny".
import { useEffect, useState } from "react";
import { apiFetch, qs } from "../../lib/api";
import { usePersonal } from "../../lib/personal";

interface Weather { available: boolean; tempF?: number; tempC?: number; unit?: "F" | "C"; summary?: string; place?: string }

const REFRESH_MS = 15 * 60_000;

export function formatWeather(w: Weather | null): string | null {
  if (!w?.available || w.tempF == null || w.tempC == null) return null;
  const t = w.unit === "C" ? w.tempC : w.tempF;
  return `${t}° · ${w.summary || ""}`.replace(/ · $/, "");
}

export function ClockWeather() {
  const { state } = usePersonal();
  const team = state.myTeam;
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    if (!team) return;
    setNow(new Date()); // a team just set after a long while: show the time now, not when the page opened
    // Tick on the minute boundary, then every minute.
    let timer: number;
    const tick = () => { setNow(new Date()); timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(timer);
  }, [team]);

  useEffect(() => {
    setWeather(null);
    if (!team) return;
    let live = true;
    const load = () => apiFetch<Weather>(`/api/weather${qs({ team })}`)
      .then((w) => { if (live) setWeather(w); })
      .catch(() => { /* offline: keep the last reading */ });
    void load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => { live = false; window.clearInterval(id); };
  }, [team]);

  if (!team) return null;
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const wx = formatWeather(weather);
  return (
    <span
      className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap px-1 text-xs tabular-nums text-text-muted lg:inline-flex"
      title={weather?.place ? `Weather in ${weather.place} (team ${team})` : undefined}
      aria-label={wx ? `${time}, ${wx}${weather?.place ? ` in ${weather.place}` : ""}` : time}
    >
      <time dateTime={now.toISOString()}>{time}</time>
      {wx && <><span aria-hidden="true">·</span><span>{wx}</span></>}
    </span>
  );
}
