// The Cycles row at the top of the Videos tab (src/pages/VideosPage.tsx): the first few Cycles picked for this person,
// tall like the videos they are; one opens Cycles at it.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Zap } from "lucide-react";
import { cyclesPage, type DeviceTaste } from "../../lib/cycles";
import { cycleHref, type CycleItem } from "../../shared/cycles";

export function CyclesShelf({ ready, device }: { ready: boolean; device: DeviceTaste | null }) {
  const [items, setItems] = useState<CycleItem[] | null>(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    cyclesPage(null, null, device).then((a) => { if (live) setItems(a.items); }, () => { if (live) setItems([]); });
    return () => { live = false; };
    // Once per visit: the row is a way in, not a feed of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  if (items && !items.length) return null;
  return (
    <section aria-labelledby="cycles-shelf" className="mb-10" data-cycles-shelf>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="cycles-shelf" className="flex items-center gap-2 text-base font-semibold tracking-tight text-text-base">
          <Zap className="size-4 text-accent" aria-hidden />Cycles
        </h2>
        <Link to="/cycles" className="inline-flex items-center gap-0.5 rounded-md text-sm font-medium text-text-muted outline-none transition-colors duration-150 hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60">
          Watch all<ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(items ?? Array.from({ length: 6 }, () => null)).map((c, i) => (
          <li key={c?.key ?? i} className="w-36 shrink-0 sm:w-40">
            {c ? (
              <Link to={cycleHref(c.videoId)} className="group relative block aspect-[9/16] overflow-hidden rounded-xl bg-black outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none motion-reduce:active:scale-100" data-cycle-tile={c.videoId}>
                <img src={`https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`} alt="" loading="lazy" className="absolute inset-0 size-full scale-[1.34] object-cover transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.4] motion-reduce:transition-none" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2.5 pt-10">
                  <span className="line-clamp-3 text-[0.8125rem] font-medium leading-snug text-white">{c.title}</span>
                </span>
              </Link>
            ) : <div className="aspect-[9/16] animate-pulse rounded-xl bg-ink/[0.06] motion-reduce:animate-none" aria-hidden data-skeleton />}
          </li>
        ))}
      </ul>
    </section>
  );
}
