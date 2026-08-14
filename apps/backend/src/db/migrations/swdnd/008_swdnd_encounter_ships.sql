-- Encounter groups gain stock-ship members, mirroring monsters_json.
-- ships_json: [{stockShipRef, count}] where stockShipRef is a `starships`
-- reference row id. Ships are instantiated (a real `starship` row + a bound
-- token) at spawn time, so an encounter stays a reusable template.
-- Existing rows take the DEFAULT, so this is safe on a live database.
ALTER TABLE encounter ADD COLUMN ships_json TEXT NOT NULL DEFAULT '[]';
