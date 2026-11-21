// Award names from FIRST can carry markup ("<i>FIRST</i>® Leadership Award Finalists"): plainText drops the tags and
// decodes entities, and awardTitle shows that plain name (or the type's label when there is none). Never HTML.
import { describe, expect, it } from "vitest";
import { awardTitle, plainText } from "./format";

describe("plainText", () => {
  it("drops tags and keeps their text", () => {
    expect(plainText("<i>FIRST</i>® Leadership Award Finalists")).toBe("FIRST® Leadership Award Finalists");
    expect(plainText("<b>Think</b> Award <I>2nd</I>")).toBe("Think Award 2nd");
    expect(plainText('<span class="x">Design</span> Award')).toBe("Design Award");
  });
  it("decodes entities, named and numeric", () => {
    expect(plainText("<i>FIRST</i>&reg; Dean&#39;s List &amp; more&#x2122;")).toBe("FIRST® Dean's List & more™");
    expect(plainText("Unknown &bogus; stays")).toBe("Unknown &bogus; stays");
  });
  it("leaves an escaped tag as visible text (it is never parsed as HTML)", () => {
    expect(plainText("&lt;script&gt;x&lt;/script&gt;")).toBe("<script>x</script>");
  });
  it("collapses spaces and leaves plain names alone", () => {
    expect(plainText("  Inspire   Award ")).toBe("Inspire Award");
    expect(plainText("Compass Award")).toBe("Compass Award");
  });
});

describe("awardTitle", () => {
  it("uses FIRST's name as plain text, else the label from type and placement", () => {
    expect(awardTitle({ type: "Winner", placement: 1, name: "<i>FIRST</i>® Leadership Award Finalists" })).toBe("FIRST® Leadership Award Finalists");
    expect(awardTitle({ type: "Inspire", placement: 2, name: null })).toBe("Inspire 2nd");
    expect(awardTitle({ type: "Think", placement: 1, name: "<i></i>" })).toBe("Think");
  });
});
