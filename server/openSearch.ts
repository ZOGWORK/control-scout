// The OpenSearch description (/opensearch.xml): what lets Chrome and Edge offer "Press Tab to search
// Control Scout" in the address bar, and Firefox add it as a search engine. Every page's head links it
// (index.html). A query lands on /search (src/pages/SearchPage.tsx), whose first HTML already lists the results.
import type { Request, Response } from "express";
import { canonicalOrigin } from "./seo.js";

export const OPENSEARCH_TYPE = "application/opensearchdescription+xml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function openSearchXml(origin = canonicalOrigin()): string {
  const o = esc(origin);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">`,
    `  <ShortName>Control Scout</ShortName>`,
    `  <Description>Search FTC teams, events and matches on Control Scout</Description>`,
    `  <InputEncoding>UTF-8</InputEncoding>`,
    `  <Image width="48" height="48" type="image/png">${o}/favicon-48.png</Image>`,
    `  <Url type="text/html" method="get" template="${o}/search?q={searchTerms}"/>`,
    `  <Url type="${OPENSEARCH_TYPE}" rel="self" template="${o}/opensearch.xml"/>`,
    `  <moz:SearchForm>${o}/search</moz:SearchForm>`,
    `</OpenSearchDescription>`,
    ``,
  ].join("\n");
}

export function openSearchRoute(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type(OPENSEARCH_TYPE).send(openSearchXml());
}
