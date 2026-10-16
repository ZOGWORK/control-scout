// "Share" for a matchup (the Predict Lab's result, a match on its event
// page): a picture of the call, made by the server (/api/share/match.png),
// sent through the phone's share sheet, or downloaded where there isn't one,
// plus the link, which unfurls into the same picture in Discord and the like.
import { useEffect, useState } from "react";
import { Download, Link2, Share2 } from "lucide-react";
import { shareHeadline, shareImagePath, type ShareCardQuery } from "../shared/share";
import { canShareFiles, cardFile, downloadFile, shareCard, shareUrl } from "../lib/shareCard";
import { copyLink } from "../lib/clipboard";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { toast } from "./ui/sonner";
import { cn } from "./cn";

type Format = "landscape" | "square";

export function ShareMatch({ query, pRed, pBlue, played, className }: {
  query: Omit<ShareCardQuery, "format">;
  pRed: number;
  pBlue?: number;
  played?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("landscape");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const q: ShareCardQuery = { ...query, format };
  const text = shareHeadline({ red: query.red, blue: query.blue, pRed, pBlue, played });
  const sheet = canShareFiles();
  const src = shareImagePath(q);
  // Fetched as soon as the panel opens, so the share sheet opens straight from the tap (Safari needs that).
  useEffect(() => { if (open) cardFile(q).catch(() => {}); }, [open, src]);

  const run = async (how: "share" | "download") => {
    setBusy(true);
    try {
      if (how === "download") { downloadFile(await cardFile(q)); toast.success("Image downloaded"); return; }
      const out = await shareCard(q, text);
      if (out === "downloaded") toast.success("Image downloaded", { description: "Post it anywhere, or copy the link to go with it." });
    } catch (e) {
      toast.error("Couldn't make the image", { description: (e as Error)?.message });
    } finally { setBusy(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}><Share2 /> Share</Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto">
        <p className="text-sm font-semibold text-text-base">Share this prediction</p>
        <div className={cn("relative overflow-hidden rounded-lg border border-line bg-[#0a0a0b]", format === "square" ? "mx-auto aspect-square w-1/2" : "aspect-[1200/630] w-full")}>
          {loaded !== src && <div className="skeleton absolute inset-0" aria-hidden />}
          <img key={src} src={src} alt={text} className="relative size-full object-contain" onLoad={() => setLoaded(src)} />
        </div>
        <ToggleGroup type="single" value={format} onValueChange={(v) => v && setFormat(v as Format)} aria-label="Image shape" className="w-full">
          <ToggleGroupItem value="landscape" className="flex-1">Wide</ToggleGroupItem>
          <ToggleGroupItem value="square" className="flex-1">Square</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="flex-1 max-sm:h-11" disabled={busy} onClick={() => run(sheet ? "share" : "download")}>
            {sheet ? <><Share2 /> Share image</> : <><Download /> Download image</>}
          </Button>
          {sheet && <Button size="sm" variant="secondary" className="max-sm:h-11" disabled={busy} onClick={() => run("download")} aria-label="Download image"><Download /></Button>}
          <Button size="sm" variant="secondary" className="flex-1 max-sm:h-11" onClick={() => copyLink(shareUrl(q))}><Link2 /> Copy link</Button>
        </div>
        <p className="text-xs text-text-muted">Wide suits chats and stories, square suits Instagram posts. The link shows the wide picture when posted in Discord and other chats.</p>
      </PopoverContent>
    </Popover>
  );
}
