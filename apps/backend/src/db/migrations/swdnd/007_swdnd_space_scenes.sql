-- Space encounters (sub-project 3): per-scene ground/space mode and ship-bound
-- tokens with a hex facing. `mode` drives UI affordances only — distance still
-- comes from grid_json.unitsPerHex (5 ft ground / 50 ft space).
-- Not NOT NULL: SQLite rejects any UPDATE that sets a NOT NULL column back to
-- NULL, which would make hand-edited/legacy-simulated NULL rows impossible to
-- construct. sceneOut() below already treats anything but 'space' as ground,
-- so the DEFAULT still gives every real row (new or pre-migration, backfilled
-- eagerly by SQLite) 'ground' with no NULL ever surfacing over the API.
ALTER TABLE scene ADD COLUMN mode TEXT DEFAULT 'ground';

-- Nullable, so SQLite accepts the REFERENCES clause on ADD COLUMN. Deleting a
-- starship removes its map tokens.
ALTER TABLE token ADD COLUMN ship_id TEXT REFERENCES starship(id) ON DELETE CASCADE;
-- 0-5, an index into the six axial hex directions (lib/hex.ts AXIAL_DIRS).
ALTER TABLE token ADD COLUMN facing INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_token_ship ON token(ship_id);
