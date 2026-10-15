/** @vitest-environment jsdom */
// A not-found page's head (noindex, no canonical) must not outlive it: moving on
// to a real page in the app drops the noindex and puts the canonical link back.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { CanonicalSync, useNotFoundHead } from "./meta";

function Missing() { useNotFoundHead(); return null; }
let go: (to: string) => void = () => {};
function Nav() { go = useNavigate(); return null; }

const robots = () => document.head.querySelector('meta[name="robots"]');
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

afterEach(() => { cleanup(); document.head.innerHTML = ""; });

describe("not-found head", () => {
  const app = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <Routes><Route path="/teams" element={null} /><Route path="*" element={<Missing />} /></Routes>
      <CanonicalSync />
    </MemoryRouter>,
  );

  it("noindex and no canonical while shown; a real page after it gets its canonical back and no noindex", () => {
    app("/nope");
    expect(robots()?.getAttribute("content")).toBe("noindex");
    expect(canonical()).toBeNull();
    act(() => go("/teams"));
    expect(robots()).toBeNull();
    expect(canonical()?.href).toBe(`${window.location.origin}/teams`);
  });

  it("drops the server's marked 404 noindex, but never a page's own noindex", () => {
    document.head.innerHTML = '<meta name="robots" content="noindex" data-not-found />';
    app("/teams");
    expect(robots()).toBeNull();
    cleanup();
    document.head.innerHTML = '<meta name="robots" content="noindex" />';
    app("/teams");
    expect(robots()?.getAttribute("content")).toBe("noindex");
  });
});
