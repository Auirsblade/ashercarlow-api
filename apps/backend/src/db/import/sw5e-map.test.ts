import { describe, it, expect } from 'bun:test';
import { mapFoundryDoc, PACK_SOURCES, distillStockShip, type PackSource } from './sw5e-map';

const speciesSource: PackSource = { packDir: 'species', table: 'species' };
const forceSource: PackSource = { packDir: 'forcepowers', table: 'powers', fixed: { power_type: 'force' } };

describe('mapFoundryDoc', () => {
  it('maps common fields and stores raw_json', () => {
    const doc = { _id: 'abc123', name: 'Human', system: { source: 'PHB', contentType: 'Core' } };
    const row = mapFoundryDoc(speciesSource, doc);
    expect(row.id).toBe('abc123');
    expect(row.name).toBe('Human');
    expect(row.content_source).toBe('PHB');
    expect(row.content_type).toBe('Core');
    expect(JSON.parse(row.raw_json)).toEqual(doc);
    expect(row.extra).toEqual({});
  });

  it('applies fixed columns, extracts power level, and best-effort force_alignment', () => {
    const doc = { _id: 'p1', name: 'Force Push', system: { level: 1, forceAlignment: 'Universal' } };
    const row = mapFoundryDoc(forceSource, doc);
    expect(row.extra.power_type).toBe('force');
    expect(row.extra.level).toBe(1);
    expect(row.extra.force_alignment).toBe('Universal');
  });

  it('leaves force_alignment null when absent', () => {
    const doc = { _id: 'p2', name: 'Mind Trick', system: { level: 2 } };
    const row = mapFoundryDoc(forceSource, doc);
    expect(row.extra.force_alignment).toBeNull();
  });

  it('falls back to name when _id is missing and tolerates missing system', () => {
    const row = mapFoundryDoc(speciesSource, { name: "Twi'lek" });
    expect(row.id).toBe("Twi'lek");
    expect(row.content_source).toBeNull();
    expect(row.raw_json).toContain('Twi');
  });

  it('covers all sw5e pack directories without duplicate (packDir) entries', () => {
    const dirs = PACK_SOURCES.map((s) => s.packDir);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(PACK_SOURCES.length).toBeGreaterThanOrEqual(40);
  });
});

const stockShipSource: PackSource = { packDir: 'drakes-shipyard', table: 'starships' };

/** Trimmed real actor: Aka'jor-class Shuttle (+ one ARC-170 weapon). */
const stockShipDoc = {
  _id: 'tRnGAAILKowm8n4T',
  name: "Aka'jor-class Shuttle",
  type: 'starship',
  img: 'https://example.invalid/shuttle.jpg',
  effects: [{ _id: 'fx1', name: 'Directional Shield' }],
  prototypeToken: { name: "Aka'jor-class Shuttle", width: 1, height: 1 },
  system: {
    abilities: {
      str: { value: 13, proficient: 1, bonuses: { check: '', save: '' } },
      dex: { value: 14, proficient: 1, bonuses: { check: '', save: '' } },
      con: { value: 13, proficient: 0, bonuses: { check: '', save: '' } },
      int: { value: 8, proficient: 0, bonuses: { check: '', save: '' } },
      wis: { value: 12, proficient: 0, bonuses: { check: '', save: '' } },
      cha: { value: 14, proficient: 0, bonuses: { check: '', save: '' } },
      hon: { value: 10, proficient: 0 },
      san: { value: 10, proficient: 0 },
    },
    attributes: {
      ac: { flat: null, calc: 'starship', formula: '' },
      hp: { value: 27, max: 27, temp: 18, tempmax: 18, min: 0, bonuses: { level: '' } },
      hull: { die: '', dice: 0, dicemax: 0, value: null, max: null },
      movement: { walk: 30, fly: 0, space: 0, turn: 0, units: 'ft', hover: false },
      systemDamage: 0,
    },
    details: { biography: { value: '<p>long prose</p>' }, description: { value: '<p>more prose</p>' }, source: "Drake's Shipyard", tier: '2', role: [] },
    traits: { size: null, di: {}, dr: {} },
    skills: { ast: { value: 0 } },
  },
  items: [
    {
      _id: 'i1', name: 'Small Starship', type: 'starshipsize',
      effects: [], ownership: { default: 0 }, _stats: { systemId: 'sw5e' },
      flags: { core: { sourceId: 'Compendium.sw5e.starships.6BN8l5E8QtYt103T' } },
      system: { description: { value: '<p>Long chassis prose describing hull plating, internal frame bracing, and the construction techniques typical of small shuttle-class starships built for short-range diplomatic and cargo runs.</p>' }, tier: 2, size: 'sm', hullDice: 'd6', hullDiceStart: 3, advancement: [{ type: 'HitPoints' }] },
    },
    {
      _id: 'i2', name: 'Deflection Armor', type: 'equipment',
      flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.aG6mKPerYCFmkI00' } },
      system: { description: { value: '<p>Deflection armor prose: a layered plating scheme that redirects incoming energy bolts along the hull surface, trading raw hardness for a modest boost to dexterity-based evasion.</p>' }, armor: { value: 10, type: 'starship', dex: 2 }, equipped: true, quantity: 1 },
    },
    {
      _id: 'i3', name: 'Quick-Charge Shield', type: 'equipment',
      flags: { core: { sourceId: 'Compendium.sw5e.starshiparmor.M7igMGsBIosGA4dS' } },
      system: { description: { value: '<p>Quick-charge shield prose: capacitor banks that regenerate the deflector envelope faster than a standard array, at the cost of a lower sustained maximum charge under prolonged fire.</p>' }, armor: { value: 0, type: 'ssshield', dex: null }, equipped: true, quantity: 1 },
    },
    {
      _id: 'i4', name: 'Heavy blaster cannon', type: 'weapon',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipweapons.A0LPvkVHhH3e2Aeh' } },
      system: { description: { value: '<p>Heavy blaster cannon prose: a primary starship-scale weapon mount firing bolts of concentrated energy, standard armament on shuttles and light freighters throughout the Outer Rim.</p>' }, weaponType: 'primary (starship)', mountType: null, quantity: 1, damage: { parts: [['1d10', 'energy']] } },
    },
    {
      _id: 'i5', name: 'Adaptive Ailerons', type: 'starshipmod',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipmodifications.H1PmkigBok9ThtyJ' } },
      system: { description: { value: '<p>Adaptive ailerons prose: a control-surface modification that reshapes itself mid-flight to trim drag, improving maneuverability at the expense of a slightly larger radar cross-section.</p>' }, armor: { type: '', value: null, dex: null }, quantity: 1, tier: 0 },
    },
    {
      _id: 'i6', name: 'Attack Run', type: 'feat',
      flags: { core: { sourceId: 'Compendium.sw5e.starshipactions.O9t2gB5wl6n86Eh4' } },
      system: { description: { value: '<p>Attack Run action prose: a pilot commits to a straight strafing pass against a target, trading defensive maneuvering for a burst of extra accuracy on the ensuing weapon attack.</p>' }, type: { value: 'starshipAction' } },
    },
  ],
};

describe('distillStockShip', () => {
  it('keeps identity, abilities, pools, tier and item refs', () => {
    const d = distillStockShip(stockShipDoc) as any;
    expect(d._id).toBe('tRnGAAILKowm8n4T');
    expect(d.name).toBe("Aka'jor-class Shuttle");
    expect(d.type).toBe('starship');
    expect(d.system.abilities.str.value).toBe(13);
    expect(d.system.abilities.cha.value).toBe(14);
    expect(d.system.abilities.hon).toBeUndefined();       // hon/san are not real ship abilities
    expect(d.system.attributes.hp).toEqual({ value: 27, max: 27, temp: 18, tempmax: 18 });
    expect(d.system.details.tier).toBe('2');
    expect(d.system.details.source).toBe("Drake's Shipyard");
    expect(d.system.traits.size).toBeNull();
    expect(d.items).toHaveLength(6);
    const size = d.items.find((i: any) => i.type === 'starshipsize');
    expect(size.flags.core.sourceId).toBe('Compendium.sw5e.starships.6BN8l5E8QtYt103T');
    expect(size.system.tier).toBe(2);
    const armor = d.items.find((i: any) => i.name === 'Deflection Armor');
    expect(armor.system.armor).toEqual({ value: 10, type: 'starship', dex: 2 });
    const weapon = d.items.find((i: any) => i.type === 'weapon');
    expect(weapon.system.weaponType).toBe('primary (starship)');
    expect(weapon.system.mountType).toBeNull();
  });

  it('drops the prose and Foundry chrome that make the pack 16 MB', () => {
    const json = JSON.stringify(distillStockShip(stockShipDoc));
    expect(json).not.toContain('prose');
    expect(json).not.toContain('prototypeToken');
    expect(json).not.toContain('advancement');
    expect(json).not.toContain('_stats');
    expect(json.length).toBeLessThan(JSON.stringify(stockShipDoc).length / 2);
  });

  it('tolerates a malformed document', () => {
    const d = distillStockShip({}) as any;
    expect(d.items).toEqual([]);
    expect(d.system.attributes.hp).toEqual({ value: null, max: null, temp: null, tempmax: null });
    expect(() => JSON.stringify(distillStockShip(null))).not.toThrow();
  });
});

describe('mapFoundryDoc for stock ships', () => {
  it('stores the distilled doc and reads content_source from details.source', () => {
    const row = mapFoundryDoc(stockShipSource, stockShipDoc);
    expect(row.id).toBe('tRnGAAILKowm8n4T');
    expect(row.name).toBe("Aka'jor-class Shuttle");
    expect(row.content_source).toBe("Drake's Shipyard");
    expect(row.extra).toEqual({});
    expect(row.raw_json).not.toContain('prose');
    expect(JSON.parse(row.raw_json).system.attributes.hp.max).toBe(27);
  });

  it('maps the two easily-confused starship packs to different tables', () => {
    const byDir = Object.fromEntries(PACK_SOURCES.map((s) => [s.packDir, s.table]));
    expect(byDir['starships']).toBe('starship_sizes');       // the six size chassis
    expect(byDir['drakes-shipyard']).toBe('starships');      // the 87 pre-built ships
  });
});
