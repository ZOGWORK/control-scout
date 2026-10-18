// The atlas's drawing, loaded on its own after the rest of the home page: Natural
// Earth 4.1.0 country boundaries at 1:110m (world-atlas, bundled as a static asset,
// never a third-party service), drawn with d3-geo as a globe (orthographic) or a
// flat map (Natural Earth projection). Countries with listings this season are
// tinted, the selected one is highlighted; nothing is placed inside a country,
// because the data says which country a team reports, not where it is.
// The globe turns slowly by itself (`spinning`, which the atlas switches off for reduced
// motion and behind its pause button); it also stops while dragged, off screen or in a
// hidden tab. A mouse can drag it round; touch never captures the page's scroll, and the
// country selector beside the map does everything without a pointer.
import { useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid, geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldUrl from "world-atlas/countries-110m.json?url";
import type { CountryTotal } from "../../shared/home";
import { cn } from "../cn";

type Country = Feature<Geometry, { name: string }> & { id?: string };

let world: Promise<Country[]> | null = null;
/** The boundaries, fetched once per page load (a hashed asset, so the browser caches it for good). */
export function loadWorld(): Promise<Country[]> {
  world ??= fetch(worldUrl)
    .then((r) => { if (!r.ok) throw new Error(`Map data: HTTP ${r.status}`); return r.json() as Promise<Topology<{ countries: GeometryCollection<{ name: string }> }>>; })
    .then((t) => (feature(t, t.objects.countries) as FeatureCollection<Geometry, { name: string }>).features as Country[]);
  world.catch(() => { world = null; });
  return world;
}

const SPHERE = { type: "Sphere" } as const;

/** Degrees the globe turns per second when spinning (one turn a minute). */
export const SPIN_DEG_PER_S = 6;

export interface AtlasMapProps {
  mode: "globe" | "flat";
  /** Turn the globe slowly on its own (ignored for the flat map). */
  spinning?: boolean;
  countries: CountryTotal[];
  /** ISO numeric of the selected country. */
  selected: string | null;
  onSelect: (code: string) => void;
  /** Called once the boundaries are in, with the ISO numeric codes they draw. */
  onLoaded: (drawn: ReadonlySet<string>) => void;
  onError: (e: Error) => void;
}

export default function AtlasMap({ mode, spinning = false, countries, selected, onSelect, onLoaded, onError }: AtlasMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [shapes, setShapes] = useState<Country[] | null>(null);
  const [rotation, setRotation] = useState<[number, number]>([96, -38]);
  const drag = useRef<{ x: number; y: number; r: [number, number] } | null>(null);

  useEffect(() => {
    let live = true;
    loadWorld().then((s) => {
      if (!live) return;
      setShapes(s);
      onLoaded(new Set(s.map((c) => String(c.id ?? "")).filter(Boolean)));
    }, (e: Error) => live && onError(e));
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sized by its own box (the page's content width, not the window's).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The globe turns to the selected country (at once: no motion to sit through).
  const byNumeric = useMemo(() => new Map(countries.map((c) => [c.numeric, c])), [countries]);
  const selectedShape = useMemo(() => shapes?.find((s) => s.id === selected) ?? null, [shapes, selected]);
  useEffect(() => {
    if (!selectedShape) return;
    const [lon, lat] = geoCentroid(selectedShape as GeoPermissibleObjects);
    setRotation([-lon, Math.max(-60, Math.min(60, -lat))]);
  }, [selectedShape]);

  // The spin: ~30 frames a second, only while it can be seen and isn't being dragged.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const turning = spinning && mode === "globe" && visible && !!shapes;
  useEffect(() => {
    if (!turning) return;
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (!drag.current && !document.hidden) {
        acc += dt;
        if (acc >= 33) { const step = (acc / 1000) * SPIN_DEG_PER_S; acc = 0; setRotation(([lon, lat]) => [(lon + step) % 360, lat]); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [turning]);

  const height = mode === "globe" ? width : Math.round(width * 0.52);
  const projection = useMemo(() => {
    if (!width) return null;
    if (mode === "globe") return geoOrthographic().rotate(rotation).fitExtent([[4, 4], [width - 4, height - 4]], SPHERE).clipAngle(90);
    return geoNaturalEarth1().fitExtent([[2, 2], [width - 2, height - 2]], SPHERE);
  }, [mode, width, height, rotation]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Mouse only: a finger on the globe still scrolls the page.
    if (mode !== "globe" || e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, r: rotation };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = 120 / Math.max(120, width);
    setRotation([d.r[0] + (e.clientX - d.x) * k, Math.max(-80, Math.min(80, d.r[1] - (e.clientY - d.y) * k))]);
  };
  const end = () => { drag.current = null; };

  const label = selectedShape
    ? `${mode === "globe" ? "Globe" : "World map"} with ${byNumeric.get(selected ?? "")?.name ?? selectedShape.properties.name} highlighted. Countries with team listings this season are tinted.`
    : `${mode === "globe" ? "Globe" : "World map"}: countries with team listings this season are tinted.`;

  return (
    <div ref={box} className={cn("relative w-full", mode === "globe" ? "aspect-square" : "aspect-[100/52]")}>
      {path && shapes && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
          className={cn("absolute inset-0 size-full select-none", mode === "globe" && "cursor-grab active:cursor-grabbing")}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
          <path d={path(SPHERE) ?? undefined} className="fill-[color-mix(in_srgb,var(--color-text-base)_4%,var(--color-card))] stroke-text-base/15" />
          <path d={path(geoGraticule10()) ?? undefined} className="fill-none stroke-text-base/[0.07]" strokeWidth={0.6} />
          {shapes.map((s, i) => {
            const c = byNumeric.get(String(s.id ?? ""));
            const d = path(s as GeoPermissibleObjects);
            if (!d) return null;
            const on = s.id != null && s.id === selected;
            return (
              <path key={s.id ?? `x${i}`} d={d} onClick={c ? () => onSelect(c.code) : undefined}
                className={cn("stroke-[color-mix(in_srgb,var(--color-text-base)_22%,var(--color-card))] transition-[fill] duration-150 motion-reduce:transition-none",
                  on ? "fill-accent" : c ? "fill-accent/35 hover:fill-accent/55" : "fill-text-base/[0.09]", c && "cursor-pointer")}
                strokeWidth={0.5}>
                <title>{c ? `${c.name}: ${c.listings.toLocaleString()} team listings` : s.properties.name}</title>
              </path>
            );
          })}
        </svg>
      )}
    </div>
  );
}
