// Build-time prerender of How it works (/methodology): the real page component rendered to static HTML,
// so the full text is in the server's first response for crawlers and link previews (server/seoMeta.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import MethodologyPage from "../pages/MethodologyPage";

export function renderMethodology(): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/methodology"]}><MethodologyPage /></MemoryRouter>);
}
