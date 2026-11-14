// Where each match starts in an event recording, read off the recording's own frames (scripts/video-frames.ts): FTC
// Live's overlay names the match being played and runs its timer, so one frame gives the second the match started at.
// For recordings YouTube's facts can't place matches in (src/shared/recording.ts timingTrusted): a video shorter than
// its broadcast (a stream stopped over lunch, a tail or a start cut), or an upload with no broadcast clock.
//
// `starts`: a match (its label) → the second it starts at in the video (its timer's start, not a lead-in). A match is
// here only where a frame showed it being played, or between two such matches that sit the same distance from their
// real starts (a video loses time, never gains it, so nothing was lost between them). Kept per event as well as per
// video: one stream can carry two divisions.
//
// Every frame read is confirmed before it counts: 70 s on the overlay must name the same match with the same start,
// and 25 s before, that match mustn't be running yet. A match is placed only where two signals agree (two reads that
// agree on where the video sits, or one read and the broadcast's own clock). `medium` lists the placed matches filled
// between two reads rather than read themselves. `review` holds starts with one signal only, or implausible ones (out
// of order, overlapping, outside the video): never shown as clips, left for the owner. `missing` gives each other
// match of the video the reason it has no start.

export interface FrameTiming {
  videoId: string;
  /** The event the matches are of. */
  code: string;
  /** The day the frames were read (YYYY-MM-DD). */
  checked: string;
  starts: Record<string, number>;
  /** Placed matches filled between two agreeing reads (the rest of `starts` were read themselves). */
  medium?: string[];
  /** Starts with one signal only, or implausible: for the owner to check, never a clip. */
  review?: Record<string, { t: number; why: string }>;
  /** Matches the frames gave no start for, and why. */
  missing?: Record<string, string>;
}

let byKey: Map<string, Record<string, number>> | null = null;

/** Two placed starts closer than this (a match's 2:38 less a read's slack) overlap: one of them is wrong. */
const OVERLAP_S = 152;

/** A row's starts that can be clips: any two closer than a match overlap (a misread, or an older read written before
 *  the plausibility check), and neither is used. */
export function plausibleStarts(starts: Record<string, number>): Record<string, number> {
  const sorted = Object.entries(starts).sort((a, b) => a[1] - b[1]);
  const bad = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] - sorted[i - 1][1] < OVERLAP_S) { bad.add(sorted[i][0]); bad.add(sorted[i - 1][0]); }
  }
  return Object.fromEntries(sorted.filter(([l]) => !bad.has(l)));
}

const keyed = () => new Map(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, plausibleStarts(f.starts)]));

/** The second a match starts at in a video, from its frames, or null when they weren't read for it. */
export function frameStart(videoId: string, code: string, label: string): number | null {
  byKey ??= keyed();
  return byKey.get(`${videoId}|${code}`)?.[label] ?? null;
}

/** Whether any of a video's matches for an event were placed from its frames (a video read with none placed, only
 *  review or missing ones, doesn't count). */
export function hasFrames(videoId: string, code: string): boolean {
  byKey ??= keyed();
  const starts = byKey.get(`${videoId}|${code}`);
  return !!starts && Object.keys(starts).length > 0;
}

/** A video's matches for an event left for the owner to check (one signal only, or implausible), with why. */
export function frameReview(videoId: string, code: string): Record<string, { t: number; why: string }> {
  return FRAME_TIMINGS.find((f) => f.videoId === videoId && f.code === code)?.review ?? {};
}

/** A video's matches for an event the frames gave no start for, with why. */
export function frameMissing(videoId: string, code: string): Record<string, string> {
  return FRAME_TIMINGS.find((f) => f.videoId === videoId && f.code === code)?.missing ?? {};
}

/** How sure a framed start is: "high" read off its own frames, "medium" filled between two agreeing reads. */
export function frameConfidence(videoId: string, code: string, label: string): "high" | "medium" | null {
  const f = FRAME_TIMINGS.find((x) => x.videoId === videoId && x.code === code);
  if (!f || plausibleStarts(f.starts)[label] == null) return null;
  return f.medium?.includes(label) ? "medium" : "high";
}

/** Tests only: these timings in place of the file's. */
export function setFrameTimingsForTests(list: FrameTiming[]) {
  FRAME_TIMINGS.splice(0, FRAME_TIMINGS.length, ...list);
  byKey = null;
}

// --- Data (scripts/video-frames.ts writes from here on) ---
export const FRAME_TIMINGS: FrameTiming[] = [
  {"videoId":"7bTejVfIN2M","code":"AUSYOS","checked":"2026-11-14","starts":{"Q1":5317,"Q2":5754,"Q3":6207,"Q4":6643,"Q5":7121,"Q6":7508,"Q7":7939,"Q8":8547,"Q9":9037,"Q10":9498},"medium":["Q2","Q3","Q4","Q5","Q6","Q7","Q8","Q9"]},
  {"videoId":"YhyTMxV91sc","code":"AUSYOS","checked":"2026-11-14","starts":{"Q32":250,"Q33":710,"Q34":1262,"Q35":1633,"Q36":2084},"medium":["Q33","Q34","Q35"]},
  {"videoId":"fBZOzjZr-60","code":"AUSYOS","checked":"2026-11-14","starts":{"Q11":171,"Q12":770,"Q13":1347,"Q14":1926,"Q15":2463,"Q16":2925,"Q17":3331,"Q18":3765,"Q19":4100,"Q20":4617,"Q21":5155,"Q22":5718,"Q23":6097,"Q24":6689,"Q25":7219,"Q26":7698,"Q27":8134,"Q28":8896,"Q29":9485,"Q30":10307,"Q31":10903},"medium":["Q12","Q13","Q14","Q15","Q16","Q17","Q18","Q19","Q20","Q21","Q22","Q23","Q24","Q25","Q26","Q27","Q28","Q29","Q30"]},
  {"videoId":"kR0hDZqlHM8","code":"AUSYOS","checked":"2026-11-14","starts":{"Q37":913,"Q38":1377,"Q39":1746,"Q40":2172,"Q41":2617,"Q42":3120,"Q43":3476,"Q44":4201,"Q45":4675,"Q46":5212,"Q47":5970,"Q48":6523,"Q49":6998,"Q50":7789,"Q51":8338,"Q52":8696,"Q53":9062,"Q54":9470,"Q55":9951,"Q56":10475,"M1":20917,"M2":21392,"M3":22105,"M4":22584,"M5":23008,"M6":23633,"M7":24064,"M8":24611,"M9":24946,"M10":25473,"M11":26032,"M12":26684,"M13":28557,"F1":29808,"F2":30841},"medium":["Q38","Q39","Q40","Q41","Q42","Q43","Q44","Q45","Q46","Q47","Q48","Q49","Q50","Q51","Q52","Q53","Q54","Q55","Q56","M1","M2","M3","M4","M5","M6","M7","M8","M9","M10","M11","M12","M13","F1"]},
  {"videoId":"FVGgr7s8cC8","code":"BRPIQ","checked":"2026-11-14","starts":{},"review":{"Q19":{"t":1138,"why":"one frame read, and nothing else agrees where the video sits"},"Q20":{"t":1738,"why":"one frame read, and nothing else agrees where the video sits"},"Q22":{"t":2938,"why":"one frame read, and nothing else agrees where the video sits"},"Q23":{"t":3538,"why":"one frame read, and nothing else agrees where the video sits"},"Q26":{"t":5278,"why":"one frame read, and nothing else agrees where the video sits"}},"missing":{"Q18":"no frame read of it, and no agreeing reads on both sides","Q21":"its frame read disagrees with the matches around it","Q24":"its frames didn't confirm a start","Q25":"in a gap: the reads either side disagree where the video sits, so it may not be in the video","Q27":"no frame read of it, and no agreeing reads on both sides","Q28":"no frame read of it, and no agreeing reads on both sides","Q29":"its frames didn't confirm a start","Q30":"no frame read of it, and no agreeing reads on both sides","Q31":"its frame read disagrees with the matches around it","Q32":"no frame read of it, and no agreeing reads on both sides","Q33":"no frame read of it, and no agreeing reads on both sides","Q34":"its frame read disagrees with the matches around it","Q35":"no frame read of it, and no agreeing reads on both sides","Q36":"no frame read of it, and no agreeing reads on both sides","Q37":"no frame read of it, and no agreeing reads on both sides","Q38":"no frame read of it, and no agreeing reads on both sides","Q39":"no frame read of it, and no agreeing reads on both sides","M1":"no frame read of it, and no agreeing reads on both sides","M2":"no frame read of it, and no agreeing reads on both sides","M3":"no frame read of it, and no agreeing reads on both sides","M4":"no frame read of it, and no agreeing reads on both sides","M5":"no frame read of it, and no agreeing reads on both sides","M6":"no frame read of it, and no agreeing reads on both sides","M7":"no frame read of it, and no agreeing reads on both sides","M8":"no frame read of it, and no agreeing reads on both sides","M9":"no frame read of it, and no agreeing reads on both sides","M10":"no frame read of it, and no agreeing reads on both sides","M11":"its frame read disagrees with the matches around it"}},
  {"videoId":"2LaRYh3rdo4","code":"CABCVIQ1","checked":"2026-11-14","starts":{"Q1":1346,"Q2":1887,"Q3":2636,"Q4":3318,"Q5":7155,"Q6":7812,"Q7":8474,"Q8":8692,"Q9":9218,"Q10":9684,"Q11":10174,"Q12":10598,"Q13":11157,"Q14":11592,"Q15":12014,"Q16":12593,"Q17":12981,"Q18":13394,"Q19":13839,"M1":16095,"M2":16527,"M3":17506,"M4":18109,"M5":18968,"M6":19833,"M6-2":20673,"M7":21450},"medium":["Q2","Q3","Q4","Q5","Q6","Q11","Q12","Q16","Q17","Q18","Q19","M1","M2","M3","M4","M5","M6","M6-2"]},
  {"videoId":"_eblj5-6VnA","code":"CABCVIQ2","checked":"2026-11-14","starts":{"Q5":836,"Q6":1554,"Q7":2180,"Q8":3099,"Q9":3596,"Q10":4125,"Q11":4615,"Q12":5098,"Q13":5543,"Q14":5974,"Q15":6392,"Q16":6875,"Q17":7372,"Q18":7845,"Q19":8285,"Q20":8789,"Q21":9455,"Q22":10091,"Q23":10510,"M1":12836,"M2":13294,"M3":14219,"M4":14761,"M5":16139,"M6":17021},"medium":["Q6","Q7","Q8","Q9","Q10","Q11","Q12","Q13","Q14","Q15","Q16","Q17","Q18","Q19","Q20","Q21","Q22","Q23","M1","M2","M3","M4","M5"]},
  {"videoId":"Y0kALAfm3EM","code":"CAONBUQ","checked":"2026-11-14","starts":{"Q1":1762,"Q2":2298,"Q3":2703,"Q4":3131,"Q5":3599,"Q6":4172,"Q7":4606,"Q8":5177,"Q9":8609,"Q10":9015,"Q11":9414,"Q12":9900,"Q13":10489,"Q14":10882,"Q15":11342,"Q16":11702,"Q17":12248,"Q18":12694,"Q19":13138,"Q20":13648,"Q21":14026,"Q22":14477,"Q23":15110,"Q24":15472,"Q25":15899,"Q26":16251,"Q27":17079,"Q28":17466,"Q29":17906,"M1":21524,"M2":21892,"M3":22352,"M4":22767,"M5":23205,"M6":23682,"M7":24362,"M8":24724,"M9":25916,"M10":26651},"medium":["Q2","Q3","Q4","Q5","Q6","Q7","Q8","Q9","Q10","Q11","Q12","Q13","Q14","Q15","Q16","Q17","Q18","Q19","Q20","Q21","Q22","Q23","Q24","Q25","Q26","Q27","Q28","Q29","M1","M2","M3","M4","M5","M6","M7","M8","M9"]},
  {"videoId":"1hPowweJI_g","code":"CAONKAQ","checked":"2026-11-14","starts":{},"review":{"Q5":{"t":4062,"why":"one frame read, and nothing else agrees where the video sits"}},"missing":{"Q1":"its frames didn't confirm a start","Q2":"no frame read of it, and no agreeing reads on both sides","Q3":"no frame read of it, and no agreeing reads on both sides","Q4":"no frame read of it, and no agreeing reads on both sides","Q6":"no frame read of it, and no agreeing reads on both sides","Q7":"no frame read of it, and no agreeing reads on both sides","Q8":"no frame read of it, and no agreeing reads on both sides","Q9":"no frame read of it, and no agreeing reads on both sides","Q10":"no frame read of it, and no agreeing reads on both sides","Q11":"no frame read of it, and no agreeing reads on both sides","Q12":"no frame read of it, and no agreeing reads on both sides","Q13":"no frame read of it, and no agreeing reads on both sides","Q14":"no frame read of it, and no agreeing reads on both sides","Q15":"its frame read disagrees with the matches around it","Q16":"no frame read of it, and no agreeing reads on both sides","Q17":"no frame read of it, and no agreeing reads on both sides","Q18":"no frame read of it, and no agreeing reads on both sides","Q19":"no frame read of it, and no agreeing reads on both sides","Q20":"no frame read of it, and no agreeing reads on both sides","Q21":"no frame read of it, and no agreeing reads on both sides","Q22":"no frame read of it, and no agreeing reads on both sides","Q23":"no frame read of it, and no agreeing reads on both sides","Q24":"no frame read of it, and no agreeing reads on both sides","Q25":"no frame read of it, and no agreeing reads on both sides","Q26":"no frame read of it, and no agreeing reads on both sides","Q27":"no frame read of it, and no agreeing reads on both sides","Q28":"no frame read of it, and no agreeing reads on both sides","Q29":"no frame read of it, and no agreeing reads on both sides","M1":"no frame read of it, and no agreeing reads on both sides","M2":"no frame read of it, and no agreeing reads on both sides","M3":"no frame read of it, and no agreeing reads on both sides","M4":"no frame read of it, and no agreeing reads on both sides","M6":"no frame read of it, and no agreeing reads on both sides","M5":"no frame read of it, and no agreeing reads on both sides","M7":"no frame read of it, and no agreeing reads on both sides","M8":"no frame read of it, and no agreeing reads on both sides","M9":"no frame read of it, and no agreeing reads on both sides","M10":"no frame read of it, and no agreeing reads on both sides","M11":"no frame read of it, and no agreeing reads on both sides"}},
  {"videoId":"8BYKMDcW9gw","code":"CAONKIQ","checked":"2026-11-14","starts":{"Q1":1937,"Q2":2464,"Q3":2967,"Q4":3552,"Q5":4044,"Q6":4614,"Q7":5205,"Q8":8488,"Q9":9033,"Q10":9581,"Q11":10029,"Q12":10522,"Q13":11033,"Q14":11560,"Q15":11981,"Q16":12409,"Q17":13040,"Q18":13535,"Q19":14167,"Q20":14818,"Q21":15279,"Q22":15704,"Q23":16181,"Q24":16687,"Q25":17151,"Q26":17685,"M1":20182,"M2":20958,"M3":22013,"M4":22586,"M5":23741,"M6":24941}},
];
