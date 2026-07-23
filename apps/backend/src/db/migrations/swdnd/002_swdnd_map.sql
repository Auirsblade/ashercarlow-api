CREATE TABLE scene (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  image_path      TEXT,
  image_w         INTEGER,
  image_h         INTEGER,
  grid_json       TEXT NOT NULL DEFAULT '{}',
  fog_json        TEXT NOT NULL DEFAULT '[]',
  initiative_json TEXT,
  is_active       INTEGER NOT NULL DEFAULT 0,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_scene_campaign ON scene(campaign_id);

CREATE TABLE token (
  id              TEXT PRIMARY KEY,
  scene_id        TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  character_id    TEXT REFERENCES character(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#4dd0e1',
  faction         TEXT NOT NULL DEFAULT 'friendly',
  q               INTEGER NOT NULL DEFAULT 0,
  r               INTEGER NOT NULL DEFAULT 0,
  scale           INTEGER NOT NULL DEFAULT 1,
  hp              INTEGER,
  max_hp          INTEGER,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  hidden          INTEGER NOT NULL DEFAULT 0,
  image_path      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_token_scene ON token(scene_id);
