// The audit sweep's "control with no accessible name" check (scripts/audit.ts), run in the page with
// page.evaluate(findUnnamed). Self-contained: it can't use anything outside its own body.
//
// Only rendered controls count: one inside a closed native <details> (or otherwise not rendered) has no text
// to read yet, which isn't a missing name. So every closed <details> is then opened and the controls it held
// are checked as a person would see them, before it's closed again: a control that is unnamed once shown
// still fails, and says it was found inside a <details>.

/** Each unnamed control (at most `limit`) as "tag[role] <outerHTML…>". */
export function findUnnamed(limit = 5): string[] {
  const CONTROLS = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=combobox]";
  const accName = (e: Element) => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.getAttribute("title") || (e as HTMLElement).innerText || "").trim()
    || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent?.trim()) || e.closest("label")?.textContent?.trim() || (e as HTMLInputElement).placeholder || "";
  /** A closed <details> hides everything but its own <summary>. */
  const inClosedDetails = (e: Element) => {
    for (let d = e.parentElement?.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
      if (!d.open && !(e.closest("summary")?.parentElement === d)) return true;
    }
    return false;
  };
  const rendered = (e: Element) => {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden" || inClosedDetails(e)) return false;
    // checkVisibility also catches content-visibility:hidden ancestors (how a closed <details> hides its content).
    const check = (e as HTMLElement).checkVisibility;
    if (typeof check === "function" && !check.call(e, { visibilityProperty: true })) return false;
    return (e as HTMLElement).offsetParent !== null || s.position === "fixed";
  };
  const describe = (e: Element, where = "") => `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : ""}${where} ${(e as HTMLElement).outerHTML.slice(0, 120)}`;

  const all = [...document.querySelectorAll(CONTROLS)];
  const out = all.filter((e) => rendered(e) && !accName(e)).map((e) => describe(e));
  // Open the closed <details> (outermost first, so nested ones open too), check what they held, then close them again.
  const hidden = all.filter((e) => inClosedDetails(e));
  if (hidden.length) {
    const closed = [...document.querySelectorAll("details")].filter((d) => !d.open);
    for (const d of closed) d.open = true;
    try {
      out.push(...hidden.filter((e) => rendered(e) && !accName(e)).map((e) => describe(e, " (inside a <details>, checked opened)")));
    } finally {
      for (const d of closed) d.open = false;
    }
  }
  return out.slice(0, limit);
}
