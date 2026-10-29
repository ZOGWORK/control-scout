// The engine's factor sentences say "about N more points" for every N, so a 1-point gap read
// "about 1 more points". The web app fixes the number agreement where it shows them, so the shared engine
// (and Control Point, which runs the same build) needs no release for a wording fix.
/** A factor's label with "about 1 more points" / "about 1 more penalty points" made singular. */
export const factorLabel = (label: string) => label.replace(/\babout 1 more (penalty )?points\b/g, "about 1 more $1point");
