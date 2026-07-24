// apps/swdnd/src/lib/diceText.ts — find rollable dice references in cleaned
// rich text (see richText.ts): "Roll d8 — Feat" table headers, "roll d20
// (Wild)" inline codes, and plain expressions like "2d6+3" or "2d8 + 4".

export interface TextSeg { kind: 'text'; text: string }
export interface RollSeg { kind: 'roll'; text: string; formula: string; label?: string }
export type DiceSeg = TextSeg | RollSeg;

// Alternatives ordered most- to least-specific; at a given position the
// first that matches wins, so "roll d8 — Feat" isn't split by the plain
// "roll dN" form.
const DICE_RE = new RegExp(
  [
    String.raw`\broll\s+(d\d+)\s+—\s+([^\n]+)`, //  1,2: table header, label to EOL
    String.raw`\broll\s+(d\d+)(?:\s+\(([^)\n]+)\))?`, //  3,4: inline roll code
    String.raw`\b(\d+d\d+(?:\s*[+-]\s*\d+)?)`, //    5: bare expression
  ].join('|'),
  'gi',
);

/** Split text into plain and rollable segments (concatenation reproduces the input). */
export function segmentDiceText(text: string): DiceSeg[] {
  const segs: DiceSeg[] = [];
  let idx = 0;
  for (const m of text.matchAll(DICE_RE)) {
    const die = m[1] ?? m[3];
    const formula = (die ?? m[5]).replace(/\s+/g, '');
    const label = (m[2] ?? m[4])?.trim();
    if (m.index > idx) segs.push({ kind: 'text', text: text.slice(idx, m.index) });
    segs.push({ kind: 'roll', text: m[0], formula, ...(label ? { label } : {}) });
    idx = m.index + m[0].length;
  }
  if (idx < text.length) segs.push({ kind: 'text', text: text.slice(idx) });
  return segs;
}

export const hasDice = (text: string): boolean =>
  segmentDiceText(text).some((s) => s.kind === 'roll');
