// Load protection: one answer per command and arguments for a minute (fifty people asking for the
// same match cost one lookup, and those asking at the same moment share it), and one command per
// person every 3 seconds.

/** A short-lived memo of answers. A lookup that fails unexpectedly is dropped at once (the next ask
 *  tries again); a Friendly one (unknown team, no schedule) is an answer and is kept like one. */
export class AnswerCache<T> {
  private m = new Map<string, { at: number; v: Promise<T> }>();
  constructor(private ttlMs = 60_000, private max = 2000, private keep: (e: unknown) => boolean = () => false) {}

  get(key: string, make: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.m.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.v;
    const v = make();
    this.m.set(key, { at: now, v });
    v.catch((e) => { if (!this.keep(e) && this.m.get(key)?.v === v) this.m.delete(key); });
    // Oldest first: a Map iterates in insertion order.
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return v;
  }

  get size() { return this.m.size; }
}

/** Per-person cooldown. `take` says how long to wait (ms), or 0 and starts the next cooldown. */
export class Cooldown {
  private last = new Map<string, number>();
  constructor(private ms = 3000) {}

  take(user: string, now = Date.now()): number {
    const at = this.last.get(user);
    if (at != null && now - at < this.ms) return this.ms - (now - at);
    this.last.set(user, now);
    // Forget people whose cooldown is long over, so the map stays the size of the last few seconds.
    if (this.last.size > 5000) for (const [u, t] of this.last) if (now - t >= this.ms) this.last.delete(u);
    return 0;
  }
}
