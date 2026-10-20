import { toast } from "../components/ui/sonner";

/** Copy the current page link. Falls back to a hidden textarea when the async
 *  Clipboard API is missing (plain HTTP on a venue network), and says so if
 *  neither works instead of failing silently. */
export async function copyLink(url = location.href) {
  return copyText(url, "Link copied", "Couldn't copy the link", url);
}

/** Copy any text the same way; true when it reached the clipboard. */
export async function copyText(text: string, done: string, failed: string, description?: string): Promise<boolean> {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else if (!legacyCopy(text)) throw new Error("no clipboard");
    toast.success(done);
    return true;
  } catch {
    toast.error(failed, description ? { description } : undefined);
    return false;
  }
}

function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(el);
  el.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { el.remove(); }
}
