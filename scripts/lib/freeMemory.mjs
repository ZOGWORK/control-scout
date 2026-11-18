// Memory a run can have, in MB. Plain Node, nothing from node_modules: the autopilot's start
// (scripts/clip-autopilot-start.mjs) reads it before npm ci. Types: freeMemory.d.mts.
import { spawnSync } from "node:child_process";
import { freemem } from "node:os";

/** MB macOS can give a run at once, from `vm_stat`'s output: free, inactive, speculative and purgeable pages (macOS
 *  counts only pages nobody has touched as free; os.freemem() is a few hundred MB on an idle Mac). null: not vm_stat's
 *  output (no page size). */
export function vmStatMb(text) {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!page) return null;
  const pages = (k) => Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(text)?.[1] ?? 0);
  return Math.round(((pages("free") + pages("inactive") + pages("speculative") + pages("purgeable")) * page) / 2 ** 20);
}

/** Memory a run can have, in MB: on macOS from vm_stat, elsewhere (or when vm_stat fails) os.freemem(). */
export function freeMb() {
  if (process.platform === "darwin") {
    const r = spawnSync("vm_stat", { encoding: "utf8", timeout: 10_000 });
    const mb = r.status === 0 ? vmStatMb(r.stdout ?? "") : null;
    if (mb != null) return mb;
  }
  return Math.round(freemem() / 2 ** 20);
}
