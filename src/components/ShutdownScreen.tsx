// While the owner has publicAccess off (src/lib/shutdown.ts), a visitor who isn't signed in sees only the
// under-construction page the server shows (server/shutdownGate.ts), in the same look, with a way to sign in: a
// reload, which reaches the server's page and its sign-in form. Signed-in accounts see the app as usual.
// The look matches the server's page: always dark, a soft grainy wash across the top, the mark in white, white and grey
// type, a quiet card; no yellow, glow, tape or grid.
import { useEffect, type ReactNode } from "react";
import { usePersonal } from "../lib/personal";
import { useFlag } from "../lib/flags";
import { useUnavailable } from "../lib/shutdown";
import { SHUTDOWN_BACK_SOON, SHUTDOWN_HEADLINE } from "../shared/shutdown";

/** The app, or only the message for a visitor the site is closed to. */
export function ShutdownGate({ children }: { children: ReactNode }) {
  const { user, providers } = usePersonal();
  const open = useFlag("publicAccess");
  const unavailable = useUnavailable();
  // providers: /api/auth/me has answered, so a null user really is signed out (never a flash for a signed-in account).
  const closed = !user && (unavailable || (providers !== null && !open));
  return closed ? <ShutdownScreen /> : <>{children}</>;
}

const FADE = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.55) 40%,transparent 100%)";

export function ShutdownScreen() {
  useEffect(() => { document.title = SHUTDOWN_HEADLINE; }, []);
  return (
    <div data-shutdown className="relative min-h-dvh overflow-x-clip bg-[#0a0a0b] text-[#f4f4f5]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[38vh] min-h-[240px]" style={{ maskImage: FADE, WebkitMaskImage: FADE }}>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#3a5379_0%,#304e52_30%,#274d41_50%,#3a4062_72%,#4c406e_100%)]" />
        <svg className="absolute inset-0 size-full opacity-30 mix-blend-screen" xmlns="http://www.w3.org/2000/svg">
          <filter id="shutdown-grain">
            <feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves={3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="discrete" tableValues="0 0 .35 .7 1" />
              <feFuncG type="discrete" tableValues="0 0 .35 .7 1" />
              <feFuncB type="discrete" tableValues="0 0 .35 .7 1" />
            </feComponentTransfer>
          </filter>
          <rect width="100%" height="100%" filter="url(#shutdown-grain)" />
        </svg>
      </div>
      <main className="relative z-10 mx-auto flex w-full max-w-[26rem] flex-col items-center px-5 pb-16 pt-[18vh] text-center">
        <img src="/mark-white.webp" alt="Control Scout" width={56} height={56} className="size-14" />
        <h1 className="mt-9 text-balance font-display text-[clamp(1.6rem,4.6vw,2rem)] font-semibold leading-[1.2] tracking-[-0.02em]">{SHUTDOWN_HEADLINE}</h1>
        <p className="mt-2.5 text-base text-[#a1a1aa]">{SHUTDOWN_BACK_SOON}</p>
        <section aria-labelledby="shutdown-signin" className="mt-12 w-full rounded-[20px] border border-white/[0.08] bg-[#121214] p-6 text-left">
          <h2 id="shutdown-signin" className="text-base font-semibold">Have an account?</h2>
          <p className="mt-1 text-sm text-[#a1a1aa]">Sign in to keep using Control Scout.</p>
          <button
            type="button" onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/[0.12] bg-[#1c1c1f] px-4 text-[0.9375rem] font-medium transition-colors hover:border-white/20 hover:bg-[#242428] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4f4f5]"
          >Sign in</button>
        </section>
      </main>
    </div>
  );
}
