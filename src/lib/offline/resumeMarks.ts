// Downloads the person started that a dropped connection paused: they pick up by themselves once the
// connection check finds internet again (resumeWatcher.tsx), on a connection the network setting allows. One
// list in localStorage, so every tab and a reopened app see the same marks. Tiny on purpose (no downloader
// import): the Download page and the season save run write it, the watcher only reads it.
//
// A mark is set when the person taps Download (or Resume, Update), kept while the download is paused by the
// connection, and cleared when it's saved, fails for another reason (a bad checksum, a full device) or the
// person deletes it. A download that was never the person's (an automatic update, the background predictions
// sync) never gets one.

export interface ResumeMark {
  /** "season:2026" or "lite:lite" (the downloader's owner key). */
  key: string;
  kind: "season" | "lite";
  id: string;
  /** An update of a saved season: never brings back a season removed meanwhile. */
  replaceOnly?: boolean;
  /** When the person asked for it (ms since 1970). */
  at: number;
}

export const RESUME_KEY = "cs-resume-downloads";
/** A mark this old is let go: a download paused for a day isn't picked up by surprise. */
export const RESUME_MAX_AGE_MS = 24 * 60 * 60_000;

function read(): ResumeMark[] {
  try {
    const v = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "[]") as ResumeMark[];
    return Array.isArray(v) ? v.filter((m) => m && typeof m.key === "string" && (m.kind === "season" || m.kind === "lite")) : [];
  } catch { return []; }
}
function write(list: ResumeMark[]) {
  try {
    if (list.length) localStorage.setItem(RESUME_KEY, JSON.stringify(list));
    else localStorage.removeItem(RESUME_KEY);
  } catch { /* storage blocked: the person's own Resume still works */ }
}

export const markKey = (kind: "season" | "lite", id: string) => `${kind}:${id}`;

/** The marks still wanted, oldest first (expired ones dropped). */
export function resumeMarks(now = Date.now()): ResumeMark[] {
  const all = read();
  const live = all.filter((m) => now - m.at < RESUME_MAX_AGE_MS && m.at <= now + 60_000);
  if (live.length !== all.length) write(live);
  return live.sort((a, b) => a.at - b.at);
}

/** The person asked for this download: pick it up by itself if the connection drops. */
export function wantResume(kind: "season" | "lite", id: string, opts: { replaceOnly?: boolean } = {}, now = Date.now()) {
  const key = markKey(kind, id);
  const prev = read().find((m) => m.key === key);
  const mark: ResumeMark = { key, kind, id, at: prev?.at ?? now, ...(opts.replaceOnly ? { replaceOnly: true } : {}) };
  write([...read().filter((m) => m.key !== key), mark]);
}

/** Saved, failed for good, or deleted: nothing to pick up. */
export function clearResume(key: string) {
  const list = read();
  if (list.some((m) => m.key === key)) write(list.filter((m) => m.key !== key));
}
