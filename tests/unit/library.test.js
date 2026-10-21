import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, transaction } from '../../electron/services/database.js';
import { runMigrations, currentSchemaVersion } from '../../electron/services/migrations.js';
import { ArtworkService } from '../../electron/services/artworkService.js';
import { LibraryService } from '../../electron/services/libraryService.js';
import * as repo from '../../electron/services/libraryRepo.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'generated', 'library');

// Plain-Node image adapter: stores the original bytes (Electron's nativeImage isn't available here).
const passthroughImages = {
  process: (buf) => ({ width: 300, height: 300, full: buf, thumb: buf, palette: { accent: '#a99aff', isFallback: true } }),
};

beforeAll(() => {
  if (!fs.existsSync(FIXTURES)) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-fixtures.mjs')]);
});

let tmp;
let db;
let lib;
let musicDir;

async function setup() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-test-'));
  musicDir = path.join(tmp, 'Music');
  fs.cpSync(FIXTURES, musicDir, { recursive: true });
  db = openDatabase(path.join(tmp, 'lib.db'));
  const artwork = new ArtworkService({ db, cacheDir: path.join(tmp, 'art'), imageAdapter: passthroughImages, logger: {} });
  await artwork.init();
  lib = new LibraryService({ db, artwork, watch: false, logger: {} });
}

async function addAndScan(dir = musicDir) {
  const res = await lib.addFolders([dir]);
  await lib.scanner.running;
  return res;
}

beforeEach(setup);
afterEach(() => {
  lib.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('migrations', () => {
  it('creates the schema and is idempotent', () => {
    expect(currentSchemaVersion(db)).toBe(2);
    expect(runMigrations(db)).toEqual([]);
  });

  it('rolls back a failing migration and leaves the version unchanged', () => {
    const bad = [{ version: 99, name: 'broken', up: 'CREATE TABLE ok_table(x); THIS IS NOT SQL;' }];
    expect(() => runMigrations(db, bad)).toThrow(/Migration 99/);
    expect(currentSchemaVersion(db)).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ok_table'").get()).toBeUndefined();
  });

  it('applies new migrations to an existing database without data loss', () => {
    repo.createPlaylist(db, 'Keep me');
    runMigrations(db, [{ version: 3, name: 'add column', up: 'ALTER TABLE playlists ADD COLUMN note TEXT' }]);
    expect(currentSchemaVersion(db)).toBe(3);
    expect(repo.listPlaylists(db)[0].name).toBe('Keep me');
  });

  it('nested transactions roll back only the inner savepoint', () => {
    transaction(db, () => {
      repo.createPlaylist(db, 'outer');
      expect(() => transaction(db, () => {
        repo.createPlaylist(db, 'inner');
        throw new Error('boom');
      })).toThrow('boom');
    });
    expect(repo.listPlaylists(db).map((p) => p.name)).toEqual(['outer']);
  });
});

describe('library scanning (real audio fixtures)', () => {
  it('indexes tracks, albums, artists, artwork and multi-disc info', async () => {
    await addAndScan();
    const summary = lib.scanner.progress.summary;
    expect(summary.added).toBe(7);
    expect(summary.errors).toBe(0);

    const tracks = repo.listTracks(db);
    expect(tracks).toHaveLength(7);

    const albums = repo.listAlbums(db);
    const aurora = albums.find((a) => a.title === 'Aurora Lines');
    expect(aurora).toMatchObject({ artist: 'Nova Atlas', year: 2024, trackCount: 3, discCount: 2 });
    expect(aurora.artHash).toMatch(/^[0-9a-f]{40}$/);

    const detail = repo.getAlbum(db, aurora.id);
    expect(detail.tracks.map((t) => [t.discNo, t.trackNo, t.title])).toEqual([
      [1, 1, 'First Light'],
      [1, 2, 'Polar Drift'],
      [2, 1, 'Night Bloom'],
    ]);

    const unicode = tracks.find((t) => t.title.includes('Ünïcode'));
    expect(unicode).toMatchObject({ artist: 'Kiln', album: 'Ember', codec: 'MPEG 1 Layer 3' });
    expect(unicode.duration).toBeGreaterThan(4.5);

    const untagged = tracks.find((t) => t.fileName.endsWith('.wav'));
    expect(untagged).toMatchObject({ title: 'untagged tone', artist: 'Unknown Artist', album: 'Unknown Album' });
    expect(untagged.artHash).toMatch(/^[0-9a-f]{40}$/); // from Loose/cover.png

    const corrupt = tracks.find((t) => t.fileName === 'corrupt.mp3');
    expect(corrupt.unsupportedReason).toMatch(/corrupt/);

    const artists = repo.listArtists(db).map((a) => a.name);
    expect(artists).toEqual(expect.arrayContaining(['Nova Atlas', 'Kiln', 'Unknown Artist']));
    expect(repo.getTrackPath(db, unicode.id).path).toContain('夜');
  });

  it('never modifies the music files', async () => {
    const before = fs.readdirSync(musicDir, { recursive: true }).map(String).sort();
    const sizeOf = (p) => fs.statSync(path.join(musicDir, p)).size;
    const sizes = before.filter((p) => fs.statSync(path.join(musicDir, p)).isFile()).map(sizeOf);
    await addAndScan();
    await lib.rescan({ full: true });
    const after = fs.readdirSync(musicDir, { recursive: true }).map(String).sort();
    expect(after).toEqual(before);
    expect(after.filter((p) => fs.statSync(path.join(musicDir, p)).isFile()).map(sizeOf)).toEqual(sizes);
  });

  it('skips unchanged files on rescan', async () => {
    await addAndScan();
    const summary = await lib.rescan();
    expect(summary).toMatchObject({ added: 0, unchanged: 7, missing: 0 });
  });

  it('searches by title, artist, album and file name (diacritic-insensitive)', async () => {
    await addAndScan();
    expect(repo.listTracks(db, { search: 'bloom' }).map((t) => t.title)).toEqual(['Night Bloom']);
    expect(repo.listTracks(db, { search: 'nova' })).toHaveLength(3);
    expect(repo.listTracks(db, { search: 'ember spa' }).map((t) => t.title)).toEqual(['Spark']);
    expect(repo.listTracks(db, { search: 'cafe' }).map((t) => t.artist)).toEqual(['Kiln']);
    expect(repo.listTracks(db, { search: 'untagged_tone' })).toHaveLength(1);
    expect(repo.listTracks(db, { search: '"); DROP TABLE tracks; --' })).toEqual([]);
    expect(repo.getTrackCount(db)).toBe(7);
    const all = repo.searchAll(db, 'aurora');
    expect(all.albums.map((a) => a.title)).toEqual(['Aurora Lines']);
  });

  it('sorts with whitelisted columns', async () => {
    await addAndScan();
    const byDur = repo.listTracks(db, { sort: 'duration', dir: 'desc' });
    expect(byDur[0].title).toBe('Spark');
  });

  it('marks deleted files unavailable but keeps playlists and history', async () => {
    await addAndScan();
    const spark = repo.listTracks(db, { search: 'spark' })[0];
    const pid = repo.createPlaylist(db, 'Mix', [spark.id]);
    repo.recordPlay(db, spark.id, 30);
    fs.rmSync(path.join(musicDir, 'Kiln - Ember', '01 Spark.mp3'));

    const summary = await lib.rescan();
    expect(summary.missing).toBe(1);
    const after = repo.getTracksByIds(db, [spark.id])[0];
    expect(after.available).toBe(false);
    expect(repo.getPlaylist(db, pid).tracks.map((t) => t.id)).toEqual([spark.id]);
    expect(repo.recentlyPlayed(db).map((t) => t.id)).toEqual([spark.id]);
  });

  it('detects moved files and keeps their identity', async () => {
    await addAndScan();
    const spark = repo.listTracks(db, { search: 'spark' })[0];
    const pid = repo.createPlaylist(db, 'Mix', [spark.id]);
    repo.setFavorites(db, [spark.id], true);
    fs.mkdirSync(path.join(musicDir, 'Moved'));
    fs.renameSync(path.join(musicDir, 'Kiln - Ember', '01 Spark.mp3'), path.join(musicDir, 'Moved', 'renamed.mp3'));

    // A real-world rescan sees the old path gone and a new path appear.
    const summary = await lib.rescan();
    expect(summary).toMatchObject({ moved: 1, missing: 0, added: 0 });
    const now = repo.getTracksByIds(db, [spark.id])[0];
    expect(now.uid).toBe(spark.uid);
    expect(now.fileName).toBe('renamed.mp3');
    expect(now.available).toBe(true);
    expect(now.favorite).toBe(true);
    expect(repo.getPlaylist(db, pid).tracks[0].id).toBe(spark.id);
    expect(repo.getTrackCount(db)).toBe(7);
  });

  it('preserves records when a folder becomes unreachable, and restores them', async () => {
    await addAndScan();
    const renamed = musicDir + '-offline';
    fs.renameSync(musicDir, renamed); // simulates an unplugged drive
    let summary = await lib.rescan();
    expect(summary.missing).toBe(7);
    expect(repo.getTrackCount(db)).toBe(7);
    expect(repo.listFolders(db)[0].available).toBe(false);

    fs.renameSync(renamed, musicDir);
    summary = await lib.rescan();
    expect(summary.restored).toBe(7);
    expect(repo.listTracks(db).every((t) => t.available)).toBe(true);
  });

  it('removing a folder removes index entries only, never files', async () => {
    await addAndScan();
    const folder = repo.listFolders(db)[0];
    const { removedTracks } = lib.removeFolder(folder.id);
    expect(removedTracks).toBe(7);
    expect(repo.getTrackCount(db)).toBe(0);
    expect(repo.listAlbums(db)).toEqual([]);
    expect(fs.existsSync(path.join(musicDir, 'Kiln - Ember', '01 Spark.mp3'))).toBe(true);
  });

  it('handles overlapping folders', async () => {
    const child = path.join(musicDir, 'Kiln - Ember');
    await addAndScan(child);
    expect(repo.getTrackCount(db)).toBe(2);
    const sparkId = repo.listTracks(db, { search: 'spark' })[0].id;

    const parentRes = await addAndScan(musicDir);
    expect(parentRes.added[0].merged).toEqual([child]);
    expect(repo.listFolders(db)).toHaveLength(1);
    expect(repo.getTrackCount(db)).toBe(7);
    expect(repo.listTracks(db, { search: 'spark' })[0].id).toBe(sparkId); // same identity

    const again = await lib.addFolders([child]);
    expect(again.added).toEqual([]);
    expect(again.skipped[0].reason).toMatch(/Already included/);
  });

  it('cleans up unavailable tracks only when asked', async () => {
    await addAndScan();
    fs.rmSync(path.join(musicDir, 'Broken'), { recursive: true });
    await lib.rescan();
    expect(repo.getTrackCount(db)).toBe(7);
    expect(repo.removeUnavailableTracks(db)).toBe(1);
    expect(repo.getTrackCount(db)).toBe(6);
  });
});

describe('playlists, favorites and history', () => {
  beforeEach(async () => {
    await addAndScan();
  });

  it('creates, renames, reorders, removes entries and deletes playlists', () => {
    const ids = repo.listTracks(db).map((t) => t.id).slice(0, 3);
    const pid = repo.createPlaylist(db, 'Road trip', ids);
    expect(repo.renamePlaylist(db, pid, 'Road trip II')).toBe(true);

    let p = repo.getPlaylist(db, pid);
    expect(p.name).toBe('Road trip II');
    const entries = p.tracks.map((t) => t.entryId);
    repo.reorderPlaylist(db, pid, [entries[2], entries[0], entries[1]]);
    p = repo.getPlaylist(db, pid);
    expect(p.tracks.map((t) => t.id)).toEqual([ids[2], ids[0], ids[1]]);

    expect(() => repo.reorderPlaylist(db, pid, [entries[0]])).toThrow(/does not match/);

    repo.removeFromPlaylist(db, pid, [entries[0]]);
    expect(repo.getPlaylist(db, pid).tracks.map((t) => t.id)).toEqual([ids[2], ids[1]]);

    repo.addToPlaylist(db, pid, [ids[2]]); // duplicates are allowed in user playlists
    expect(repo.getPlaylist(db, pid).tracks).toHaveLength(3);

    expect(repo.deletePlaylist(db, pid)).toBe(true);
    expect(repo.getPlaylist(db, pid)).toBeNull();
  });

  it('persists playlists and favorites across database reopen', () => {
    const ids = repo.listTracks(db).map((t) => t.id);
    const pid = repo.createPlaylist(db, 'Persist', ids.slice(0, 2));
    repo.setFavorites(db, [ids[3]], true);
    const file = path.join(tmp, 'lib.db');
    lib.close();
    db.close();

    db = openDatabase(file);
    lib = new LibraryService({ db, artwork: null, watch: false, logger: {} });
    expect(repo.getPlaylist(db, pid).tracks.map((t) => t.id)).toEqual(ids.slice(0, 2));
    expect(repo.listFavorites(db).map((t) => t.id)).toEqual([ids[3]]);
  });

  it('tracks history for smart collections and home', () => {
    const [a, b] = repo.listTracks(db).map((t) => t.id);
    repo.recordPlay(db, a, 40);
    repo.recordPlay(db, b, 40);
    repo.recordPlay(db, a, 40);
    expect(repo.mostPlayed(db)[0].id).toBe(a);
    expect(repo.recordPlay(db, 999999, 10)).toBe(false);
    const home = repo.getHome(db);
    expect(home.stats.tracks).toBe(7);
    expect(home.recentlyPlayed).toHaveLength(2);
    expect(home.recentAlbums.length).toBeGreaterThan(0);
  });

  it('ignores unknown track ids when adding to playlists', () => {
    const pid = repo.createPlaylist(db, 'X');
    expect(repo.addToPlaylist(db, pid, [999999])).toBe(0);
    expect(() => repo.addToPlaylist(db, 424242, [1])).toThrow(/not found/);
  });
});
