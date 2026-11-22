// The clip autopilot's checks on the sweep's rows (scripts/video-frames.ts --clips, server/data/clipChecks.ts): each
// clip the live site plays from the clock, read paused at its first second. The rule (a clip is pulled only where its
// first frame names another match; one whose frame names its own match is ok; one that names nothing stays served) is
// defined once in server/data/frameRowRules.ts, where the server checks each sweep the autopilot hands it.
export { clipCheckProblems } from "../../server/data/frameRowRules.js";
