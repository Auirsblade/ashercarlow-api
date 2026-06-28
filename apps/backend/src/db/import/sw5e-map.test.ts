import { describe, it, expect } from 'bun:test';
import { mapFoundryDoc, PACK_SOURCES, type PackSource } from './sw5e-map';

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
