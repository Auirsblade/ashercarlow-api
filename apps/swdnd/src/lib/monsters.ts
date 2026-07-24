// apps/swdnd/src/lib/monsters.ts — tolerant essentials parser for Foundry
// monster actors. Every field degrades to null/''/[] on malformed data; the
// parser never throws (spec: "display rough, not broken").
import { cleanRichText } from './richText';

export interface MonsterEntryText { name: string; text: string }

export interface MonsterView {
  id: string;
  name: string;
  cr: number | null;
  crLabel: string;
  type: string;
  size: string;
  hp: number | null;
  hpFormula: string | null;
  ac: number | null;
  speed: string;
  abilities: { str: number | null; dex: number | null; con: number | null; int: number | null; wis: number | null; cha: number | null };
  traits: MonsterEntryText[];   // items type 'feat'
  actions: MonsterEntryText[];  // items type 'weapon'
  powers: MonsterEntryText[];   // items type 'power' (262 in the corpus — dropping them would gut casters)
}

export interface MonsterRow { id: string; name: string; raw_json: string }

const SIZE_LABELS: Record<string, string> = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan',
};
const CR_FRACTIONS: Record<number, string> = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
// Real movement modes; 'space'/'turn' are starship fields, 'units'/'hover' are annotations.
const MOVE_MODES = ['walk', 'fly', 'swim', 'climb', 'burrow', 'roll', 'crawl'] as const;

function num(v: unknown): number | null {
  const n = Number(v);
  return typeof v === 'boolean' || v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}

export function crLabel(cr: number | null): string {
  if (cr === null) return '—';
  return CR_FRACTIONS[cr] ?? String(cr);
}

function speedOf(movement: Record<string, unknown> | undefined): string {
  if (!movement) return '';
  const units = typeof movement.units === 'string' && movement.units ? movement.units : 'ft';
  const parts: string[] = [];
  for (const mode of MOVE_MODES) {
    const v = num(movement[mode]);
    if (!v) continue;
    const hover = mode === 'fly' && movement.hover === true ? ' (hover)' : '';
    parts.push(mode === 'walk' ? `${v} ${units}.` : `${mode} ${v} ${units}.${hover}`);
  }
  return parts.join(', ');
}

function itemEntries(items: unknown, type: string): MonsterEntryText[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, any> => !!it && typeof it === 'object' && it.type === type)
    .map((it) => ({
      name: typeof it.name === 'string' ? it.name : '',
      text: cleanRichText(it.system?.description?.value),
    }));
}

/** Parse one content row into a display view. Never throws. */
export function parseMonster(row: MonsterRow): MonsterView {
  let raw: Record<string, any> = {};
  try { raw = JSON.parse(row.raw_json) ?? {}; } catch { /* unparsable → all-null view */ }
  const sys: Record<string, any> = raw.system ?? {};
  const details: Record<string, any> = sys.details ?? {};
  const attrs: Record<string, any> = sys.attributes ?? {};

  const cr = num(details.cr);
  const typeRaw = details.type;
  const type = typeof typeRaw === 'string' ? typeRaw
    : typeof typeRaw?.value === 'string' ? typeRaw.value : '';

  const abilities = {} as MonsterView['abilities'];
  for (const k of ABILITY_KEYS) abilities[k] = num(sys.abilities?.[k]?.value);

  return {
    id: row.id,
    name: row.name || (typeof raw.name === 'string' ? raw.name : row.id),
    cr,
    crLabel: crLabel(cr),
    type,
    size: SIZE_LABELS[sys.traits?.size as string] ?? '',
    hp: num(attrs.hp?.max) ?? num(attrs.hp?.value),
    hpFormula: typeof attrs.hp?.formula === 'string' && attrs.hp.formula ? attrs.hp.formula : null,
    ac: num(attrs.ac?.flat),
    speed: speedOf(attrs.movement),
    abilities,
    traits: itemEntries(raw.items, 'feat'),
    actions: itemEntries(raw.items, 'weapon'),
    powers: itemEntries(raw.items, 'power'),
  };
}

export interface MonsterFilter { q: string; type?: string; crMin?: number; crMax?: number }

export function filterMonsters(list: MonsterView[], f: MonsterFilter): MonsterView[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q)) return false;
    if (f.type && m.type !== f.type) return false;
    if (f.crMin !== undefined && (m.cr === null || m.cr < f.crMin)) return false;
    if (f.crMax !== undefined && (m.cr === null || m.cr > f.crMax)) return false;
    return true;
  });
}

export function monsterTypes(list: MonsterView[]): string[] {
  return [...new Set(list.map((m) => m.type).filter(Boolean))].sort();
}
