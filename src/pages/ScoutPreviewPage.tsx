// Development only (never in a production build): /scout/preview/<part> shows one piece of the Scout
// redesign on its own, from src/pages/scoutPreview/<part>.tsx, so each piece can be screenshotted with
// `npm run shots` before it's wired into the Scout page. Adding a piece is adding its file here; nothing
// else changes. Previews hold real-shaped sample input only for the piece's own props, never shown to users.
import { lazy, Suspense, type ComponentType } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/page";

const PARTS = import.meta.glob<{ default: ComponentType }>("./scoutPreview/*.tsx");
const cache = new Map<string, ComponentType>();
const pathOf = (part: string) => `./scoutPreview/${part}.tsx`;

export default function ScoutPreviewPage() {
  const { part = "" } = useParams();
  const load = PARTS[pathOf(part)];
  if (!load) {
    const names = Object.keys(PARTS).map((p) => p.slice("./scoutPreview/".length, -".tsx".length));
    return <PageHeader title="Scout previews" description={names.length ? `Pieces: ${names.join(", ")}` : "No previews yet."} />;
  }
  let Part = cache.get(part);
  if (!Part) { Part = lazy(load); cache.set(part, Part); }
  return <Suspense fallback={null}><Part /></Suspense>;
}
