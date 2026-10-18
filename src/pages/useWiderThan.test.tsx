// @vitest-environment jsdom
// Predict's latest-calls card mounts at the grid's own 64 rem threshold, so a larger browser font raises it.
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useWiderThan } from "./PredictPage";

afterEach(() => { cleanup(); document.documentElement.style.fontSize = ""; });

function Probe({ width }: { width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useWiderThan(ref, 64);
  return <div ref={(el) => { ref.current = el; if (el) Object.defineProperty(el, "clientWidth", { configurable: true, value: width }); }} data-wide={String(wide)} />;
}
const wide = () => document.querySelector("[data-wide]")!.getAttribute("data-wide");

describe("useWiderThan", () => {
  it("is 64 rem at the default 16 px font", () => {
    render(<Probe width={1100} />);
    expect(wide()).toBe("true");
  });
  it("follows a larger root font: 1100 px is narrower than 64 rem at 20 px", () => {
    document.documentElement.style.fontSize = "20px";
    render(<Probe width={1100} />);
    expect(wide()).toBe("false");
  });
});
