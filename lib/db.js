import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db;

export function getDb() {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'data', 'cultanime.db');
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Initialize tables
    initTables(db);
  }
  return db;
}

function initTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anilist_id INTEGER UNIQUE,
      jellyfin_id TEXT UNIQUE,
      title TEXT NOT NULL,
      title_romaji TEXT,
      title_english TEXT,
      description TEXT,
      cover_image TEXT,
      banner_image TEXT,
      genres TEXT DEFAULT '[]',
      status TEXT,
      episodes_total INTEGER,
      rating INTEGER,
      year INTEGER,
      season TEXT,
      format TEXT,
      studios TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      episode_number INTEGER NOT NULL,
      title TEXT,
      file_path TEXT NOT NULL,
      jellyfin_item_id TEXT,
      duration INTEGER,
      thumbnail TEXT,
      air_date TEXT,
      overview TEXT,
      runtime_ticks INTEGER,
      provider_ids TEXT DEFAULT '{}',
      season_number INTEGER,
      production_year INTEGER,
      manual_metadata INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(anime_id, episode_number)
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      progress REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      completed BOOLEAN DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, anime_id)
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_anime ON episodes(anime_id);
    CREATE INDEX IF NOT EXISTS idx_history_session ON watch_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_history_anime ON watch_history(anime_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_session ON watchlist(session_id);
  `);

  // Migrations: add newer episode metadata columns to existing databases.
  try {
    ensureColumns(db, 'episodes', {
      jellyfin_item_id: 'jellyfin_item_id TEXT',
      air_date: 'air_date TEXT',
      overview: 'overview TEXT',
      runtime_ticks: 'runtime_ticks INTEGER',
      provider_ids: "provider_ids TEXT DEFAULT '{}'",
      season_number: 'season_number INTEGER',
      production_year: 'production_year INTEGER',
      manual_metadata: 'manual_metadata INTEGER DEFAULT 0',
    });
  } catch (e) {
    console.error('Migration error (episode metadata):', e.message);
  }

  // Migration: add jellyfin_id column to existing anime table
  try {
    const columns = db.prepare("PRAGMA table_info(anime)").all();
    if (!columns.some(c => c.name === 'jellyfin_id')) {
      db.exec('ALTER TABLE anime ADD COLUMN jellyfin_id TEXT');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_anime_jellyfin_id ON anime(jellyfin_id)');
    }
  } catch (e) {
    console.error('Migration error (jellyfin_id):', e.message);
  }
}

function ensureColumns(db, tableName, columnDefinitions) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const existing = new Set(columns.map(column => column.name));

  for (const [name, definition] of Object.entries(columnDefinitions)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    }
  }
}
