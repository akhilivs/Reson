import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseFile } from 'music-metadata';
import ffmpegPath from 'ffmpeg-static';
import { TranscodeService, needsTranscode } from '../../electron/services/transcodeService.js';
import { migrations, runMigrations } from '../../electron/services/migrations.js';
import { openDatabase } from '../../electron/services/database.js';
import { LibraryService } from '../../electron/services/libraryService.js';
import * as repo from '../../electron/services/libraryRepo.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ALAC_DIR = path.join(ROOT, 'tests', 'fixtures', 'generated', 'alac');
const ALAC_FILE = path.join(ALAC_DIR, '01 Soul King Ballad.m4a');

/** MD5 of the decoded PCM stream: equal hashes mean bit-identical audio. */
const pcmMd5 = (file) =>
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();

beforeAll(() => {
  if (!fs.existsSync(ALAC_FILE)) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-fixtures.mjs')]);
});

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brook-transcode-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const trackFor = (file) => {
  const st = fs.statSync(file);
  return { path: file, uid: 'test-uid', size: st.size, mtime: Math.floor(st.mtimeMs), codec: 'ALAC' };
};

describe('ALAC support', () => {
  it('identifies codecs that need conversion', () => {
    expect(needsTranscode('ALAC')).toBe(true);
    expect(needsTranscode('FLAC')).toBe(false);
    expect(needsTranscode(null)).toBe(false);
  });

  it('converts ALAC to FLAC losslessly (bit-identical PCM)', async () => {
    const t = new TranscodeService({ cacheDir: tmp, ffmpegPath });
    const out = await t.ensure(trackFor(ALAC_FILE));
    expect(out.endsWith('.flac')).toBe(true);
    const meta = await parseFile(out);
    expect(meta.format.codec).toBe('FLAC');
    expect(meta.format.lossless).toBe(true);
    expect(meta.format.duration).toBeCloseTo(8, 0);
    expect(pcmMd5(out)).toBe(pcmMd5(ALAC_FILE));
  });

  it('never modifies the source file', async () => {
    const before = fs.readFileSync(ALAC_FILE);
    await new TranscodeService({ cacheDir: tmp, ffmpegPath }).ensure(trackFor(ALAC_FILE));
    expect(fs.readFileSync(ALAC_FILE).equals(before)).toBe(true);
  });

  it('reuses the cache and shares concurrent conversions', async () => {
    const t = new TranscodeService({ cacheDir: tmp, ffmpegPath });
    const track = trackFor(ALAC_FILE);
    const [a, b] = await Promise.all([t.ensure(track), t.ensure(track)]);
    expect(a).toBe(b);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.flac'))).toHaveLength(1);
    const started = Date.now();
    expect(await t.ensure(track)).toBe(a);
    expect(Date.now() - started).toBeLessThan(200);
    expect((await t.usage()).files).toBe(1);
  });

  it('evicts least-recently-used conversions over the size limit', async () => {
    const t = new TranscodeService({ cacheDir: tmp, ffmpegPath, maxBytes: 1 });
    await t.ensure(trackFor(ALAC_FILE));
    await t.prune();
    expect((await t.usage()).files).toBe(0);
  });

  it('fails clearly without a decoder or with an unreadable file', async () => {
    await expect(new TranscodeService({ cacheDir: tmp, ffmpegPath: null }).ensure(trackFor(ALAC_FILE))).rejects.toThrow(/decoder/);
    const bogus = { ...trackFor(ALAC_FILE), path: path.join(tmp, 'missing.m4a'), uid: 'x' };
    await expect(new TranscodeService({ cacheDir: tmp, ffmpegPath }).ensure(bogus)).rejects.toThrow(/convert/);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('indexes ALAC files as playable', async () => {
    const db = openDatabase(path.join(tmp, 'lib.db'));
    const lib = new LibraryService({ db, artwork: null, watch: false, logger: {} });
    await lib.addFolders([ALAC_DIR]);
    await lib.scanner.running;
    const [t] = repo.listTracks(db);
    expect(t).toMatchObject({ title: 'Soul King Ballad', artist: 'Brook', codec: 'ALAC', unsupportedReason: null, lossless: true });
    lib.close();
    db.close();
  });

  it('migration 2 clears the old "ALAC unsupported" flag on existing libraries', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db, [migrations[0]]);
    db.prepare(
      `INSERT INTO tracks(uid, path, path_key, file_name, title, artist_name, album_title, album_artist, codec, unsupported_reason, date_added, updated_at)
       VALUES ('u', 'a.m4a', 'a.m4a', 'a.m4a', 'A', 'B', 'C', 'B', 'ALAC', 'Apple Lossless (ALAC) is not supported by the playback engine', 0, 0)`,
    ).run();
    runMigrations(db);
    expect(db.prepare('SELECT unsupported_reason AS r FROM tracks').get().r).toBeNull();
    db.close();
  });
});
