CREATE TABLE template (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('blast', 'cone', 'line')),
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  dir INTEGER NOT NULL DEFAULT 0,      -- cone: hex direction 0-5
  size INTEGER NOT NULL DEFAULT 1,     -- blast: radius; cone: length; line: unused
  q2 INTEGER,                          -- line: endpoint hex
  r2 INTEGER,
  color TEXT NOT NULL DEFAULT '#c792ea',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_template_scene ON template(scene_id);
