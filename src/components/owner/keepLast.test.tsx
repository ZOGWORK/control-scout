// @vitest-environment jsdom
// useKeepLast + KeptLast: a filter's new answer loading keeps the last one on screen, dimmed and inert, so a fold the
// owner opened stays open; a failure says so above the last one (left usable), with Try again.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Section } from "../page";
import { Async } from "../states";
import type { ApiState } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { KeptLast, useKeepLast } from "./keepLast";

afterEach(cleanup);

const reload = vi.fn(() => Promise.resolve());
const st = (data?: string, error?: ApiError): ApiState<string> => ({ data, error, loading: data === undefined && !error, reload });

function View({ state }: { state: ApiState<string> }) {
  return <MemoryRouter><Inner state={state} /></MemoryRouter>;
}

function Inner({ state }: { state: ApiState<string> }) {
  const { shown, stale, failed } = useKeepLast(state);
  return (
    <KeptLast stale={stale} failed={failed} onRetry={() => void state.reload()}>
      <Async state={shown}>{(d) => <Section title="Details" collapsible summary="More"><p>{d}</p></Section>}</Async>
    </KeptLast>
  );
}

describe("useKeepLast", () => {
  it("keeps an opened fold open while the next answer loads, dimmed and busy, then shows the new one", () => {
    const { rerender, container } = render(<View state={st("14 days")} />);
    fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
    expect(screen.getByText("14 days")).toBeTruthy();
    rerender(<View state={st()} />);
    expect(screen.getByText("14 days")).toBeTruthy();
    const box = container.querySelector("[data-stale]")!;
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(box.className).toContain("pointer-events-none");
    expect(box.hasAttribute("inert")).toBe(true);
    rerender(<View state={st("30 days")} />);
    expect(screen.getByText("30 days")).toBeTruthy();
    expect(container.querySelector("[data-stale]")).toBeNull();
    expect(screen.getByRole("button", { name: /^Details/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("on a failed new answer keeps the last one, usable, under the error, with Try again", () => {
    const { rerender, container } = render(<View state={st("14 days")} />);
    rerender(<View state={st(undefined, new ApiError(500, "Server error"))} />);
    expect(container.querySelector("[inert]")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load that view \(Server error\)/);
    fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
    expect(screen.getByText("14 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reload).toHaveBeenCalled();
  });

  it("with nothing to keep, a first load or error is Async's as before", () => {
    render(<View state={st(undefined, new ApiError(500, "Server error"))} />);
    expect(screen.queryByText(/Couldn't load that view/)).toBeNull();
  });
});
