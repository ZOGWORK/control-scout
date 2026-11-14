// The Offline page's view of the downloader (download.ts): what's downloading now, with real byte counts,
// and the half downloads kept on this device.
import { useEffect, useState, useSyncExternalStore } from "react";
import { PARTIALS_EVENT, activeDownloads, partialDownloads, subscribeDownloads, type ActiveDownload, type PartialDownload } from "./download";

export function useActiveDownloads(): Record<string, ActiveDownload> {
  return useSyncExternalStore(subscribeDownloads, activeDownloads, activeDownloads);
}

/** Half downloads on this device, read again whenever a download stops, finishes or is dropped. */
export function usePartials(): PartialDownload[] {
  const [list, setList] = useState<PartialDownload[]>([]);
  useEffect(() => {
    let live = true;
    const read = () => { void partialDownloads().then((l) => { if (live) setList(l); }); };
    read();
    // Also when the page comes back into view: another tab may have finished or dropped one meanwhile.
    const onShow = () => { if (document.visibilityState === "visible") read(); };
    window.addEventListener(PARTIALS_EVENT, read);
    document.addEventListener("visibilitychange", onShow);
    return () => { live = false; window.removeEventListener(PARTIALS_EVENT, read); document.removeEventListener("visibilitychange", onShow); };
  }, []);
  return list;
}
