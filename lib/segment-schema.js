export function initSegmentTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_skip_cache (
      episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      media_key TEXT NOT NULL,
      duration REAL,
      segments TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episode_skip_overrides (
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('intro', 'outro')),
      mode TEXT NOT NULL CHECK(mode IN ('custom', 'absent', 'disabled')),
      media_key TEXT NOT NULL,
      segments TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (episode_id, type)
    );
  `);
}
