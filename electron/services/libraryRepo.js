import { randomUUID } from 'node:crypto';
import { transaction } from './database.js';
import { nameKey, albumKey, buildFtsQuery } from './normalize.js';

// All library SQL lives here. Queries are parameterized; sort columns are whitelisted.

const stmtCache = new WeakMap();
function stmt(db, sql) {
  let cache = stmtCache.get(db);
  if (!cache) stmtCache.set(db, (cache = new Map()));
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
}
const all = (db, sql, ...p) => stmt(db, sql).all(...p);
const get = (db, sql, ...p) => stmt(db, sql).get(...p);
const run = (db, sql, ...p) => stmt(db, sql).run(...p);

function parsePalette(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const TRACK_COLUMNS = `
  t.id, t.uid, t.title, t.artist_name AS artist, t.album_title AS album, t.album_artist AS albumArtist,
  t.artist_id AS artistId, t.album_id AS albumId, t.track_no AS trackNo, t.disc_no AS discNo,
  t.year, t.genre, t.duration, t.codec, t.container, t.lossless, t.bitrate, t.sample_rate AS sampleRate,
  t.available, t.unsupported_reason AS unsupportedReason, t.date_added AS dateAdded,
  t.file_name AS fileName, t.has_lyrics AS hasLyrics,
  a.hash AS artHash, a.palette AS palette,
  (fav.track_id IS NOT NULL) AS favorite`;
const TRACK_FROM = `
  FROM tracks t
  LEFT JOIN artwork a ON a.id = t.artwork_id
  LEFT JOIN favorites fav ON fav.track_id = t.id`;

function mapTrack(r) {
  if (!r) return null;
  return {
    ...r,
    lossless: !!r.lossless,
    available: !!r.available,
    favorite: !!r.favorite,
    hasLyrics: !!r.hasLyrics,
    palette: parsePalette(r.palette),
  };
}
const mapTracks = (rows) => rows.map(mapTrack);

const TRACK_SORTS = {
  title: 't.title COLLATE NOCASE',
  artist: 't.artist_name COLLATE NOCASE',
  album: 't.album_title COLLATE NOCASE',
  duration: 't.duration',
  dateAdded: 't.date_added',
  year: 't.year',
};
const TRACK_TIEBREAK = 't.album_title COLLATE NOCASE, t.disc_no, t.track_no, t.title COLLATE NOCASE';

// ---------- Folders ----------

export function listFolders(db) {
  return all(
    db,
    `SELECT f.id, f.path, f.added_at AS addedAt, f.last_scanned_at AS lastScannedAt, f.available,
       (SELECT COUNT(*) FROM tracks t WHERE t.folder_id = f.id) AS trackCount
     FROM folders f ORDER BY f.path COLLATE NOCASE`,
  ).map((f) => ({ ...f, available: !!f.available }));
}

export function addFolder(db, folderPath, key) {
  const existing = get(db, 'SELECT id FROM folders WHERE path_key = ?', key);
  if (existing) return { id: existing.id, created: false };
  const r = run(db, 'INSERT INTO folders(path, path_key, added_at) VALUES (?, ?, ?)', folderPath, key, Date.now());
  return { id: Number(r.lastInsertRowid), created: true };
}

export function getFolder(db, id) {
  return get(db, 'SELECT id, path, path_key AS pathKey, available FROM folders WHERE id = ?', id) ?? null;
}

/** Removes a folder from the library. Tracks are removed from the index only; files on disk are untouched. */
export function removeFolder(db, id) {
  return transaction(db, () => {
    const removed = run(db, 'DELETE FROM tracks WHERE folder_id = ?', id).changes;
    run(db, 'DELETE FROM folders WHERE id = ?', id);
    pruneOrphans(db);
    return Number(removed);
  });
}

export function setFolderScanned(db, id, available) {
  run(db, 'UPDATE folders SET last_scanned_at = ?, available = ? WHERE id = ?', Date.now(), available ? 1 : 0, id);
}

// ---------- Scanner support ----------

export function getFolderTrackIndex(db, folderId) {
  const map = new Map();
  for (const r of all(db, 'SELECT id, path_key AS pathKey, size, mtime, available FROM tracks WHERE folder_id = ?', folderId)) {
    map.set(r.pathKey, r);
  }
  return map;
}

export function findTrackByPathKey(db, key) {
  return get(db, 'SELECT id, folder_id AS folderId, size, mtime, available FROM tracks WHERE path_key = ?', key) ?? null;
}

export function findMovedCandidate(db, fingerprint) {
  if (!fingerprint) return null;
  return get(db, 'SELECT id FROM tracks WHERE fingerprint = ? AND available = 0 LIMIT 1', fingerprint) ?? null;
}

export function getOrCreateArtist(db, name) {
  const key = nameKey(name);
  const row = get(db, 'SELECT id FROM artists WHERE name_key = ?', key);
  if (row) return row.id;
  return Number(run(db, 'INSERT INTO artists(name, name_key) VALUES (?, ?)', name, key).lastInsertRowid);
}

export function getOrCreateAlbum(db, { title, albumArtist, year, artworkId }) {
  const key = albumKey(albumArtist, title);
  const row = get(db, 'SELECT id, year, artwork_id AS artworkId FROM albums WHERE album_key = ?', key);
  if (row) {
    if ((!row.year && year) || (!row.artworkId && artworkId)) {
      run(
        db,
        'UPDATE albums SET year = COALESCE(year, ?), artwork_id = COALESCE(artwork_id, ?) WHERE id = ?',
        year ?? null,
        artworkId ?? null,
        row.id,
      );
    }
    return row.id;
  }
  const artistId = getOrCreateArtist(db, albumArtist);
  return Number(
    run(
      db,
      'INSERT INTO albums(title, album_key, artist_id, artist_name, year, artwork_id) VALUES (?, ?, ?, ?, ?, ?)',
      title,
      key,
      artistId,
      albumArtist,
      year ?? null,
      artworkId ?? null,
    ).lastInsertRowid,
  );
}

export function getOrCreateArtwork(db, { hash, file, thumbFile, width, height, palette }) {
  const row = get(db, 'SELECT id FROM artwork WHERE hash = ?', hash);
  if (row) return row.id;
  return Number(
    run(
      db,
      'INSERT INTO artwork(hash, file, thumb_file, width, height, palette) VALUES (?, ?, ?, ?, ?, ?)',
      hash,
      file,
      thumbFile,
      width ?? null,
      height ?? null,
      palette ? JSON.stringify(palette) : null,
    ).lastInsertRowid,
  );
}

export function hasArtworkHash(db, hash) {
  return get(db, 'SELECT id FROM artwork WHERE hash = ?', hash)?.id ?? null;
}

export function getArtworkFile(db, hash, kind) {
  const r = get(db, 'SELECT file, thumb_file AS thumbFile FROM artwork WHERE hash = ?', hash);
  if (!r) return null;
  return kind === 'thumb' ? r.thumbFile : r.file;
}

/** Inserts or updates a track from a normalized metadata record. Returns the track id. */
export function upsertTrack(db, rec) {
  return transaction(db, () => {
    const artistId = getOrCreateArtist(db, rec.artistName);
    const albumId = getOrCreateAlbum(db, {
      title: rec.albumTitle,
      albumArtist: rec.albumArtist,
      year: rec.year,
      artworkId: rec.artworkId,
    });
    const now = Date.now();
    const params = {
      $folder_id: rec.folderId ?? null,
      $path: rec.path,
      $path_key: rec.pathKey,
      $file_name: rec.fileName,
      $size: rec.size ?? 0,
      $mtime: rec.mtime ?? 0,
      $fingerprint: rec.fingerprint ?? null,
      $title: rec.title,
      $artist_name: rec.artistName,
      $album_title: rec.albumTitle,
      $album_artist: rec.albumArtist,
      $artist_id: artistId,
      $album_id: albumId,
      $track_no: rec.trackNo ?? null,
      $track_total: rec.trackTotal ?? null,
      $disc_no: rec.discNo ?? null,
      $disc_total: rec.discTotal ?? null,
      $year: rec.year ?? null,
      $genre: rec.genre ?? null,
      $duration: rec.duration ?? null,
      $bitrate: rec.bitrate ?? null,
      $sample_rate: rec.sampleRate ?? null,
      $codec: rec.codec ?? null,
      $container: rec.container ?? null,
      $lossless: rec.lossless ? 1 : 0,
      $has_lyrics: rec.hasLyrics ? 1 : 0,
      $artwork_id: rec.artworkId ?? null,
      $unsupported_reason: rec.unsupportedReason ?? null,
      $now: now,
    };
    const existingId =
      rec.existingId ?? get(db, 'SELECT id FROM tracks WHERE path_key = ?', rec.pathKey)?.id ?? null;
    if (existingId) {
      run(
        db,
        `UPDATE tracks SET folder_id=$folder_id, path=$path, path_key=$path_key, file_name=$file_name, size=$size,
          mtime=$mtime, fingerprint=$fingerprint, title=$title, artist_name=$artist_name, album_title=$album_title,
          album_artist=$album_artist, artist_id=$artist_id, album_id=$album_id, track_no=$track_no,
          track_total=$track_total, disc_no=$disc_no, disc_total=$disc_total, year=$year, genre=$genre,
          duration=$duration, bitrate=$bitrate, sample_rate=$sample_rate, codec=$codec, container=$container,
          lossless=$lossless, has_lyrics=$has_lyrics, artwork_id=$artwork_id, available=1,
          unsupported_reason=$unsupported_reason, updated_at=$now
         WHERE id = $id`,
        { ...params, $id: existingId },
      );
      return existingId;
    }
    return Number(
      run(
        db,
        `INSERT INTO tracks(uid, folder_id, path, path_key, file_name, size, mtime, fingerprint, title, artist_name,
          album_title, album_artist, artist_id, album_id, track_no, track_total, disc_no, disc_total, year, genre,
          duration, bitrate, sample_rate, codec, container, lossless, has_lyrics, artwork_id, available,
          unsupported_reason, date_added, updated_at)
         VALUES ($uid, $folder_id, $path, $path_key, $file_name, $size, $mtime, $fingerprint, $title, $artist_name,
          $album_title, $album_artist, $artist_id, $album_id, $track_no, $track_total, $disc_no, $disc_total, $year,
          $genre, $duration, $bitrate, $sample_rate, $codec, $container, $lossless, $has_lyrics, $artwork_id, 1,
          $unsupported_reason, $now, $now)`,
        { ...params, $uid: randomUUID() },
      ).lastInsertRowid,
    );
  });
}

export function setTracksAvailability(db, ids, available) {
  if (!ids.length) return 0;
  return transaction(db, () => {
    let n = 0;
    for (const id of ids) n += Number(run(db, 'UPDATE tracks SET available = ? WHERE id = ?', available ? 1 : 0, id).changes);
    return n;
  });
}

export function setFolderTracksAvailability(db, folderId, available) {
  return Number(run(db, 'UPDATE tracks SET available = ? WHERE folder_id = ?', available ? 1 : 0, folderId).changes);
}

/** Marks a file, or every track under a directory, unavailable. Returns rows changed. */
export function markUnavailableUnderPath(db, key) {
  const prefix = key.replace(/[\\%_]/g, (c) => '\\' + c);
  return Number(
    run(
      db,
      `UPDATE tracks SET available = 0
       WHERE available = 1 AND (path_key = ? OR path_key LIKE ? ESCAPE '\\' OR path_key LIKE ? ESCAPE '\\')`,
      key,
      prefix + '\\\\%',
      prefix + '/%',
    ).changes,
  );
}

/** Removes albums and artists that no longer have any tracks. */
export function pruneOrphans(db) {
  run(db, 'DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)');
  run(
    db,
    `DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)
       AND id NOT IN (SELECT DISTINCT artist_id FROM albums WHERE artist_id IS NOT NULL)`,
  );
}

/** Permanently removes unavailable tracks from the index (never touches files on disk). */
export function removeUnavailableTracks(db) {
  return transaction(db, () => {
    const n = Number(run(db, 'DELETE FROM tracks WHERE available = 0').changes);
    pruneOrphans(db);
    return n;
  });
}

export function getTrackPath(db, id) {
  return (
    get(
      db,
      'SELECT path, uid, size, mtime, codec, available, unsupported_reason AS unsupportedReason FROM tracks WHERE id = ?',
      id,
    ) ?? null
  );
}

export function getUnusedArtwork(db) {
  return all(
    db,
    `SELECT id, file, thumb_file AS thumbFile FROM artwork
     WHERE id NOT IN (SELECT artwork_id FROM tracks WHERE artwork_id IS NOT NULL)
       AND id NOT IN (SELECT artwork_id FROM albums WHERE artwork_id IS NOT NULL)`,
  );
}

export function deleteArtworkRows(db, ids) {
  transaction(db, () => {
    for (const id of ids) run(db, 'DELETE FROM artwork WHERE id = ?', id);
  });
}

// ---------- Track queries ----------

export function listTracks(db, { search = '', sort = 'title', dir = 'asc', includeUnavailable = true } = {}) {
  const order = `${TRACK_SORTS[sort] ?? TRACK_SORTS.title} ${dir === 'desc' ? 'DESC' : 'ASC'}, ${TRACK_TIEBREAK}`;
  const avail = includeUnavailable ? '' : 'AND t.available = 1';
  const fts = buildFtsQuery(search);
  if (fts) {
    return mapTracks(
      all(
        db,
        `SELECT ${TRACK_COLUMNS} ${TRACK_FROM}
         WHERE t.id IN (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?) ${avail}
         ORDER BY ${order}`,
        fts,
      ),
    );
  }
  return mapTracks(all(db, `SELECT ${TRACK_COLUMNS} ${TRACK_FROM} WHERE 1=1 ${avail} ORDER BY ${order}`));
}

export function getTracksByIds(db, ids) {
  if (!ids.length) return [];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(`SELECT ${TRACK_COLUMNS} ${TRACK_FROM} WHERE t.id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk);
    for (const r of rows) out.set(r.id, mapTrack(r));
  }
  return ids.map((id) => out.get(id)).filter(Boolean);
}

export function getTrackCount(db) {
  return get(db, 'SELECT COUNT(*) AS n FROM tracks').n;
}

export function getStats(db) {
  const t = get(
    db,
    'SELECT COUNT(*) AS tracks, COALESCE(SUM(duration), 0) AS duration, SUM(available = 0) AS unavailable FROM tracks',
  );
  const albums = get(db, 'SELECT COUNT(*) AS n FROM albums').n;
  const artists = get(db, 'SELECT COUNT(DISTINCT artist_id) AS n FROM tracks').n;
  const folders = get(db, 'SELECT COUNT(*) AS n FROM folders').n;
  const playlists = get(db, 'SELECT COUNT(*) AS n FROM playlists').n;
  return {
    tracks: t.tracks,
    duration: t.duration,
    unavailable: t.unavailable ?? 0,
    albums,
    artists,
    folders,
    playlists,
  };
}

// ---------- Albums ----------

function likePattern(s) {
  return `%${String(s).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

const ALBUM_SORTS = {
  title: 'al.title COLLATE NOCASE ASC',
  artist: 'al.artist_name COLLATE NOCASE ASC, al.title COLLATE NOCASE ASC',
  year: 'al.year DESC NULLS LAST, al.title COLLATE NOCASE ASC',
  dateAdded: 'dateAdded DESC',
};

const ALBUM_SELECT = `
  SELECT al.id, al.title, al.artist_name AS artist, al.artist_id AS artistId, al.year,
    a.hash AS artHash, a.palette AS palette, COUNT(t.id) AS trackCount,
    COALESCE(SUM(t.duration), 0) AS duration, MAX(t.date_added) AS dateAdded,
    MAX(COALESCE(t.disc_no, 1)) AS discCount
  FROM albums al
  JOIN tracks t ON t.album_id = al.id
  LEFT JOIN artwork a ON a.id = al.artwork_id`;

const mapAlbum = (r) => (r ? { ...r, palette: parsePalette(r.palette) } : null);

export function listAlbums(db, { search = '', sort = 'title' } = {}) {
  const order = ALBUM_SORTS[sort] ?? ALBUM_SORTS.title;
  if (search.trim()) {
    const p = likePattern(search.trim());
    return all(
      db,
      `${ALBUM_SELECT} WHERE al.title LIKE ? ESCAPE '\\' OR al.artist_name LIKE ? ESCAPE '\\'
       GROUP BY al.id ORDER BY ${order}`,
      p,
      p,
    ).map(mapAlbum);
  }
  return all(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY ${order}`).map(mapAlbum);
}

export function getAlbum(db, id) {
  const album = mapAlbum(get(db, `${ALBUM_SELECT} WHERE al.id = ? GROUP BY al.id`, id));
  if (!album) return null;
  album.tracks = mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS} ${TRACK_FROM} WHERE t.album_id = ?
       ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), t.title COLLATE NOCASE`,
      id,
    ),
  );
  return album;
}

// ---------- Artists ----------

export function listArtists(db, { search = '' } = {}) {
  const where = search.trim() ? `WHERE ar.name LIKE ? ESCAPE '\\'` : '';
  const params = search.trim() ? [likePattern(search.trim())] : [];
  return all(
    db,
    `SELECT ar.id, ar.name,
       (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id) AS trackCount,
       (SELECT COUNT(*) FROM albums al WHERE al.artist_id = ar.id) AS albumCount,
       (SELECT a.hash FROM albums al JOIN artwork a ON a.id = al.artwork_id
          WHERE al.artist_id = ar.id ORDER BY al.year DESC LIMIT 1) AS artHash,
       (SELECT a.hash FROM tracks t JOIN artwork a ON a.id = t.artwork_id
          WHERE t.artist_id = ar.id LIMIT 1) AS trackArtHash
     FROM artists ar ${where}
     ORDER BY ar.name COLLATE NOCASE`,
    ...params,
  )
    .filter((a) => a.trackCount > 0 || a.albumCount > 0)
    .map(({ trackArtHash, ...a }) => ({ ...a, artHash: a.artHash ?? trackArtHash }));
}

export function getArtist(db, id) {
  const artist = get(db, 'SELECT id, name FROM artists WHERE id = ?', id);
  if (!artist) return null;
  const albums = all(
    db,
    `${ALBUM_SELECT}
     WHERE al.artist_id = ? OR al.id IN (SELECT album_id FROM tracks WHERE artist_id = ?)
     GROUP BY al.id ORDER BY al.year DESC NULLS LAST, al.title COLLATE NOCASE`,
    id,
    id,
  ).map(mapAlbum);
  const tracks = mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS} ${TRACK_FROM}
       WHERE t.artist_id = ? OR t.album_id IN (SELECT id FROM albums WHERE artist_id = ?)
       ORDER BY t.album_title COLLATE NOCASE, COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999)`,
      id,
      id,
    ),
  );
  const stats = get(
    db,
    `SELECT COUNT(h.id) AS plays, COALESCE(SUM(h.listened), 0) AS listened, MAX(h.played_at) AS lastPlayed
     FROM play_history h JOIN tracks t ON t.id = h.track_id WHERE t.artist_id = ?`,
    id,
  );
  const topTracks = mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS}, COUNT(h.id) AS plays ${TRACK_FROM}
       JOIN play_history h ON h.track_id = t.id
       WHERE t.artist_id = ? GROUP BY t.id ORDER BY plays DESC LIMIT 5`,
      id,
    ),
  );
  return { ...artist, albums, tracks, stats, topTracks };
}

// ---------- Favorites ----------

export function setFavorites(db, trackIds, value) {
  transaction(db, () => {
    const now = Date.now();
    for (const id of trackIds) {
      if (value) run(db, 'INSERT OR IGNORE INTO favorites(track_id, added_at) VALUES (?, ?)', id, now);
      else run(db, 'DELETE FROM favorites WHERE track_id = ?', id);
    }
  });
}

export function listFavorites(db, limit = -1) {
  return mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS} ${TRACK_FROM} WHERE fav.track_id IS NOT NULL ORDER BY fav.added_at DESC LIMIT ?`,
      limit,
    ),
  );
}

// ---------- Playlists ----------

export function listPlaylists(db) {
  const rows = all(
    db,
    `SELECT p.id, p.name, p.created_at AS createdAt, p.updated_at AS updatedAt,
       COUNT(pt.id) AS trackCount, COALESCE(SUM(t.duration), 0) AS duration
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     LEFT JOIN tracks t ON t.id = pt.track_id
     GROUP BY p.id ORDER BY p.name COLLATE NOCASE`,
  );
  for (const r of rows) {
    r.artHashes = all(
      db,
      `SELECT DISTINCT a.hash FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       JOIN artwork a ON a.id = t.artwork_id WHERE pt.playlist_id = ? ORDER BY pt.position LIMIT 4`,
      r.id,
    ).map((x) => x.hash);
  }
  return rows;
}

export function getPlaylist(db, id) {
  const p = get(db, 'SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM playlists WHERE id = ?', id);
  if (!p) return null;
  p.tracks = all(
    db,
    `SELECT ${TRACK_COLUMNS}, pt.id AS entryId ${TRACK_FROM}
     JOIN playlist_tracks pt ON pt.track_id = t.id
     WHERE pt.playlist_id = ? ORDER BY pt.position`,
    id,
  ).map(mapTrack);
  return p;
}

export function createPlaylist(db, name, trackIds = []) {
  return transaction(db, () => {
    const now = Date.now();
    const id = Number(run(db, 'INSERT INTO playlists(name, created_at, updated_at) VALUES (?, ?, ?)', name, now, now).lastInsertRowid);
    addToPlaylist(db, id, trackIds);
    return id;
  });
}

export function renamePlaylist(db, id, name) {
  return Number(run(db, 'UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', name, Date.now(), id).changes) > 0;
}

export function deletePlaylist(db, id) {
  return Number(run(db, 'DELETE FROM playlists WHERE id = ?', id).changes) > 0;
}

export function addToPlaylist(db, id, trackIds) {
  return transaction(db, () => {
    if (!get(db, 'SELECT id FROM playlists WHERE id = ?', id)) throw new Error('Playlist not found');
    let pos = get(db, 'SELECT COALESCE(MAX(position), -1) AS p FROM playlist_tracks WHERE playlist_id = ?', id).p;
    const now = Date.now();
    let added = 0;
    for (const tid of trackIds) {
      if (!get(db, 'SELECT id FROM tracks WHERE id = ?', tid)) continue;
      run(db, 'INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)', id, tid, ++pos, now);
      added++;
    }
    run(db, 'UPDATE playlists SET updated_at = ? WHERE id = ?', now, id);
    return added;
  });
}

function renumber(db, id) {
  const entries = all(db, 'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position', id);
  entries.forEach((e, i) => run(db, 'UPDATE playlist_tracks SET position = ? WHERE id = ?', i, e.id));
}

export function removeFromPlaylist(db, id, entryIds) {
  return transaction(db, () => {
    let n = 0;
    for (const eid of entryIds) {
      n += Number(run(db, 'DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?', eid, id).changes);
    }
    renumber(db, id);
    run(db, 'UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), id);
    return n;
  });
}

/** Applies a complete new ordering. entryIds must be exactly the playlist's current entries. */
export function reorderPlaylist(db, id, entryIds) {
  return transaction(db, () => {
    const current = all(db, 'SELECT id FROM playlist_tracks WHERE playlist_id = ?', id).map((r) => r.id);
    const want = new Set(entryIds);
    if (current.length !== entryIds.length || want.size !== entryIds.length || !current.every((e) => want.has(e))) {
      throw new Error('Reorder does not match the playlist contents');
    }
    entryIds.forEach((eid, i) => run(db, 'UPDATE playlist_tracks SET position = ? WHERE id = ?', i, eid));
    run(db, 'UPDATE playlists SET updated_at = ? WHERE id = ?', Date.now(), id);
    return true;
  });
}

// ---------- History & smart collections ----------

export function recordPlay(db, trackId, listened) {
  if (!get(db, 'SELECT id FROM tracks WHERE id = ?', trackId)) return false;
  run(db, 'INSERT INTO play_history(track_id, played_at, listened) VALUES (?, ?, ?)', trackId, Date.now(), listened);
  return true;
}

export function recentlyPlayed(db, limit = 50) {
  return mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS}, h.last AS lastPlayed ${TRACK_FROM}
       JOIN (SELECT track_id, MAX(played_at) AS last FROM play_history GROUP BY track_id) h ON h.track_id = t.id
       ORDER BY h.last DESC LIMIT ?`,
      limit,
    ),
  );
}

export function recentlyAdded(db, limit = 50) {
  return mapTracks(all(db, `SELECT ${TRACK_COLUMNS} ${TRACK_FROM} ORDER BY t.date_added DESC, t.id DESC LIMIT ?`, limit));
}

export function mostPlayed(db, limit = 50) {
  return mapTracks(
    all(
      db,
      `SELECT ${TRACK_COLUMNS}, h.plays ${TRACK_FROM}
       JOIN (SELECT track_id, COUNT(*) AS plays FROM play_history GROUP BY track_id) h ON h.track_id = t.id
       ORDER BY h.plays DESC, t.title COLLATE NOCASE LIMIT ?`,
      limit,
    ),
  );
}

export function recentAlbums(db, limit = 12) {
  return all(
    db,
    `${ALBUM_SELECT}
     JOIN (SELECT t2.album_id AS aid, MAX(h.played_at) AS last FROM play_history h
           JOIN tracks t2 ON t2.id = h.track_id GROUP BY t2.album_id) r ON r.aid = al.id
     GROUP BY al.id ORDER BY r.last DESC LIMIT ?`,
    limit,
  ).map(mapAlbum);
}

export function recentlyAddedAlbums(db, limit = 12) {
  return all(db, `${ALBUM_SELECT} GROUP BY al.id ORDER BY dateAdded DESC LIMIT ?`, limit).map(mapAlbum);
}

export const SMART_COLLECTIONS = {
  favorites: { name: 'Favorites', get: (db) => listFavorites(db) },
  recentlyPlayed: { name: 'Recently Played', get: (db) => recentlyPlayed(db, 100) },
  recentlyAdded: { name: 'Recently Added', get: (db) => recentlyAdded(db, 100) },
  mostPlayed: { name: 'Most Played', get: (db) => mostPlayed(db, 100) },
};

export function getHome(db) {
  return {
    stats: getStats(db),
    recentlyPlayed: recentlyPlayed(db, 12),
    recentlyAdded: recentlyAdded(db, 12),
    recentAlbums: recentAlbums(db, 10),
    newAlbums: recentlyAddedAlbums(db, 10),
    favorites: listFavorites(db, 12),
    mostPlayed: mostPlayed(db, 8),
  };
}

/** Combined search used by the global search view. */
export function searchAll(db, query) {
  const q = String(query ?? '').trim();
  if (!q) return { tracks: [], albums: [], artists: [] };
  return {
    tracks: listTracks(db, { search: q, sort: 'title' }).slice(0, 200),
    albums: listAlbums(db, { search: q }).slice(0, 24),
    artists: listArtists(db, { search: q }).slice(0, 24),
  };
}

// ---------- Settings ----------

export function getSettings(db) {
  const out = {};
  for (const r of all(db, 'SELECT key, value FROM settings')) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt value; defaults apply */
    }
  }
  return out;
}

export function setSetting(db, key, value) {
  run(
    db,
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
