import { toast } from "../components/ui/sonner";

/** Copy the current page link. Falls back to a hidden textarea when the async
 *  Clipboard API is missing (plain HTTP on a venue network), and says so if
 *  neither works instead of failing silently. */
export async function copyLink(url = location.href) {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(url);
    else if (!legacyCopy(url)) throw new Error("no clipboard");
    toast.success("Link copied");
  } catch {
    toast.error("Couldn't copy the link", { description: url });
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
