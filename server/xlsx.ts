// A small streaming .xlsx writer: one sheet, styled cells, written out as it goes (no
// spreadsheet library, and never the whole file in memory). An .xlsx is a zip of XML
// parts; each part is deflated on the fly and followed by a data descriptor, so a part's
// size and checksum needn't be known before its bytes go out.
import { once } from "node:events";
import { crc32, createDeflateRaw } from "node:zlib";

/** The download went away mid-file: stop. */
export class Gone extends Error {}

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
// Bit 3: sizes and CRC follow the data; bit 11: UTF-8 names. Method 8: deflate. 1980-01-01 00:00.
const FLAGS = 0x0808, DEFLATE = 8, DOS_TIME = 0, DOS_DATE = 0x21;

/** A zip archive written straight to `out` (which resolves false when the reader has gone). */
export class ZipStream {
  private offset = 0;
  private readonly entries: { name: Buffer; crc: number; csize: number; size: number; at: number }[] = [];
  constructor(private readonly out: (b: Buffer) => Promise<boolean>) {}

  private async emit(b: Buffer) {
    this.offset += b.length;
    if (!(await this.out(b))) throw new Gone();
  }

  /** One file: `body` writes its text through `write`, which waits whenever the reader is behind. */
  async file(name: string, body: (write: (text: string) => Promise<void>) => Promise<void>): Promise<void> {
    const nameBuf = Buffer.from(name, "utf8"), at = this.offset;
    await this.emit(Buffer.concat([u32(0x04034b50), u16(20), u16(FLAGS), u16(DEFLATE), u16(DOS_TIME), u16(DOS_DATE), u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), nameBuf]));
    const deflate = createDeflateRaw({ level: 6 });
    const ready: Buffer[] = [];
    deflate.on("data", (c: Buffer) => ready.push(c));
    let crc = 0, size = 0, csize = 0;
    const drain = async () => { while (ready.length) { const c = ready.shift()!; csize += c.length; await this.emit(c); } };
    try {
      await body(async (text) => {
        const b = Buffer.from(text, "utf8");
        crc = crc32(b, crc);
        size += b.length;
        if (!deflate.write(b)) await once(deflate, "drain");
        await drain();
      });
      const ended = once(deflate, "end");
      deflate.end();
      await ended;
      await drain();
    } finally {
      deflate.destroy();
    }
    await this.emit(Buffer.concat([u32(0x08074b50), u32(crc), u32(csize), u32(size)]));
    this.entries.push({ name: nameBuf, crc, csize, size, at });
  }

  /** The central directory: the archive is complete after this. */
  async finish(): Promise<void> {
    const start = this.offset;
    const dir = Buffer.concat(this.entries.map((e) => Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(FLAGS), u16(DEFLATE), u16(DOS_TIME), u16(DOS_DATE), u32(e.crc), u32(e.csize), u32(e.size),
      u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.at), e.name,
    ])));
    await this.emit(dir);
    await this.emit(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(this.entries.length), u16(this.entries.length), u32(dir.length), u32(start), u16(0)]));
  }
}

// ---------------------------------------------------------------------------
// Cell styles
// ---------------------------------------------------------------------------

/** One cell look. Colours are RGB hex ("047857"). */
export interface CellStyle {
  color?: string;
  bold?: boolean;
  fill?: string;
  /** A medium line under the cell, in this colour (the coloured header underline). */
  underline?: string;
  /** An Excel number format, e.g. `0.0"%"` or `yyyy-mm-dd`. */
  numFmt?: string;
  /** Wrap onto more lines, from the top of the cell (a header: the filter arrow sits under the text). */
  wrap?: boolean;
  align?: "left" | "center" | "right";
}

/** Collects the distinct cell looks a sheet uses; each gets an index for a cell's `s` attribute. */
export class Styles {
  private readonly fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private readonly fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private readonly borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  private readonly numFmts: string[] = [];
  private readonly xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly byKey = new Map<string, number>([["{}", 0]]);

  private static add(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    return i >= 0 ? i : list.push(xml) - 1;
  }

  /** The style index for a look (the same look always gets the same index). */
  id(s: CellStyle): number {
    const key = JSON.stringify(s);
    const known = this.byKey.get(key);
    if (known != null) return known;
    const font = Styles.add(this.fonts, `<font>${s.bold ? "<b/>" : ""}<sz val="11"/>${s.color ? `<color rgb="FF${s.color}"/>` : ""}<name val="Calibri"/><family val="2"/></font>`);
    const fill = s.fill ? Styles.add(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const border = s.underline ? Styles.add(this.borders, `<border><left/><right/><top/><bottom style="medium"><color rgb="FF${s.underline}"/></bottom><diagonal/></border>`) : 0;
    const fmt = s.numFmt ? 164 + Styles.add(this.numFmts, s.numFmt) : 0;
    const align = s.wrap || s.align ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""} vertical="${s.wrap ? "top" : "bottom"}"${s.wrap ? ' wrapText="1"' : ""}/>` : "";
    const id = this.xfs.push(
      `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`,
    ) - 1;
    this.byKey.set(key, id);
    return id;
  }

  xml(): string {
    const fmts = this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>` : "";
    return `${XML_HEAD}<styleSheet xmlns="${NS}">${fmts}<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** XML text, with the control characters XML can't hold dropped. */
// eslint-disable-next-line no-control-regex
export const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "A", "B", … "Z", "AA", … for column index 0, 1, …. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A date (YYYY-MM-DD…) as an Excel day number, or null. */
export function excelDate(v: unknown): number | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86_400_000 : null;
}

/** One cell: a number or text (nothing for null), in a style from the sheet's `Styles`. */
export type Cell = { v: unknown; s?: number };

export function cellXml(ref: string, c: Cell): string {
  const s = c.s ? ` s="${c.s}"` : "";
  if (c.v == null || c.v === "") return c.s ? `<c r="${ref}"${s}/>` : "";
  if (typeof c.v === "number") return Number.isFinite(c.v) ? `<c r="${ref}"${s}><v>${c.v}</v></c>` : "";
  // Inline text is never read as a formula, so no formula-injection guard is needed here.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
}

export interface SheetSpec {
  name: string;
  /** Column widths, in characters. */
  widths: number[];
  /** Rows of data under the header (for the filter range). */
  rows: number;
  /** Columns frozen at the left (the header row is always frozen). */
  freezeCols: number;
  header: Cell[];
  headerHeight?: number;
  /** Writes the data rows through `row` (cells in column order), in order. */
  body: (row: (cells: Cell[]) => Promise<void>) => Promise<void>;
}

/** A one-sheet workbook with a frozen, filterable header row, streamed into `zip`. */
export async function writeWorkbook(zip: ZipStream, styles: Styles, sheet: SheetSpec): Promise<void> {
  const last = colName(Math.max(0, sheet.header.length - 1));
  const range = `$A$1:$${last}$${sheet.rows + 1}`;
  const sheetName = esc(sheet.name.replace(/[\\/?*[\]:']/g, " ").slice(0, 31));
  await zip.file("xl/worksheets/sheet1.xml", async (write) => {
    const fc = sheet.freezeCols;
    const pane = `<pane${fc ? ` xSplit="${fc}"` : ""} ySplit="1" topLeftCell="${colName(fc)}2" activePane="${fc ? "bottomRight" : "bottomLeft"}" state="frozen"/>`;
    await write(`${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/><cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>`);
    const h = sheet.headerHeight ? ` ht="${sheet.headerHeight}" customHeight="1"` : "";
    await write(`<row r="1"${h}>${sheet.header.map((c, i) => cellXml(`${colName(i)}1`, c)).join("")}</row>`);
    let r = 1, out = "";
    await sheet.body(async (cells) => {
      r++;
      out += `<row r="${r}">${cells.map((c, i) => cellXml(`${colName(i)}${r}`, c)).join("")}</row>`;
      if (out.length > 64_000) { await write(out); out = ""; }
    });
    await write(`${out}</sheetData><autoFilter ref="A1:${last}${sheet.rows + 1}"/></worksheet>`);
  });
  const part = (name: string, xml: string) => zip.file(name, (write) => write(xml));
  await part("xl/styles.xml", styles.xml());
  await part("xl/workbook.xml", `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!${range}</definedName></definedNames></workbook>`);
  await part("xl/_rels/workbook.xml.rels", `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`);
  await part("_rels/.rels", `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  await part("[Content_Types].xml", `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  await zip.finish();
}
