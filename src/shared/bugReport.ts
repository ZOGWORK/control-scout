// The bug report: its categories, limits and attachment rules, shared by the top bar's "Report a bug" dialog and the
// server (server/bugReports.ts), so the browser refuses exactly what the server would.

export const BUG_CATEGORIES = [
  { id: "data", label: "Wrong data" },
  { id: "broken", label: "Something broken" },
  { id: "layout", label: "Looks wrong / layout" },
  { id: "slow", label: "Slow" },
  { id: "other", label: "Other" },
] as const;

export type BugCategory = (typeof BUG_CATEGORIES)[number]["id"];
export const isBugCategory = (x: unknown): x is BugCategory => BUG_CATEGORIES.some((c) => c.id === x);

const MB = 1024 * 1024;

export const BUG_LIMITS = {
  messageMin: 10,
  messageMax: 5000,
  /** Screenshots per report, and the size of each. */
  images: 6,
  imageBytes: 5 * MB,
  /** Videos per report, and the size of each: a short screen recording. */
  videos: 1,
  videoBytes: 5 * MB,
  /** The automatic details (page, version, screen, device, theme): each field's length. */
  context: 300,
} as const;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type AttachmentType = (typeof IMAGE_TYPES)[number] | (typeof VIDEO_TYPES)[number];

export const isImageType = (t: string): boolean => (IMAGE_TYPES as readonly string[]).includes(t);
export const isVideoType = (t: string): boolean => (VIDEO_TYPES as readonly string[]).includes(t);

export const EXTENSION: Record<AttachmentType, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

/** "2 GB", "4.2 MB", "820 KB": for messages about sizes. */
export function formatBytes(n: number): string {
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(1).replace(/\.0$/, "")} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Why one file can't be attached (null: it can). `type` is the file's media type, `bytes` its size. */
export function attachmentProblem(type: string, bytes: number): string | null {
  if (isImageType(type)) {
    return bytes > BUG_LIMITS.imageBytes ? `Screenshots can be up to ${formatBytes(BUG_LIMITS.imageBytes)}; this one is ${formatBytes(bytes)}.` : bytes <= 0 ? "That file is empty." : null;
  }
  if (isVideoType(type)) {
    return bytes > BUG_LIMITS.videoBytes ? `Videos must be under ${formatBytes(BUG_LIMITS.videoBytes)}; this one is ${formatBytes(bytes)}. Try a shorter clip.` : bytes <= 0 ? "That file is empty." : null;
  }
  return "Only images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM, MOV) can be attached.";
}

/** Why a set of attachments can't go together (null: it can): too many screenshots or videos. */
export function attachmentsProblem(files: { type: string; bytes: number }[]): string | null {
  for (const f of files) { const p = attachmentProblem(f.type, f.bytes); if (p) return p; }
  if (files.filter((f) => isImageType(f.type)).length > BUG_LIMITS.images) return `Up to ${BUG_LIMITS.images} screenshots per report.`;
  if (files.filter((f) => isVideoType(f.type)).length > BUG_LIMITS.videos) return `One video per report.`;
  return null;
}

/**
 * The media type a file's first bytes say it is, or null: the server trusts this, not the name or the type the
 * browser sent. Covers exactly the attachment types above.
 */
export function sniffType(b: Uint8Array): AttachmentType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (ascii(4, "ftyp")) return ascii(8, "qt  ") ? "video/quicktime" : "video/mp4";
  return null;
}

/** What the dialog attaches without asking, shown to the person before they send. */
export interface BugContext {
  /** The page the report is about (path and query of this site only). */
  page: string;
  /** The app's release (version). */
  release: string;
  /** "1440×900 @2x". */
  viewport: string;
  /** The browser's user-agent string, shortened. */
  device: string;
  /** "Dark", "Light", "Dim", "Midnight". */
  theme: string;
}

/** POST /api/bug-reports: the report, and the attachments it will upload next (type and size each, in order). */
export interface BugReportCreate {
  category: BugCategory;
  message: string;
  email?: string;
  context: BugContext;
  files: { type: string; bytes: number }[];
  /** The honeypot: people never see it, so it's empty. */
  website?: string;
}

/** Its answer: where the attachments go (PUT /api/bug-reports/:id/files/:n, header X-Bug-Token), then POST …/:id/done. */
export interface BugReportCreated { id: number; token: string }

/** The owner console's list (GET /api/owner/bug-reports). */
export interface BugReportFile { n: number; type: string; bytes: number; url: string }
export interface BugReportItem {
  id: number;
  createdAt: string;
  category: BugCategory;
  message: string;
  email: string | null;
  context: BugContext;
  status: "open" | "done";
  emailed: boolean;
  /** Attachments declared but never uploaded (the sender left mid-upload). */
  missing: number;
  files: BugReportFile[];
}
export interface BugReportList { reports: BugReportItem[]; open: number; storedBytes: number; capBytes: number }
