// @vitest-environment jsdom
// Lab notes cite reports in the public repository by path: every cited path is a link to that file (or folder) there,
// and every linked file really is in the repository.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RepoLinks, repoUrl } from "./LabNotes";

afterEach(cleanup);

describe("lab-note report links", () => {
  it("links a file as a file and a folder as a folder, without the sentence's full stop", () => {
    expect(repoUrl("docs/engine/part12/tuning.md")).toBe("https://github.com/ZOGWORK/control-scout/blob/main/docs/engine/part12/tuning.md");
    expect(repoUrl("docs/engine/gates")).toBe("https://github.com/ZOGWORK/control-scout/tree/main/docs/engine/gates");
    const { container } = render(<p><RepoLinks text="Every gate report is in docs/engine/gates in the repository. Details in docs/engine/part12/growth.md." /></p>);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["docs/engine/gates", "docs/engine/part12/growth.md"]);
    expect(links[1].getAttribute("href")).toBe("https://github.com/ZOGWORK/control-scout/blob/main/docs/engine/part12/growth.md");
    expect(container.textContent).toBe("Every gate report is in docs/engine/gates in the repository. Details in docs/engine/part12/growth.md.");
  });

  it("every report the methodology page cites is in the repository", async () => {
    const { Verdicts } = await import("./LabNotes");
    class FakeIO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { container } = render(<Verdicts />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    // A closed Details panel is inert, so its links aren't in the tab order; opening it makes them reachable.
    const toggle = [...container.querySelectorAll("button")].find((b) => [...(document.getElementById(b.getAttribute("aria-controls")!)?.querySelectorAll("a") ?? [])].length > 0)!;
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    for (const h of hrefs) {
      const path = h.replace(/^https:\/\/github\.com\/ZOGWORK\/control-scout\/(blob|tree)\/main\//, "");
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });
});
