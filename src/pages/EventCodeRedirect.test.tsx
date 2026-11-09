// @vitest-environment jsdom
// /events/<code> in the app: found → the newest season's page (query kept); the server's 404 → Page not found;
// a lost connection or server error → an error with a retry, never "not found" for an event that may exist.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const h = vi.hoisted(() => ({ answer: [] as (() => Promise<unknown>)[] }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), apiFetch: () => h.answer.shift()!() }));
vi.mock("./NotFound", () => ({ default: () => <p>Page not found</p> }));
import { ApiError } from "../lib/api";
import EventCodeRedirect from "./EventCodeRedirect";

function Where() { const l = useLocation(); return <p>at {l.pathname}{l.search}</p>; }
const open = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/events/:code" element={<EventCodeRedirect />} /><Route path="/events/:season/:code" element={<Where />} /></Routes>
  </MemoryRouter>);

describe("EventCodeRedirect", () => {
  afterEach(() => { cleanup(); h.answer = []; });

  it("opens the newest season's page, query kept", async () => {
    h.answer.push(async () => ({ season: 2026, code: "USNJNEM2" }));
    open("/events/usnjnem2?tab=teams");
    expect(await screen.findByText("at /events/2026/USNJNEM2?tab=teams")).toBeTruthy();
  });

  it("the server's 404 is Page not found", async () => {
    h.answer.push(async () => { throw new ApiError(404, "No event NOSUCH"); });
    open("/events/NOSUCH");
    expect(await screen.findByText("Page not found")).toBeTruthy();
  });

  it("a failed request is an error with a retry, and the retry can find it", async () => {
    h.answer.push(async () => { throw new ApiError(0, "Network down", true); }, async () => ({ season: 2026, code: "USNJNEM2" }));
    open("/events/USNJNEM2");
    expect(screen.queryByText("Page not found")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("at /events/2026/USNJNEM2")).toBeTruthy();
  });
});
