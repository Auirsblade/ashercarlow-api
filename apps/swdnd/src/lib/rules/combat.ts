// apps/swdnd/src/lib/rules/combat.ts
import { abilityModifier, classesTaken, totalAbilityScores } from './core';
import type { CharacterBuild, ReferenceData } from './types';

export function maxHp(build: CharacterBuild, ref: ReferenceData): number {
  const conMod = abilityModifier(totalAbilityScores(build).con);
  let total = 0;
  for (const lvl of build.levels) {
    const cls = ref.classes[lvl.classId];
    const die = cls?.hitDie ?? 6;
    const base = lvl.n === 1
      ? die
      : (lvl.hp === 'avg' ? Math.floor(die / 2) + 1 : lvl.hp);
    total += Math.max(1, base + conMod);
  }
  return total;
}

export function armorClass(build: CharacterBuild, ref: ReferenceData): number {
  const dexMod = abilityModifier(totalAbilityScores(build).dex);
  const equipped = build.equipment.filter((e) => e.equipped).map((e) => ref.armor[e.ref]).filter(Boolean);
  const body = equipped.find((a) => a.kind !== 'shield');
  const shield = equipped.find((a) => a.kind === 'shield');

  let ac: number;
  if (!body) {
    ac = 10 + dexMod;
  } else {
    const dexPart = body.dexCap == null ? dexMod : Math.min(dexMod, body.dexCap);
    ac = body.baseAc + dexPart;
  }
  if (shield) ac += shield.baseAc;
  return ac;
}

export function initiative(build: CharacterBuild): number {
  return abilityModifier(totalAbilityScores(build).dex);
}

export function speed(build: CharacterBuild, ref: ReferenceData): number {
  return ref.species[build.identity.speciesId]?.walkSpeed ?? 30;
}

export function hitDice(build: CharacterBuild, ref: ReferenceData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const taken of classesTaken(build)) {
    const die = ref.classes[taken.classId]?.hitDie;
    if (!die) continue;
    const key = `d${die}`;
    out[key] = (out[key] ?? 0) + taken.levels;
  }
  return out;
}
