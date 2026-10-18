// The FAQ's content: unique question ids (they're links), links only to real pages, and the plain-text and
// structured-data forms the server uses.
import { describe, expect, it } from "vitest";
import { FAQ, FAQ_ITEMS, faqJsonLd, faqParts, faqText } from "./faq";
import { pageModule } from "./routes";

describe("FAQ content", () => {
  it("has unique ids across questions and topics", () => {
    const ids = [...FAQ.map((g) => `topic-${g.id}`), ...FAQ_ITEMS.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of FAQ_ITEMS) expect(i.id).toMatch(/^[a-z0-9-]+$/);
  });

  it("links only to pages the app has", () => {
    for (const i of FAQ_ITEMS) for (const p of i.a) for (const part of faqParts(p)) {
      if (!("href" in part) || /^https?:/.test(part.href)) continue;
      const path = part.href.split(/[?#]/)[0];
      expect(pageModule(path), `${i.id}: ${part.href}`).not.toBe("NotFound");
    }
  });

  it("splits and strips links", () => {
    expect(faqParts("See [the terms](/terms#free) now.")).toEqual([{ text: "See " }, { text: "the terms", href: "/terms#free" }, { text: " now." }]);
    expect(faqText("See [the terms](/terms#free) now.")).toBe("See the terms now.");
  });

  it("is schema.org FAQPage data with every question", () => {
    const ld = faqJsonLd("https://controlscout.org") as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toHaveLength(FAQ_ITEMS.length);
    for (const q of ld.mainEntity) expect(q.acceptedAnswer.text).not.toMatch(/\]\(/);
  });
});
