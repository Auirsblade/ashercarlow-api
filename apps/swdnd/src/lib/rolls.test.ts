// apps/swdnd/src/lib/rolls.test.ts
import { describe, expect, test } from 'bun:test';
import { addDie, addModifier, appendRoll, MAX_LOG, type RollDto } from './rolls';

const mk = (id: string): RollDto => ({
  id, campaign_id: 'c1', roller: 'Kira', label: null, formula: '1d20',
  rolls_json: [{ sides: 20, value: 11 }], total: 11, hidden: 0, created_at: 'n',
});

describe('appendRoll', () => {
  test('prepends, dedupes by id, caps the in-memory log', () => {
    const list = appendRoll([mk('a')], mk('b'));
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect(appendRoll(list, mk('b'))).toBe(list); // duplicate → same reference
    const full = Array.from({ length: MAX_LOG }, (_, i) => mk(`r${i}`));
    expect(appendRoll(full, mk('new'))).toHaveLength(MAX_LOG);
  });
});

describe('formula builder ops', () => {
  test('addDie starts, appends, and collapses same-sided dice', () => {
    expect(addDie('', 6)).toBe('1d6');
    expect(addDie('1d6', 6)).toBe('2d6');
    expect(addDie('2d6', 8)).toBe('2d6+1d8');
    expect(addDie('2d6+3', 6)).toBe('3d6+3');
  });
  test('addDie on hand-typed junk starts over from one die', () => {
    expect(addDie('potato', 20)).toBe('1d20');
  });
  test('addModifier merges constants and is inert without dice', () => {
    expect(addModifier('1d20', 3)).toBe('1d20+3');
    expect(addModifier('1d20+3', -1)).toBe('1d20+2');
    expect(addModifier('1d20+1', -1)).toBe('1d20');
    expect(addModifier('', 3)).toBe('');
    expect(addModifier('junk', 3)).toBe('junk');
  });
});
