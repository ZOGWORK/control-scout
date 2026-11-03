import { eventWon } from "./api/searchAsks.js";
for (const w of process.argv.slice(2)) console.log(w, "=>", JSON.stringify(await eventWon(w, new Set())));
process.exit(0);
