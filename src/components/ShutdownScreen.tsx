// While the owner has publicAccess off (src/lib/shutdown.ts), a visitor who isn't signed in sees only the
// under-construction page the server shows (server/shutdownGate.ts), in the app's own look, with a way to sign in: a
// reload, which reaches the server's page and its sign-in form. Signed-in accounts see the app as usual.
import { useEffect, type ReactNode } from "react";
import { Button } from "./ui/button";
import { usePersonal } from "../lib/personal";
import { useFlag } from "../lib/flags";
import { useUnavailable } from "../lib/shutdown";
import { SHUTDOWN_BACK_SOON, SHUTDOWN_EYEBROW, SHUTDOWN_HEADLINE } from "../shared/shutdown";

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
  useEffect(() => { document.title = SHUTDOWN_HEADLINE; }, []);
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-primary text-text-base">
      <div className="ambient" aria-hidden><div className="ambient-grid" /><div className="ambient-breath" /></div>
      <header className="relative z-10 flex items-center gap-2.5 px-5 py-4 font-display text-[1.0625rem] font-semibold tracking-tight">
        <img src="/logo-56.webp" alt="" width={56} height={56} className="size-7" /> Control Scout
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[34rem] flex-1 flex-col items-center px-4 pb-12 pt-[6vh] text-center">
        <div className="relative mb-7 grid size-[132px] place-items-center" aria-hidden>
          <div className="absolute -inset-6 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_22%,transparent),transparent_68%)]" />
          <img src="/mark.webp" alt="" width={256} height={256} className="relative size-28 drop-shadow-[0_10px_30px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" />
          <div className="cs-tape absolute -inset-x-12 bottom-1.5 h-[22px] -rotate-[8deg] rounded-[3px] shadow-[0_6px_18px_-6px_rgb(0_0_0/0.5)]" />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/[0.08] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent-text">
          <span className="cs-pulse size-[7px] rounded-full bg-accent" /> {SHUTDOWN_EYEBROW}
        </span>
        <h1 className="mt-4 text-balance font-display text-[clamp(1.9rem,6vw,2.6rem)] font-bold leading-[1.1] tracking-tight">{SHUTDOWN_HEADLINE}</h1>
        <p className="mt-3 text-[1.0625rem] text-text-muted">{SHUTDOWN_BACK_SOON}</p>
        <section aria-labelledby="shutdown-signin" className="mt-10 w-full rounded-2xl border border-line bg-card/80 p-5 text-left shadow-[0_12px_40px_-16px_color-mix(in_srgb,var(--color-accent)_18%,transparent)] backdrop-blur">
          <h2 id="shutdown-signin" className="font-display text-[1.05rem] font-semibold">Have an account?</h2>
          <p className="mt-1 text-sm text-text-muted">Sign in to keep using Control Scout.</p>
          <Button className="mt-4 h-11 w-full" onClick={() => window.location.reload()}>Sign in</Button>
        </section>
      </main>
      <footer className="relative z-10 p-5 text-center text-[0.8rem] text-text-muted">controlscout.org</footer>
    </div>
  );
}
