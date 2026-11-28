// The new look is the only look: <html data-v8> is set by index.html before the first paint, and the
// stylesheet's `v8:` variant and its html[data-v8] blocks (src/index.css) pick it up. This is what is
// left of the look machinery: the colour v8 gives numbers and event data.
// (docs/design/v8-revamp-brief.md)

/** v8's colour for numbers and event data (team numbers, a row's key stat, headline stat values): the wash's light
 *  slate blue, the accent (#a3b6e0, 9.7:1 on the page). Ordinary text stays white or grey; scores keep their
 *  alliance colours, live its red, and "yours" and wins stay white, so leave this off those. */
export const V8_NUM = "v8:text-accent";
