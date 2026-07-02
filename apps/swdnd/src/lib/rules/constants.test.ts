// apps/swdnd/src/lib/rules/constants.test.ts
import { test, expect } from 'bun:test';
import {
  SKILLS, ABILITIES, POWER_POINTS_BASE, POWER_MAX_LEVEL, POWER_LIMIT,
  POWERS_KNOWN, casterWeight, SUPERIORITY_DICE_QUANT, SUPERIORITY_DIE_SIZE,
  MANEUVERS_KNOWN,
} from './constants';

test('skills table has 18 sw5e skills with abilities', () => {
  expect(Object.keys(SKILLS)).toHaveLength(18);
  expect(SKILLS.lor.ability).toBe('int');   // Lore
  expect(SKILLS.pil.ability).toBe('int');   // Piloting
  expect(SKILLS.tec.ability).toBe('int');   // Technology
  expect(SKILLS.ath.ability).toBe('str');
});

test('casting tables match sw5e config', () => {
  expect(ABILITIES).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
  expect(POWER_POINTS_BASE.full).toBe(4);
  expect(POWER_MAX_LEVEL.full[5]).toBe(3);
  expect(POWER_MAX_LEVEL.full).toHaveLength(21);
  expect(POWER_LIMIT.full).toBe(6);
  expect(POWERS_KNOWN.force.full[5]).toBe(17);
  expect(POWERS_KNOWN.tech.half[2]).toBe(4);
});

test('caster weight derives from powerMaxLevel[20] / 9', () => {
  expect(casterWeight('full')).toBe(1);
  expect(casterWeight('half')).toBeCloseTo(5 / 9, 6);
});

test('superiority tables match sw5e config', () => {
  expect(SUPERIORITY_DICE_QUANT[3]).toBe(4);
  expect(SUPERIORITY_DIE_SIZE[5]).toBe('d6');
  expect(MANEUVERS_KNOWN[3]).toBe(4);
});
