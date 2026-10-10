// Test helper: glyph ids and advance widths read straight from a TrueType file
// (cmap format 4 + hmtx), so a text-fit test can use the real font instead of
// a per-character estimate. The code of
// docs/superpowers/specs/matchup-card-reference/measure.mjs, typed. No kerning
// and no shaping: the sum of advances, which is what the spec's widths are.
import { readFileSync } from "node:fs";

export interface FontMetrics {
  unitsPerEm: number;
  /** 0 when the font has no glyph for the character */
  glyphId(char: string): number;
  has(char: string): boolean;
  /** the sum of the advances of every character of `text`, at `px` */
  width(text: string, px: number): number;
}

export function readFont(path: string): FontMetrics {
  const b = readFileSync(path);
  const tables: Record<string, number> = {};
  const count = b.readUInt16BE(4);
  for (let i = 0; i < count; i += 1) {
    const o = 12 + i * 16;
    tables[b.toString("ascii", o, o + 4)] = b.readUInt32BE(o + 8);
  }
  const unitsPerEm = b.readUInt16BE(tables.head + 18);
  const hMetrics = b.readUInt16BE(tables.hhea + 34);

  const cmap = tables.cmap;
  let sub = -1;
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i += 1) {
    const platform = b.readUInt16BE(cmap + 4 + i * 8);
    const encoding = b.readUInt16BE(cmap + 6 + i * 8);
    const offset = b.readUInt32BE(cmap + 8 + i * 8);
    if (b.readUInt16BE(cmap + offset) === 4 && ((platform === 3 && encoding === 1) || platform === 0)) sub = cmap + offset;
  }
  if (sub < 0) throw new Error(`${path}: no format 4 cmap`);
  const segX2 = b.readUInt16BE(sub + 6);
  const end = sub + 14;
  const start = end + segX2 + 2;
  const idDelta = start + segX2;
  const idRange = idDelta + segX2;

  const glyphOf = (code: number): number => {
    for (let i = 0; i < segX2 / 2; i += 1) {
      if (code > b.readUInt16BE(end + i * 2)) continue;
      const s = b.readUInt16BE(start + i * 2);
      if (code < s) return 0;
      const range = b.readUInt16BE(idRange + i * 2);
      const delta = b.readInt16BE(idDelta + i * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const g = b.readUInt16BE(idRange + i * 2 + range + (code - s) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const glyphId = (char: string) => glyphOf(char.codePointAt(0) ?? 0);
  const advance = (glyph: number) => b.readUInt16BE(tables.hmtx + Math.min(glyph, hMetrics - 1) * 4);

  return {
    unitsPerEm,
    glyphId,
    has: (char) => glyphId(char) !== 0,
    width: (text, px) => (Array.from(text).reduce((w, ch) => w + advance(glyphId(ch)), 0) * px) / unitsPerEm,
  };
}
