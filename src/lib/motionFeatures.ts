// Motion's animation features (layout and gestures included), loaded after first paint by src/lib/motionSupport.ts:
// the app's components are motion's lightweight `m` elements, so the feature code stays off the first download.
// Everything still renders (at rest) before this arrives, or if it never does; it only animates once it has.
export { domMax as default } from "motion/react";
