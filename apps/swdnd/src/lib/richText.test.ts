import { test, expect } from 'bun:test';
import { cleanRichText } from './richText';

test('strips tags, keeps paragraph breaks', () => {
  expect(cleanRichText('<p>First.</p><p>Second.</p>')).toBe('First.\nSecond.');
  expect(cleanRichText('a<br>b')).toBe('a\nb');
  expect(cleanRichText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
});

test('replaces Foundry link codes with their labels', () => {
  expect(cleanRichText('See @Compendium[sw5e.archetypes.abc]{Makashi Form} for detail')).toBe(
    'See Makashi Form for detail',
  );
  expect(cleanRichText('@UUID[Compendium.sw5e.feats.xyz]{Ace Pilot}')).toBe('Ace Pilot');
});

test('decodes common entities, collapses whitespace, handles null', () => {
  expect(cleanRichText('a &amp; b&nbsp;c')).toBe('a & b c');
  expect(cleanRichText('  <p>  spaced   out  </p> ')).toBe('spaced out');
  expect(cleanRichText(null)).toBe('');
  expect(cleanRichText(undefined)).toBe('');
});

test('never lets markup through (safe for direct text rendering)', () => {
  expect(cleanRichText('<script>alert(1)</script>hi <b onclick="x">bold</b>')).toBe('alert(1)hi bold');
});

test('roll tables become a Roll header plus a numbered list', () => {
  const html =
    '<table><thead><tr><th>[[/r d6 # Bond]]</th><th>Bond</th></tr></thead><tbody>' +
    '<tr class="rows"><th>1</th><th>I will never rest.</th></tr>' +
    '<tr class="rows"><th>2</th><th>I have a family out there.</th></tr>' +
    '</tbody></table>';
  expect(cleanRichText(html)).toBe('Roll d6 — Bond\n1. I will never rest.\n2. I have a family out there.');
});

test('roll tables resolve compendium links in options', () => {
  const html =
    '<table><thead><tr><th>[[/r d8 # Feat]]</th><th>Feat</th></tr></thead><tbody>' +
    '<tr><th>1</th><th>@Compendium[sw5e.feats.abc]{Silver-tongued}</th></tr>' +
    '</tbody></table>';
  expect(cleanRichText(html)).toBe('Roll d8 — Feat\n1. Silver-tongued');
});

test('roll header without a label falls back to the other header cells', () => {
  const html =
    '<table><tr><th>[[/r d4]]</th><th>Quirk</th></tr>' +
    '<tr><td>1</td><td>Hums constantly.</td></tr></table>';
  expect(cleanRichText(html)).toBe('Roll d4 — Quirk\n1. Hums constantly.');
});

test('generic tables get cell separators instead of run-together text', () => {
  const html =
    '<table><thead><tr><th>Level</th><th>Benefit</th></tr></thead>' +
    '<tbody><tr><td>5th</td><td>Extra attack</td></tr></tbody></table>';
  expect(cleanRichText(html)).toBe('Level · Benefit\n5th · Extra attack');
});

test('numeric-range rows and inline roll codes are handled', () => {
  const html =
    '<table><tr><th>[[/r d6 # Mood]]</th><th>Mood</th></tr>' +
    '<tr><td>1-3</td><td>Calm</td></tr><tr><td>4-6</td><td>Angry</td></tr></table>';
  expect(cleanRichText(html)).toBe('Roll d6 — Mood\n1-3. Calm\n4-6. Angry');
  expect(cleanRichText('<p>Use [[/r d20 # Wild]] when surging.</p>')).toBe('Use roll d20 (Wild) when surging.');
  expect(cleanRichText('Try [[/r d4]] first.')).toBe('Try roll d4 first.');
});
