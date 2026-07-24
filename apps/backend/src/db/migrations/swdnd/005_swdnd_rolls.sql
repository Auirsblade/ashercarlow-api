-- Campaign roll log: append-only record of dice rolls (client rolls, server records).
CREATE TABLE roll (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  roller      TEXT NOT NULL,              -- display name: player/character name or 'DM'
  label       TEXT,                       -- e.g. 'Perception check', 'Blaster damage'
  formula     TEXT NOT NULL,              -- '2d6+1d8+3'
  rolls_json  TEXT NOT NULL DEFAULT '[]', -- [{sides, value}, ...]
  total       INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0, -- DM-only secret roll
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_roll_campaign ON roll(campaign_id, created_at);
