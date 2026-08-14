export interface PackSource {
  /** Directory under packs/ in the sw5e-foundry/sw5e repo. */
  packDir: string;
  /** Target reference table. */
  table: string;
  /** Constant extra-column values (e.g. { power_type: 'force' }). */
  fixed?: Record<string, string | number>;
}

/** Maps every sw5e Foundry pack directory to a reference table. */
export const PACK_SOURCES: PackSource[] = [
  { packDir: 'species', table: 'species' },
  { packDir: 'speciesfeatures', table: 'species_features' },
  { packDir: 'classes', table: 'classes' },
  { packDir: 'classfeatures', table: 'class_features' },
  { packDir: 'archetypes', table: 'archetypes' },
  { packDir: 'archetypefeatures', table: 'archetype_features' },
  { packDir: 'backgrounds', table: 'backgrounds' },
  { packDir: 'feats', table: 'feats' },
  { packDir: 'conditions', table: 'conditions' },
  { packDir: 'fightingstyles', table: 'fighting_styles' },
  { packDir: 'fightingmasteries', table: 'fighting_masteries' },
  { packDir: 'maneuvers', table: 'maneuvers' },
  { packDir: 'lightsaberforms', table: 'lightsaber_forms' },
  { packDir: 'invocations', table: 'invocations' },
  { packDir: 'forcepowers', table: 'powers', fixed: { power_type: 'force' } },
  { packDir: 'techpowers', table: 'powers', fixed: { power_type: 'tech' } },
  { packDir: 'blasters', table: 'weapons', fixed: { classification: 'blaster' } },
  { packDir: 'vibroweapons', table: 'weapons', fixed: { classification: 'vibroweapon' } },
  { packDir: 'lightweapons', table: 'weapons', fixed: { classification: 'lightweapon' } },
  { packDir: 'weaponproperties', table: 'weapon_properties' },
  { packDir: 'armor', table: 'armor' },
  { packDir: 'armorproperties', table: 'armor_properties' },
  { packDir: 'ammo', table: 'gear', fixed: { category: 'ammo' } },
  { packDir: 'adventuringgear', table: 'gear', fixed: { category: 'adventuring' } },
  { packDir: 'consumables', table: 'gear', fixed: { category: 'consumable' } },
  { packDir: 'explosives', table: 'gear', fixed: { category: 'explosive' } },
  { packDir: 'kits', table: 'gear', fixed: { category: 'kit' } },
  { packDir: 'implements', table: 'gear', fixed: { category: 'implement' } },
  { packDir: 'gamingsets', table: 'gear', fixed: { category: 'gamingset' } },
  { packDir: 'musicalinstruments', table: 'gear', fixed: { category: 'musicalinstrument' } },
  { packDir: 'modifications', table: 'modifications' },
  { packDir: 'enhanceditems', table: 'enhanced_items' },
  { packDir: 'starships', table: 'starship_sizes' },
  { packDir: 'starshipequipment', table: 'starship_equipment' },
  { packDir: 'starshipweapons', table: 'starship_weapons' },
  { packDir: 'starshiparmor', table: 'starship_armor' },
  { packDir: 'starshipmodifications', table: 'starship_modifications' },
  { packDir: 'starshipfeatures', table: 'starship_features' },
  { packDir: 'starshipactions', table: 'starship_actions' },
  { packDir: 'deployments', table: 'deployments' },
  { packDir: 'deploymentfeatures', table: 'deployment_features' },
  { packDir: 'ventures', table: 'ventures' },
  { packDir: 'monsters', table: 'monsters' },
  { packDir: 'monstertraits', table: 'monster_traits' },
  // 87 pre-built ships (Foundry Actor docs, not Items) — see distillStockShip.
  { packDir: 'drakes-shipyard', table: 'starships' },
];

export interface RefRow {
  id: string;
  name: string | null;
  content_source: string | null;
  content_type: string | null;
  raw_json: string;
  extra: Record<string, string | number | null>;
}

const SHIP_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SHIP_ITEM_SYSTEM_KEYS = ['armor', 'weaponType', 'mountType', 'quantity', 'tier', 'size'] as const;

/**
 * Stock-ship actors carry ~54 embedded items with full HTML descriptions: 16 MB
 * of JSON across the pack, which would land in the baked seed image and on the
 * wire for the DM's ship browser. Every dropped detail already lives in the
 * reference table the embedded item points at (flags.core.sourceId), so this
 * stores a SHAPE-PRESERVING projection — identical Foundry field paths,
 * essentials only (1.1 MB total, ~13 KB/ship; monsters average 25 KB).
 * Deliberate exception to "raw_json always preserves the full Foundry document".
 */
export function distillStockShip(doc: any): Record<string, unknown> {
  const d = doc && typeof doc === 'object' ? doc : {};
  const system = d.system ?? {};
  const attrs = system.attributes ?? {};
  const hp = attrs.hp ?? {};
  const ac = attrs.ac ?? {};
  const details = system.details ?? {};

  const abilities: Record<string, { value: unknown }> = {};
  for (const k of SHIP_ABILITIES) {
    if (system.abilities?.[k]) abilities[k] = { value: system.abilities[k].value ?? null };
  }

  const items = (Array.isArray(d.items) ? d.items : []).map((it: any) => {
    const sys = it?.system ?? {};
    const sourceId = it?.flags?.core?.sourceId;
    const kept: Record<string, unknown> = {};
    for (const k of SHIP_ITEM_SYSTEM_KEYS) if (k in sys) kept[k] = sys[k];
    return {
      _id: it?._id ?? null,
      name: typeof it?.name === 'string' ? it.name : null,
      type: typeof it?.type === 'string' ? it.type : null,
      ...(typeof sourceId === 'string' ? { flags: { core: { sourceId } } } : {}),
      system: kept,
    };
  });

  return {
    _id: d._id ?? null,
    name: typeof d.name === 'string' ? d.name : null,
    type: typeof d.type === 'string' ? d.type : null,
    system: {
      abilities,
      attributes: {
        ac: { flat: ac.flat ?? null, calc: ac.calc ?? null },
        hp: { value: hp.value ?? null, max: hp.max ?? null, temp: hp.temp ?? null, tempmax: hp.tempmax ?? null },
        movement: attrs.movement ?? null,
        systemDamage: attrs.systemDamage ?? null,
      },
      details: { source: details.source ?? null, tier: details.tier ?? null, role: details.role ?? null },
      traits: { size: system.traits?.size ?? null },
    },
    items,
  };
}

/** Best-effort extraction; raw_json always preserves the full Foundry document. */
export function mapFoundryDoc(source: PackSource, doc: any): RefRow {
  const system = (doc && typeof doc === 'object' ? doc.system : null) ?? {};
  const extra: Record<string, string | number | null> = { ...(source.fixed ?? {}) };

  if (source.table === 'powers') {
    if (typeof system.level === 'number') extra.level = system.level;
    // Foundry shape varies; try the most likely fields, else null (raw_json keeps the truth).
    const align = system.forceAlignment ?? system.alignment ?? null;
    extra.force_alignment = typeof align === 'string' ? align : null;
  }
  // Stock ships put their book at system.details.source; every Item pack uses system.source.
  const isStockShip = source.table === 'starships';
  const source_field = isStockShip ? system.details?.source : system.source;
  const content_source =
    typeof source_field === 'string'
      ? source_field
      : source_field && typeof source_field.book === 'string'
        ? source_field.book
        : null;

  return {
    id: String(doc?._id ?? doc?.name ?? ''),
    name: typeof doc?.name === 'string' ? doc.name : null,
    content_source,
    content_type: typeof system.contentType === 'string' ? system.contentType : null,
    raw_json: JSON.stringify(isStockShip ? distillStockShip(doc) : doc),
    extra,
  };
}
