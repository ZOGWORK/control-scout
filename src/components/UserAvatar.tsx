// A person's profile picture (server/auth/avatars.ts: the same one as in Control Point), round, or their first
// initial when they have none or it doesn't load. Decorative by default: the name next to it says who it is.
import { useEffect, useState } from "react";
import { cn } from "./cn";

export function UserAvatar({ url, name, className, label }: { url?: string | null; name?: string | null; className?: string; /** Read out instead of hidden (when no name is next to it). */ label?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span {...a11y} data-user-avatar={url && !broken ? "picture" : "initial"}
      className={cn("relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-accent/15 text-sm font-semibold text-accent-text", className)}>
      {url && !broken
        ? <img src={url} alt="" draggable={false} loading="lazy" decoding="async" className="size-full object-cover" onError={() => setBroken(true)} />
        : initial}
    </span>
  );
}
