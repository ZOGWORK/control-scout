// Is this process a deploy's new lane, starting while the other lane serves (deploy/lanes.sh)? Then nobody waits on
// it: requests go to the live lane until this one takes the socket, so it can finish warming up first (the ratings,
// ~20 s on the VM) instead of taking over cold and making the first requests that need them wait (measured
// 2026-11-22: a team page 20.7 s right after a hand-off). A cold boot or a lone restart has no other lane serving:
// it answers as soon as it can and warms the ratings in the background, as before.
import { execFile } from "node:child_process";

/** Is a systemd unit active (`systemctl is-active --quiet`)? Anything it can't tell answers false. */
export function unitActive(unit: string): Promise<boolean> {
  return new Promise((done) => {
    try {
      execFile("systemctl", ["is-active", "--quiet", unit], { timeout: 3000 }, (err) => done(!err));
    } catch {
      done(false);
    }
  });
}

/** The lane template sets CS_LANE (%i: a or b) and CS_LANE_UNIT (%p: control-scout). True only when the other lane is
 *  serving right now; outside the lanes (no CS_LANE, the single unit, dev) always false. */
export async function handingOver(env: NodeJS.ProcessEnv = process.env, active: (unit: string) => Promise<boolean> = unitActive): Promise<boolean> {
  const lane = env.CS_LANE, unit = env.CS_LANE_UNIT;
  if ((lane !== "a" && lane !== "b") || !unit || !/^[A-Za-z0-9_-]+$/.test(unit)) return false;
  return active(`${unit}@${lane === "a" ? "b" : "a"}.service`).catch(() => false);
}
