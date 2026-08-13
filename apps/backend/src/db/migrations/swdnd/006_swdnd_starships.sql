CREATE TABLE starship (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Ship <-> character crewing is many-to-many from day one: one shared party
-- ship AND individual fighters must coexist. A join table (not JSON inside
-- data_json) keeps the write-access check -- "is this player's character on
-- this crew?" -- a single indexed server-side join.
-- SOTG's "at most one of each role except gunners" is app-level validation
-- (warn, don't block -- house-rule friendly), not a DB constraint.
CREATE TABLE starship_crew (
  ship_id      TEXT NOT NULL REFERENCES starship(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,   -- coordinator|gunner|mechanic|operator|pilot|technician
  PRIMARY KEY (ship_id, character_id, role)
);

CREATE INDEX idx_starship_campaign ON starship(campaign_id);
CREATE INDEX idx_starship_crew_character ON starship_crew(character_id);
