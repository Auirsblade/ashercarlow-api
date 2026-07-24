// apps/swdnd/src/lib/refSearch.test.ts
import { describe, expect, it } from 'bun:test';
import { refEntryFromRow, searchEntries, type RefEntry } from './refSearch';

// Journal-doc shape (conditions, weapon properties): text at pages[].text.content.
const journalRow = {
  id: 'j1', name: 'Blinded',
  raw_json: JSON.stringify({
    name: 'Blinded',
    pages: [{ name: 'Blinded', type: 'text', text: { format: 1, content: "<p>A blinded creature can't see.</p><ul><li>Attack rolls against it have advantage.</li></ul>" } }],
  }),
};
// Item-doc shape (fallback): text at system.description.value.
const itemRow = {
  id: 'i1', name: 'Saber Ward',
  raw_json: JSON.stringify({ name: 'Saber Ward', system: { description: { value: '<p>You raise your saber to ward.</p>' } } }),
};
const brokenRow = { id: 'b1', name: 'Broken', raw_json: '{nope' };

describe('refEntryFromRow', () => {
  it('reads journal pages, joining and cleaning to plain text', () => {
    const e = refEntryFromRow(journalRow);
    expect(e).toEqual({
      id: 'j1', name: 'Blinded',
      text: "A blinded creature can't see.\n• Attack rolls against it have advantage.",
    });
  });

  it('falls back to system.description for item docs', () => {
    expect(refEntryFromRow(itemRow).text).toBe('You raise your saber to ward.');
  });

  it('never throws on unparsable raw_json', () => {
    expect(refEntryFromRow(brokenRow)).toEqual({ id: 'b1', name: 'Broken', text: '' });
  });

  it('non-string description values degrade to empty text, never throw', () => {
    const e = refEntryFromRow({ id: 'x', name: 'X', raw_json: JSON.stringify({ system: { description: { value: { a: 1 } } } }) });
    expect(e).toEqual({ id: 'x', name: 'X', text: '' });
  });
});

describe('searchEntries', () => {
  const entries: RefEntry[] = [
    { id: '1', name: 'Blinded', text: 'cannot see' },
    { id: '2', name: 'Deafened', text: 'cannot hear sounds' },
    { id: '3', name: 'Auto', text: 'burst or rapid fire modes' },
  ];

  it('matches name or body text, case-insensitive; empty query returns all', () => {
    expect(searchEntries(entries, 'blind').map((e) => e.name)).toEqual(['Blinded']);
    expect(searchEntries(entries, 'SOUNDS').map((e) => e.name)).toEqual(['Deafened']);
    expect(searchEntries(entries, '')).toHaveLength(3);
    expect(searchEntries(entries, 'nope')).toEqual([]);
  });
});
