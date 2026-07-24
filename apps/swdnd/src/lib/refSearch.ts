// apps/swdnd/src/lib/refSearch.ts — reference entries from content rows.
// Conditions and weapon properties are Foundry JOURNAL docs (text lives at
// pages[].text.content); other categories are item docs (system.description).
import { cleanRichText } from './richText';

export interface RefEntry { id: string; name: string; text: string }
export interface RefRow { id: string; name: string; raw_json: string }

export function refEntryFromRow(row: RefRow): RefEntry {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* text stays '' */ }
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const journalText = pages
    .map((p: any) => (typeof p?.text?.content === 'string' ? p.text.content : ''))
    .filter(Boolean)
    .join('\n');
  const html = journalText || raw.system?.description?.value;
  return { id: row.id, name: row.name, text: cleanRichText(html) };
}

/** Case-insensitive name-or-body filter; empty query returns everything. */
export function searchEntries<T extends RefEntry>(entries: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(needle) || e.text.toLowerCase().includes(needle));
}
