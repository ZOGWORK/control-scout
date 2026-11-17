// While the owner has publicAccess off (src/lib/shutdown.ts), a visitor who isn't signed in sees only the two lines
// the server's own page shows (server/shutdownGate.ts), with a way to sign in: a reload, which reaches the server's
// page and its sign-in form. Signed-in accounts see the app as usual.
import { useEffect, type ReactNode } from "react";
import { Button } from "./ui/button";
import { usePersonal } from "../lib/personal";
import { useFlag } from "../lib/flags";
import { useUnavailable } from "../lib/shutdown";

/** The same words as the server's page. */
export const UNAVAILABLE = "Control Scout is temporarily unavailable.";
export const BACK_SOON = "We'll be back in a couple of days.";

/** The app, or only the message for a visitor the site is closed to. */
export function ShutdownGate({ children }: { children: ReactNode }) {
  const { user, providers } = usePersonal();
  const open = useFlag("publicAccess");
  const unavailable = useUnavailable();
  // providers: /api/auth/me has answered, so a null user really is signed out (never a flash for a signed-in account).
  const closed = !user && (unavailable || (providers !== null && !open));
  return closed ? <ShutdownScreen /> : <>{children}</>;
}

export function ShutdownScreen() {
  useEffect(() => { document.title = UNAVAILABLE; }, []);
  return (
    <main className="min-h-dvh bg-primary text-text-base">
      <div className="mx-auto max-w-md px-4 pb-12 pt-[18vh]">
        <h1 className="text-2xl font-semibold leading-tight">{UNAVAILABLE}</h1>
        <p className="mt-2">{BACK_SOON}</p>
        <section aria-labelledby="shutdown-signin" className="mt-12 border-t border-line pt-6">
          <h2 id="shutdown-signin" className="text-base font-medium">Have an account?</h2>
          <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>Sign in</Button>
        </section>
      </div>
    </main>
  );
}
