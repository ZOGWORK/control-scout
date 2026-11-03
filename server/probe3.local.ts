import { searchAnswer } from "./api/searchAnswer.js";
for (const q of process.argv.slice(2)) {
  const a = await searchAnswer(q, { limit: 25 });
  const s = a.stat;
  console.log("\n#", q, "=>", a.intent?.kind ?? a.step, "|", s?.title ?? a.card?.title ?? a.understood?.label);
  if (s) { console.log("  none:", s.none ?? "-"); console.log("  head:", s.headline?.value, "|", s.headline?.label); for (const b of s.blocks) console.log("  [" + b.kind + "]", (b as any).title, b.kind === "table" ? (b as any).rows.map((r: any) => Object.values(r.cells).join(" / ")).join(" ;; ") : b.kind === "links" ? (b as any).items.map((i: any) => i.label).join(", ") : ""); console.log("  def:", s.definition.slice(-160)); }
}
process.exit(0);
