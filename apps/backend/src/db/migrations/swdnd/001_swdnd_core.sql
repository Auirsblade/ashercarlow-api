CREATE TABLE campaign (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE player (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);

CREATE TABLE character (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  player_id   TEXT REFERENCES player(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_player_campaign ON player(campaign_id);
CREATE INDEX idx_character_campaign ON character(campaign_id);
CREATE INDEX idx_character_player ON character(player_id);

CREATE TABLE data_version (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  source_repo TEXT,
  commit_hash TEXT,
  imported_at TEXT
);
