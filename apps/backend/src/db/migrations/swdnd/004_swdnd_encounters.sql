-- Named monster groups for DM encounter prep. monsters_json: [{monsterId, count}].
CREATE TABLE encounter (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  monsters_json TEXT NOT NULL DEFAULT '[]',
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_encounter_campaign ON encounter(campaign_id);
