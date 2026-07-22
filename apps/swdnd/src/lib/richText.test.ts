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
