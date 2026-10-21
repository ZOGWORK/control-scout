// The engine's partnership fact (engine 2.4) → the API's PairHistory. Shared so the
// server and the offline answers on a device build exactly the same thing.
import type { PartnershipFact } from "@control-scout/predict-engine";
import type { PairHistory } from "./api";

export const pairHistory = (f: PartnershipFact): PairHistory => ({ kind: f.kind, teams: f.teams, side: f.side, label: f.label });
