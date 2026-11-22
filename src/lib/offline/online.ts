// Is there a connection right now? The connection check's word (src/lib/connection.ts), never navigator.onLine on its
// own: iOS (above all a home-screen app back from the background) says offline while the phone is online, and a
// video button greyed out on that word was wrong.
import { offlineNow, shownOffline, useConnection } from "../connection";

/** False only when the connection check found no internet, or a Wi-Fi sign-in page (true while it can't tell). */
export function useOnline(): boolean {
  return !shownOffline(useConnection());
}

/** Is the device known to have no internet (the same word useOnline reads)? For code outside React. */
export const deviceOffline = (): boolean => offlineNow();

/** Videos can't play: no internet (the connection check), or the page's data came from saved data (`fromSaved`) while
 *  the check hasn't yet found internet. Saved data on screen while the check has found it is a slow connection, not
 *  an offline one: videos still play then. */
export function useNoVideoSignal(fromSaved?: boolean): boolean {
  const conn = useConnection();
  return shownOffline(conn) || (!!fromSaved && conn.internet !== "yes");
}
