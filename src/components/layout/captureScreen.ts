// "Capture this screen" in the Report a bug dialog (BugReport.tsx): one picture of the page behind the dialog, so a
// screenshot nobody took beforehand doesn't mean closing the dialog. The browser asks first (getDisplayMedia, this
// tab offered first); the dialog and its backdrop step out of the way (html[data-capturing-screen], src/index.css),
// one frame is drawn to a canvas, every track is stopped straight away, and the dialog comes back. Nothing is
// recorded or sent: the picture becomes an ordinary attachment the person can still remove.
// The site's Permissions-Policy allows display-capture for itself only (server/securityHeaders.ts).

export type CaptureResult = { ok: true; file: File } | { ok: false; reason: "declined" | "failed" };

/** The attribute on <html> that hides the dialog, the sheet and their backdrop while the frame is taken. */
export const CAPTURING_ATTR = "data-capturing-screen";

type PolicyDoc = Document & { permissionsPolicy?: { allowsFeature?: (f: string) => boolean }; featurePolicy?: { allowsFeature?: (f: string) => boolean } };

/** Only where the browser can share a tab or screen (desktop browsers; not phones) and the page may ask. */
export function canCaptureScreen(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") return false;
  const policy = (document as PolicyDoc).permissionsPolicy ?? (document as PolicyDoc).featurePolicy;
  try {
    if (typeof policy?.allowsFeature === "function" && !policy.allowsFeature("display-capture")) return false;
  } catch { /* an older browser's policy object: let the browser decide when asked */ }
  return true;
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Waits for a video frame drawn after the dialog was hidden (or a short while, where frames can't be watched). */
function freshFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const done = setTimeout(resolve, 400);
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback !== "function") return;
    // The second frame: the first may have been on its way before the dialog was hidden.
    v.requestVideoFrameCallback(() => v.requestVideoFrameCallback!(() => { clearTimeout(done); resolve(); }));
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));

/**
 * Asks to share the screen, takes one frame of it as a PNG (a JPEG when the PNG would be over `maxBytes`), and stops
 * sharing. A refused or cancelled prompt is "declined"; anything else that goes wrong is "failed". Either way the
 * dialog is back and nothing was kept.
 */
export async function captureScreen(n: number, maxBytes: number): Promise<CaptureResult> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: false,
      // This tab first (Chrome, Edge); the others still let the person pick what to share.
      preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude", systemAudio: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (err) {
    const name = (err as DOMException | undefined)?.name;
    return { ok: false, reason: name === "NotAllowedError" || name === "AbortError" ? "declined" : "failed" };
  }
  const stop = () => { for (const t of stream.getTracks()) t.stop(); };
  const root = document.documentElement;
  const video = document.createElement("video");
  try {
    root.setAttribute(CAPTURING_ATTR, "");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await nextPaint();
    await freshFrame(video);
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return { ok: false, reason: "failed" };
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "failed" };
    ctx.drawImage(video, 0, 0, w, h);
    stop();
    root.removeAttribute(CAPTURING_ATTR);
    let blob = await toBlob(canvas, "image/png");
    let ext = "png";
    if (blob && blob.size > maxBytes) { blob = await toBlob(canvas, "image/jpeg", 0.85); ext = "jpg"; }
    if (!blob || !blob.size) return { ok: false, reason: "failed" };
    return { ok: true, file: new File([blob], `screen-capture-${n}.${ext}`, { type: blob.type || `image/${ext === "jpg" ? "jpeg" : "png"}` }) };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    stop();
    video.srcObject = null;
    root.removeAttribute(CAPTURING_ATTR);
  }
}
