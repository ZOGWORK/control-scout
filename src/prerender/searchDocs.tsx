// Build-time prerender of How FTC One Search works (/how-it-works/search), as for /methodology: the real page
// component rendered to static HTML, so the full text is in the server's first response (server/seoMeta.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import SearchDocsPage from "../pages/SearchDocsPage";

export function renderSearchDocs(): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={["/how-it-works/search"]}><SearchDocsPage /></MemoryRouter>);
}
