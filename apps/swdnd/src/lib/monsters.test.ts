// apps/swdnd/src/lib/monsters.test.ts
import { describe, expect, it } from 'bun:test';
import { filterMonsters, monsterTypes, parseMonster } from './monsters';

// Trimmed real corpus record: "Shrub" (CR 0 plant, sm, hp 10 "3d6", ac 9, walk 20).
const shrub = {
  id: 'ztM6EzzbMpfFBB3a',
  name: 'Shrub',
  raw_json: JSON.stringify({
    name: 'Shrub',
    system: {
      abilities: {
        str: { value: 3 }, dex: { value: 8 }, con: { value: 11 },
        int: { value: 10 }, wis: { value: 10 }, cha: { value: 6 },
        hon: { value: 0 }, san: { value: 0 },
      },
      attributes: {
        hp: { value: 10, max: 10, formula: '3d6' },
        ac: { flat: 9, calc: 'natural', formula: '' },
        movement: { walk: 20, fly: 0, swim: 0, climb: 0, burrow: 0, roll: 0, crawl: 0, turn: 0, space: 0, units: 'ft', hover: false },
      },
      details: { cr: 0, type: { value: 'plant', subtype: '', swarm: '', custom: '' } },
      traits: { size: 'sm' },
    },
    items: [
      { type: 'feat', name: 'False Appearance', system: { description: { value: '<p>While the shrub remains motionless, it is indistinguishable from a normal shrub.</p>' } } },
      { type: 'weapon', name: 'Rake', system: { description: { value: '<p><em>Melee Weapon Attack</em> +1, Reach 5 ft., One target. <em>Hit:</em> 1 (1d4 - 1) kinetic damage.</p>' } } },
      { type: 'equipment', name: 'Mulch', system: { description: { value: '<p>ignored</p>' } } },
    ],
  }),
};

const degenerate = { id: 'bad1', name: 'Broken Record', raw_json: '{"name":"Broken Record"}' };
const unparsable = { id: 'bad2', name: 'Not JSON', raw_json: '{nope' };

describe('parseMonster', () => {
  it('parses the essentials from a real record', () => {
    const v = parseMonster(shrub);
    expect(v.id).toBe('ztM6EzzbMpfFBB3a');
    expect(v.name).toBe('Shrub');
    expect(v.cr).toBe(0);
    expect(v.crLabel).toBe('0');
    expect(v.type).toBe('plant');
    expect(v.size).toBe('Small');
    expect(v.hp).toBe(10);
    expect(v.hpFormula).toBe('3d6');
    expect(v.ac).toBe(9);
    expect(v.speed).toBe('20 ft.');
    expect(v.abilities).toEqual({ str: 3, dex: 8, con: 11, int: 10, wis: 10, cha: 6 });
    expect(v.traits).toEqual([{ name: 'False Appearance', text: 'While the shrub remains motionless, it is indistinguishable from a normal shrub.' }]);
    expect(v.actions).toHaveLength(1);
    expect(v.actions[0].name).toBe('Rake');
    expect(v.actions[0].text).toContain('Melee Weapon Attack +1');
    expect(v.powers).toEqual([]); // equipment items ignored, no power items
  });

  it('string and fractional CRs normalize; fractions get fraction labels', () => {
    const withCr = (cr: unknown) => parseMonster({
      id: 'x', name: 'X', raw_json: JSON.stringify({ system: { details: { cr } } }),
    });
    expect(withCr('0').cr).toBe(0);
    expect(withCr(0.125).crLabel).toBe('1/8');
    expect(withCr(0.25).crLabel).toBe('1/4');
    expect(withCr(0.5).crLabel).toBe('1/2');
    expect(withCr(7).crLabel).toBe('7');
    expect(withCr('garbage').cr).toBeNull();
    expect(withCr('garbage').crLabel).toBe('—');
  });

  it('multiple movement modes join; hover annotates fly', () => {
    const v = parseMonster({
      id: 'x', name: 'X',
      raw_json: JSON.stringify({ system: { attributes: { movement: { walk: 30, fly: 60, swim: 20, hover: true, units: 'ft' } } } }),
    });
    expect(v.speed).toBe('30 ft., fly 60 ft. (hover), swim 20 ft.');
  });

  it('a degenerate record displays rough, not broken', () => {
    const v = parseMonster(degenerate);
    expect(v).toEqual({
      id: 'bad1', name: 'Broken Record', cr: null, crLabel: '—', type: '', size: '',
      hp: null, hpFormula: null, ac: null, speed: '',
      abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
      traits: [], actions: [], powers: [],
    });
  });

  it('unparsable raw_json never throws', () => {
    const v = parseMonster(unparsable);
    expect(v.name).toBe('Not JSON');
    expect(v.cr).toBeNull();
  });

  it('non-string item description values degrade to empty text, never throw', () => {
    const v = parseMonster({
      id: 'x', name: 'X',
      raw_json: JSON.stringify({ items: [{ type: 'weapon', name: 'Odd', system: { description: { value: 42 } } }] }),
    });
    expect(v.actions).toEqual([{ name: 'Odd', text: '' }]);
  });
});

describe('filterMonsters + monsterTypes', () => {
  const list = [
    parseMonster(shrub),
    parseMonster({ id: 'd1', name: 'Probe Droid', raw_json: JSON.stringify({ system: { details: { cr: 0.25, type: { value: 'droid' } } } }) }),
    parseMonster({ id: 'b1', name: 'Rancor', raw_json: JSON.stringify({ system: { details: { cr: 8, type: { value: 'beast' } } } }) }),
    parseMonster(degenerate), // cr null
  ];

  it('name search is case-insensitive substring', () => {
    expect(filterMonsters(list, { q: 'ranc' }).map((m) => m.name)).toEqual(['Rancor']);
    expect(filterMonsters(list, { q: '' })).toHaveLength(4);
  });

  it('type filter is exact; cr range excludes null-cr records', () => {
    expect(filterMonsters(list, { q: '', type: 'droid' }).map((m) => m.name)).toEqual(['Probe Droid']);
    expect(filterMonsters(list, { q: '', crMin: 0.25 }).map((m) => m.name)).toEqual(['Probe Droid', 'Rancor']);
    expect(filterMonsters(list, { q: '', crMax: 0.5 }).map((m) => m.name)).toEqual(['Shrub', 'Probe Droid']);
    expect(filterMonsters(list, { q: '', crMin: 1, crMax: 10 }).map((m) => m.name)).toEqual(['Rancor']);
  });

  it('monsterTypes lists sorted unique non-empty types', () => {
    expect(monsterTypes(list)).toEqual(['beast', 'droid', 'plant']);
  });
});
