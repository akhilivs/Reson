// Versioned schema migrations. Each migration runs once, inside a transaction,
// and is recorded in schema_migrations. Never edit a shipped migration — add a new one.

export const migrations = [
  {
    version: 1,
    name: 'initial schema',
    up: `
      CREATE TABLE folders (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL,
        last_scanned_at INTEGER,
        available INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE artists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE
      );

      CREATE TABLE artwork (
        id INTEGER PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        file TEXT NOT NULL,
        thumb_file TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        palette TEXT
      );

      CREATE TABLE albums (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        album_key TEXT NOT NULL UNIQUE,
        artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        artist_name TEXT NOT NULL,
        year INTEGER,
        artwork_id INTEGER REFERENCES artwork(id) ON DELETE SET NULL
      );

      CREATE TABLE tracks (
        id INTEGER PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mtime INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT,
        title TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        album_title TEXT NOT NULL,
        album_artist TEXT NOT NULL,
        artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
        track_no INTEGER,
        track_total INTEGER,
        disc_no INTEGER,
        disc_total INTEGER,
        year INTEGER,
        genre TEXT,
        duration REAL,
        bitrate INTEGER,
        sample_rate INTEGER,
        codec TEXT,
        container TEXT,
        lossless INTEGER NOT NULL DEFAULT 0,
        has_lyrics INTEGER NOT NULL DEFAULT 0,
        artwork_id INTEGER REFERENCES artwork(id) ON DELETE SET NULL,
        available INTEGER NOT NULL DEFAULT 1,
        unsupported_reason TEXT,
        date_added INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_tracks_album ON tracks(album_id, disc_no, track_no);
      CREATE INDEX idx_tracks_artist ON tracks(artist_id);
      CREATE INDEX idx_tracks_folder ON tracks(folder_id);
      CREATE INDEX idx_tracks_date_added ON tracks(date_added DESC);
      CREATE INDEX idx_tracks_title ON tracks(title COLLATE NOCASE);
      CREATE INDEX idx_tracks_fingerprint ON tracks(fingerprint);
      CREATE INDEX idx_albums_artist ON albums(artist_id);

      CREATE TABLE favorites (
        track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE playlist_tracks (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      );
      CREATE INDEX idx_playlist_tracks ON playlist_tracks(playlist_id, position);

      CREATE TABLE play_history (
        id INTEGER PRIMARY KEY,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at INTEGER NOT NULL,
        listened REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_history_played ON play_history(played_at DESC);
      CREATE INDEX idx_history_track ON play_history(track_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE tracks_fts USING fts5(
        title, artist_name, album_title, file_name,
        content='tracks', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER tracks_ai AFTER INSERT ON tracks BEGIN
        INSERT INTO tracks_fts(rowid, title, artist_name, album_title, file_name)
        VALUES (new.id, new.title, new.artist_name, new.album_title, new.file_name);
      END;
      CREATE TRIGGER tracks_ad AFTER DELETE ON tracks BEGIN
        INSERT INTO tracks_fts(tracks_fts, rowid, title, artist_name, album_title, file_name)
        VALUES ('delete', old.id, old.title, old.artist_name, old.album_title, old.file_name);
      END;
      CREATE TRIGGER tracks_au AFTER UPDATE OF title, artist_name, album_title, file_name ON tracks BEGIN
        INSERT INTO tracks_fts(tracks_fts, rowid, title, artist_name, album_title, file_name)
        VALUES ('delete', old.id, old.title, old.artist_name, old.album_title, old.file_name);
        INSERT INTO tracks_fts(rowid, title, artist_name, album_title, file_name)
        VALUES (new.id, new.title, new.artist_name, new.album_title, new.file_name);
      END;
    `,
  },
  {
    version: 2,
    name: 'ALAC is playable via lossless conversion',
    up: `UPDATE tracks SET unsupported_reason = NULL WHERE codec LIKE '%ALAC%' AND unsupported_reason LIKE '%ALAC%';`,
  },
];

export function runMigrations(db, list = migrations) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );
  const pending = [...list].sort((a, b) => a.version - b.version).filter((m) => !applied.has(m.version));
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        Date.now(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`, { cause: err });
    }
  }
  return pending.map((m) => m.version);
}

export function currentSchemaVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row?.v ?? 0;
}
