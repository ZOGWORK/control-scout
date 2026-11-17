// The 2023 season's frame-read match starts: one row per recording and event, the rows of the season the event is
// of. scripts/video-frames.ts --season 2023 writes this file and no other (each season its own file, so readers of
// different seasons never touch the same file). The row type and everything that reads the rows: ../frameTimings.ts.
import type { FrameTiming } from "../frameTimings.js";

// --- Data (scripts/video-frames.ts writes from here on) ---
export const ROWS: FrameTiming[] = [

];
