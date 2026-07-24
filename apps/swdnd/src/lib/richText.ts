// Foundry descriptions are HTML with @Compendium[...]{Label} / @UUID[...]{Label}
// link codes. Reduce to plain text with paragraph breaks — rendered via
// whitespace-pre-line, never dangerouslySetInnerHTML.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&mdash;': '—', '&ndash;': '–',
};

// Foundry inline roll code, e.g. [[/r d8 # Feat]] → die "d8", label "Feat".
const ROLL_CODE = /\[\[\s*\/r\s*([^\]#]+?)\s*(?:#\s*([^\]]*?)\s*)?\]\]/;

function cellText(inner: string): string {
  return inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// A row whose first cell is a die result ("3") or range ("1-3") reads as a
// numbered option; anything else keeps generic " · " cell separators.
function rowText(cells: string[]): string {
  if (cells.length > 1 && /^\d+\s*[-–]?\s*\d*$/.test(cells[0])) {
    return `${cells[0]}. ${cells.slice(1).join(' · ')}`;
  }
  return cells.join(' · ');
}

function formatTable(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1])))
    .filter((cells) => cells.some((c) => c.length > 0));
  if (rows.length === 0) return '';

  const [head, ...body] = rows;
  const roll = head.map((c) => ROLL_CODE.exec(c)).find(Boolean);
  let title: string;
  if (roll) {
    // "Roll d8 — Feat"; the label usually duplicates the other header cell.
    const label = roll[2] || head.filter((c) => !ROLL_CODE.test(c)).join(' · ');
    title = `Roll ${roll[1]}${label ? ` — ${label}` : ''}`;
  } else {
    title = head.join(' · ');
  }
  return `\n${[title, ...body.map(rowText)].join('\n')}\n`;
}

export function cleanRichText(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  let s = html;
  // Foundry link codes → their display label.
  s = s.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1');
  // Tables → "Roll dN — Label" + numbered options (or " · "-separated rows).
  s = s.replace(/<table[\s\S]*?<\/table>/gi, formatTable);
  // Stray inline roll codes outside tables.
  s = s.replace(new RegExp(ROLL_CODE.source, 'g'), (_m, die, label) =>
    label ? `roll ${die} (${label})` : `roll ${die}`);
  // Structural tags → line breaks / bullets before stripping the rest.
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|li|tr)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, '');
  for (const [entity, ch] of Object.entries(ENTITIES)) s = s.replaceAll(entity, ch);
  // Collapse: spaces within lines, at most single blank-free newlines, trim.
  s = s
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s;
}
