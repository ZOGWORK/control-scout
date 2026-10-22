// An event's results state reduced to a key (src/shared/projectionState.ts says what goes in it). The
// server hashes it with node:crypto; the device's local estimate hashes the same text with Web Crypto.
import { createHash } from "node:crypto";
import { inputKeyText } from "../../src/shared/projectionState.js";
import type { ProjectionInput } from "./input.js";

export { eventState, type EventState } from "../../src/shared/projectionState.js";

/** The key of everything the simulation reads from the event and its advancement facts. */
export function inputKey(pi: ProjectionInput): string {
  return createHash("sha256").update(inputKeyText(pi)).digest("hex").slice(0, 32);
}
