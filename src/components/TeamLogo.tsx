// A team's logo (FIRST's team picture, server/teamLogos.ts) next to its number, behind the owner's teamLogos switch
// (off by default). While it's off this draws nothing and asks for nothing, so pages look exactly as before.
// Decorative (alt=""): the number and name beside it already say who it is. A fixed square, so nothing moves when the
// picture arrives; lazy, so a long table only loads what scrolls into view. A team without a picture of its own gets
// FIRST's generic mark from the same address.
import { useState, type ReactNode } from "react";
import { useFlag } from "../lib/flags";
import { cn } from "./cn";

export const teamLogoSrc = (team: number) => `/api/team-logos/${team}`;

export function TeamLogo({ team, size = 16, className }: { team: number; size?: number; className?: string }) {
  const on = useFlag("teamLogos");
  const [failed, setFailed] = useState(false);
  if (!on || !Number.isInteger(team) || team < 1) return null;
  return (
    <img
      src={teamLogoSrc(team)} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false}
      onError={() => setFailed(true)}
      // A picture that can't load keeps its square (nothing shifts) but shows nothing.
      className={cn("inline-block shrink-0 rounded-[3px] object-contain align-middle", failed && "invisible", className)}
      style={{ width: size, height: size }}
      data-team-logo={team}
    />
  );
}

/** `children` (a team's number) with its logo before it, in one inline row; just `children` while the switch is off,
 *  so a page with logos off is drawn exactly as it was. */
export function WithTeamLogo({ team, size = 16, className, children }: { team: number; size?: number; className?: string; children: ReactNode }) {
  const on = useFlag("teamLogos");
  if (!on) return <>{children}</>;
  return <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}><TeamLogo team={team} size={size} />{children}</span>;
}
