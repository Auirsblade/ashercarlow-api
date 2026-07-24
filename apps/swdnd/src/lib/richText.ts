// Foundry descriptions are HTML with @Compendium[...]{Label} / @UUID[...]{Label}
// link codes. Reduce to plain text with paragraph breaks — rendered via
// whitespace-pre-line, never dangerouslySetInnerHTML.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&mdash;': '—', '&ndash;': '–',
};

export function cleanRichText(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  let s = html;
  // Foundry link codes → their display label.
  s = s.replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1');
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
