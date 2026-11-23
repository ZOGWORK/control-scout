// @vitest-environment jsdom
// The card morph's guard rails: only cards inside a MorphScope take part, reduced motion (or no Web Animations) is the
// plain cut, and a run always takes its layer down and shows the page again, even when the page never draws its title.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MorphScope, eventMorphKey, useMorphCard, useMorphTarget } from "./CardMorph";
import { MORPH_MS, MORPH_WAIT_MS, launchMorph, maybeReturn, morphAllowed, resetMorphForTests } from "../lib/cardMorph";

const KEY = eventMorphKey(2025, "USCAFFFAQ");

function Card({ id = "card" }: { id?: string }) {
  const morph = useMorphCard(KEY, "/events/2025/USCAFFFAQ");
  return <a href="#e" {...morph} data-testid={id}><span data-morph-title>Qualifier</span></a>;
}
function Title({ k = KEY }: { k?: string }) {
  const t = useMorphTarget(k);
  return <h1 {...t}>Qualifier</h1>;
}
/** Runs a forward morph from `card` until its layer is gone (the title found, landed, faded). */
async function land(card: HTMLElement) {
  expect(launchMorph(card, KEY, () => {})).toBe(true);
  await vi.waitFor(() => expect(document.querySelector("[data-card-morph]")).toBeNull());
}
/** The cards a return run hides while it shrinks into them. */
function watchHidden() {
  const hidden: Element[] = [];
  const mo = new MutationObserver((ms) => ms.forEach((m) => { const el = m.target as HTMLElement; if (el.style?.visibility === "hidden") hidden.push(el); }));
  mo.observe(document.body, { attributes: true, attributeFilter: ["style"], subtree: true });
  return { hidden, stop: () => mo.disconnect() };
}

let reduce = false;
beforeEach(() => {
  reduce = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") ? reduce : false, addEventListener() {}, removeEventListener() {} }));
  // jsdom has no layout: give every element a visible box, and Web Animations that finish at once.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 100, width: 300, height: 48, right: 310, bottom: 148, x: 10, y: 100, toJSON() {} } as DOMRect);
  (Element.prototype as unknown as { animate: unknown }).animate = function () {
    // Finishes on the next tick, as a browser's does once its time is up: onfinish, then the finished promise.
    const a: Record<string, unknown> = { cancel() {}, finish() {}, pause() {}, play() {}, currentTime: 0, playbackRate: 1, effect: null, commitStyles() {}, addEventListener() {}, removeEventListener() {} };
    a.finished = new Promise<void>((done) => setTimeout(() => { (a.onfinish as (() => void) | undefined)?.(); done(); }, 0));
    return a;
  };
  const main = document.createElement("main");
  main.id = "main";
  document.body.append(main);
});
afterEach(() => {
  resetMorphForTests();
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

describe("card morph", () => {
  it("cards outside a MorphScope carry nothing: no key, no tap handler (the plain cut)", () => {
    render(<MemoryRouter><Card /></MemoryRouter>);
    expect(screen.getByTestId("card").hasAttribute("data-morph-key")).toBe(false);
  });

  it("inside a MorphScope the card is keyed, and the page's title is marked as the landing spot", () => {
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    expect(screen.getByTestId("card").getAttribute("data-morph-key")).toBe(KEY);
    expect(screen.getByRole("heading").getAttribute("data-morph-target")).toBe(KEY);
  });

  it("reduced motion, or no Web Animations: never runs", () => {
    reduce = true;
    expect(morphAllowed()).toBe(false);
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    expect(launchMorph(screen.getByTestId("card"), KEY, () => {})).toBe(false);
    expect(document.querySelector("[data-card-morph]")).toBeNull();
    reduce = false;
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    expect(morphAllowed()).toBe(false);
  });

  it("a modified click (new tab) doesn't start a run", () => {
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    fireEvent.click(screen.getByTestId("card"), { metaKey: true });
    expect(document.querySelector("[data-card-morph]")).toBeNull();
  });

  it("a tap draws the layer over the page, lands on the title, then takes the layer down and shows the page", async () => {
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("card"));
    const layer = document.querySelector("[data-card-morph]");
    expect(layer?.querySelector("[data-morph-title]")?.textContent).toBe("Qualifier");
    await vi.waitFor(() => expect(document.querySelector("[data-card-morph]")).toBeNull());
    expect(document.getElementById("main")!.style.opacity).toBe("");
  });

  it("the page changes once the layer's first frame is painted, with the old page hidden under the layer", async () => {
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    const go = vi.fn();
    expect(launchMorph(screen.getByTestId("card"), KEY, go)).toBe(true);
    expect(go).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(document.getElementById("main")!.style.opacity).toBe("0");
  });

  it("a page that never draws its title: the layer still goes, the page still opens and is shown", async () => {
    vi.useFakeTimers();
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    const go = vi.fn();
    expect(launchMorph(screen.getByTestId("card"), KEY, go)).toBe(true);
    await vi.advanceTimersByTimeAsync(MORPH_MS + MORPH_WAIT_MS + 700);
    expect(go).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-card-morph]")).toBeNull();
    expect(document.getElementById("main")!.style.opacity).toBe("");
  });

  it("a morph that throws while starting leaves the tap to the link: not prevented, no layer, page shown", () => {
    (Element.prototype as unknown as { animate: unknown }).animate = () => { throw new Error("bad keyframes"); };
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    const ok = fireEvent.click(screen.getByTestId("card"));
    expect(ok).toBe(true); // dispatchEvent: true = default not prevented, so the link navigates
    expect(document.querySelector("[data-card-morph]")).toBeNull();
    expect(document.getElementById("main")!.style.opacity).toBe("");
  });

  it("the same event shown twice: Back shrinks into the copy in the section it was tapped in, not the first one", async () => {
    const both = (title: boolean) => <MemoryRouter><MorphScope name="home"><Card id="a" /></MorphScope><MorphScope name="list"><Card id="b" /></MorphScope>{title && <Title />}</MemoryRouter>;
    const view = render(both(true));
    await land(screen.getByTestId("b"));
    view.rerender(both(false)); // leave the page
    const w = watchHidden();
    expect(maybeReturn(KEY)).toBe(true);
    await vi.waitFor(() => expect(w.hidden.length).toBeGreaterThan(0));
    w.stop();
    expect(w.hidden[0]).toBe(screen.getByTestId("b"));
  });

  it("an event page that switches in place to another event records nothing for the first one", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title k={eventMorphKey(2025, "OTHER")} /></MemoryRouter>);
    expect(maybeReturn(KEY)).toBe(false);
  });

  it("a reader who leaves mid-flight leaves no landing behind for a later visit's Back", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    expect(launchMorph(screen.getByTestId("card"), KEY, () => {})).toBe(true);
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>); // gone before the title landed
    // No title to land on: the run waits its whole window, then fades.
    await vi.waitFor(() => expect(document.querySelector("[data-card-morph]")).toBeNull(), { timeout: MORPH_MS + MORPH_WAIT_MS + 1500 });
    // A later, plain visit to the same event, then Back: no morph.
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    expect(maybeReturn(KEY)).toBe(false);
  });

  it("a section that loads after the tap doesn't move Back to its copy", async () => {
    // Tapped in the list while Home's card was still loading; by the time of Back, Home's copy is drawn first.
    const view = render(<MemoryRouter><MorphScope name="list"><Card id="b" /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("b"));
    const w = watchHidden();
    // Back (the router's first location is a POP): the newly drawn Home card is the one that starts the return.
    view.rerender(<MemoryRouter><MorphScope name="home"><Card id="a" /></MorphScope><MorphScope name="list"><Card id="b" /></MorphScope></MemoryRouter>);
    await vi.waitFor(() => expect(w.hidden.length).toBeGreaterThan(0));
    w.stop();
    expect(w.hidden[0]).toBe(screen.getByTestId("b"));
  });

  it("a new morph drops the way back left by an earlier page", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>); // left: a way back is kept
    // Another tap starts a new run; the reader backs out before it lands.
    expect(launchMorph(screen.getByTestId("card"), eventMorphKey(2025, "OTHER"), () => {})).toBe(true);
    expect(maybeReturn(KEY)).toBe(false);
  });

  it("a long name lands whole: the copy takes the page title's width and wraps like it", async () => {
    const wrapped: string[] = [];
    const mo = new MutationObserver(() => { const c = document.querySelector<HTMLElement>("[data-card-morph] [data-morph-title]"); if (c?.style.whiteSpace === "normal") wrapped.push(c.style.width); });
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["style"] });
    render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    mo.disconnect();
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it("Back starts from the page title as it reads: the whole name, wrapping", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    expect(maybeReturn(KEY)).toBe(true); // (the card stayed mounted, so Back is started here)
    expect(document.querySelector<HTMLElement>("[data-card-morph] [data-morph-title]")?.style.whiteSpace).toBe("normal");
  });

  it("the page shown again drops its older way back: leaving it a second time without a landing records none", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    view.rerender(<MemoryRouter><Title /></MemoryRouter>); // left the event page for a page with no card, so no Back yet
    view.rerender(<MemoryRouter><p>elsewhere</p></MemoryRouter>);
    view.rerender(<MemoryRouter><Title /></MemoryRouter>); // the event page again (Back from a later page)
    view.rerender(<MemoryRouter><p>elsewhere</p></MemoryRouter>); // and left again
    expect(maybeReturn(KEY)).toBe(false);
  });

  it("a return run stops the moment the reader moves on, so its layer never covers the next page", async () => {
    const view = render(<MemoryRouter><MorphScope name="list"><Card /></MorphScope><Title /></MemoryRouter>);
    await land(screen.getByTestId("card"));
    // The list hasn't put its scroll back yet, so the run waits for it.
    vi.spyOn(window, "scrollY", "get").mockReturnValue(500);
    view.rerender(<MemoryRouter><MorphScope name="list"><Card /></MorphScope></MemoryRouter>);
    expect(maybeReturn(KEY)).toBe(true);
    expect(document.querySelector("[data-card-morph]")).not.toBeNull();
    window.history.pushState({}, "", "/teams");
    await vi.waitFor(() => expect(document.querySelector("[data-card-morph]")).toBeNull(), { timeout: 500 });
    window.history.pushState({}, "", "/");
  });
});
