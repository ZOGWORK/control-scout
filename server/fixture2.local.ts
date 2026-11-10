import "./api/searchFacts.js";
import { writeFileSync } from "node:fs";
import { teamProfile } from "./api/teams.js";
import { siteMeta } from "./api/meta.js";
import { matchExplanation } from "./api/predictMatch.js";
import { matchApiPath } from "../src/shared/predictUrl.js";
const [meta, x, a, b] = await Promise.all([siteMeta(), matchExplanation(2025, [4215], [7149]), teamProfile(4215), teamProfile(7149)]);
// Trim the profiles to what a name hint reads, to keep the fixture small.
const slim = (p: any) => ({ ...p, events: [], awardsAllTime: [] });
const data = JSON.parse(JSON.stringify({ "/api/meta": meta, "/api/teams/4215": slim(a), "/api/teams/7149": slim(b), [matchApiPath(2025, [4215], [7149])]: x }));
writeFileSync("src/prerender/predict.fixture.json", JSON.stringify(data) + "\n");
console.log(Object.keys(data), x?.winProbRed, x?.predictedRed, x?.predictedBlue);
process.exit(0);
