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

const back = vi.fn();

function View({ state, pick = "14" }: { state: ApiState<string>; pick?: string }) {
  return <MemoryRouter><Inner state={state} pick={pick} /></MemoryRouter>;
}

function Inner({ state, pick }: { state: ApiState<string>; pick: string }) {
  const { shown, stale, failed, keptPick } = useKeepLast(state, pick);
  return (
    <KeptLast stale={stale} failed={failed} onRetry={() => void state.reload()} onBack={() => back(keptPick)}>
      <Async state={shown}>{(d) => <Section title="Details" collapsible summary="More"><p>{d}</p></Section>}</Async>
    </KeptLast>
  );
}

describe("useKeepLast", () => {
  it("keeps an opened fold open while the next answer loads, dimmed and busy, then shows the new one", () => {
    const { rerender, container } = render(<View state={st("14 days")} />);
    fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
    expect(screen.getByText("14 days")).toBeTruthy();
    rerender(<View state={st()} pick="30" />);
    expect(screen.getByText("14 days")).toBeTruthy();
    const box = container.querySelector("[data-stale]")!;
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(box.className).toContain("pointer-events-none");
    expect(box.hasAttribute("inert")).toBe(true);
    rerender(<View state={st("30 days")} pick="30" />);
    expect(screen.getByText("30 days")).toBeTruthy();
    expect(container.querySelector("[data-stale]")).toBeNull();
    expect(screen.getByRole("button", { name: /^Details/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("on a failed new answer keeps the last one inert under the error, with Try again and Go back to its own pick", () => {
    const { rerender, container } = render(<View state={st("14 days")} />);
    fireEvent.click(screen.getByRole("button", { name: /^Details/ }));
    rerender(<View state={st(undefined, new ApiError(500, "Server error"))} pick="30" />);
    expect(container.querySelector("[data-stale]")!.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load that view \(Server error\)/);
    expect(screen.getByText("14 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Go back/ }));
    expect(back).toHaveBeenCalledWith("14");
  });

  it("with nothing to keep, a first load shows Async's loading and a first error Async's error, not the kept-view alert", () => {
    const { container, rerender } = render(<View state={st()} />);
    expect(container.querySelector("[data-stale]")).toBeNull();
    expect(screen.queryByText("14 days")).toBeNull();
    rerender(<View state={st(undefined, new ApiError(500, "Server error"))} />);
    expect(screen.queryByText(/Couldn't load that view/)).toBeNull();
    expect(screen.getByText("Server error")).toBeTruthy();
  });
});
