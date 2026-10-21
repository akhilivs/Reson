import { describe, it, expect } from 'vitest';
import {
  normalizeMetadata,
  titleFromFileName,
  buildFtsQuery,
  pathKey,
  isPathInside,
  albumKey,
  isSupportedAudioFile,
  UNKNOWN_ARTIST,
  UNKNOWN_ALBUM,
} from '../../electron/services/normalize.js';
import { parseLrc } from '../../electron/services/metadataService.js';
import { parseRange } from '../../electron/services/protocols.js';

describe('normalizeMetadata', () => {
  it('maps complete tags', () => {
    const r = normalizeMetadata(
      {
        common: { title: ' Song ', artist: 'Band', albumartist: 'Band', album: 'LP', track: { no: 3, of: 10 }, disk: { no: 2, of: 2 }, year: 2001, genre: ['Rock'] },
        format: { duration: 201.5, codec: 'FLAC', lossless: true, sampleRate: 44100 },
      },
      'C:\\m\\x.flac',
    );
    expect(r).toMatchObject({ title: 'Song', artistName: 'Band', albumTitle: 'LP', trackNo: 3, discNo: 2, discTotal: 2, year: 2001, genre: 'Rock', duration: 201.5, lossless: true, unsupportedReason: null });
  });

  it('falls back when tags are missing', () => {
    const r = normalizeMetadata({ common: {}, format: { duration: 3, codec: 'PCM' } }, 'C:\\m\\07 - my_song.wav');
    expect(r.title).toBe('my song');
    expect(r.artistName).toBe(UNKNOWN_ARTIST);
    expect(r.albumTitle).toBe(UNKNOWN_ALBUM);
    expect(r.trackNo).toBeNull();
  });

  it('uses album artist / artists fallbacks and the date tag for year', () => {
    const r = normalizeMetadata({ common: { artists: ['A', 'B'], date: '1999-05-01' }, format: { codec: 'MP3' } }, 'a.mp3');
    expect(r.artistName).toBe('A, B');
    expect(r.albumArtist).toBe('A, B');
    expect(r.year).toBe(1999);
  });

  it('rejects junk numbers and strips NUL characters', () => {
    const r = normalizeMetadata({ common: { title: 'A\u0000B', track: { no: -1 }, year: 0 }, format: { duration: NaN, codec: 'MP3' } }, 'a.mp3');
    expect(r.title).toBe('AB');
    expect(r.trackNo).toBeNull();
    expect(r.year).toBeNull();
    expect(r.duration).toBeNull();
  });

  it('treats ALAC as playable but flags unreadable files', () => {
    expect(normalizeMetadata({ common: {}, format: { codec: 'ALAC', duration: 1 } }, 'a.m4a').unsupportedReason).toBeNull();
    expect(normalizeMetadata({ common: {}, format: {} }, 'a.mp3').unsupportedReason).toMatch(/corrupt/);
  });

  it('keeps Unicode intact (NFC)', () => {
    const r = normalizeMetadata({ common: { title: 'Cafe\u0301 夜' }, format: { codec: 'MP3' } }, 'a.mp3');
    expect(r.title).toBe('Café 夜');
  });
});

describe('helpers', () => {
  it('derives titles from file names', () => {
    expect(titleFromFileName('03 - Hello.mp3')).toBe('Hello');
    expect(titleFromFileName('1-02 Polar Drift.flac')).toBe('Polar Drift');
    expect(titleFromFileName('2049.mp3')).toBe('2049');
  });

  it('builds safe FTS queries', () => {
    expect(buildFtsQuery('')).toBeNull();
    expect(buildFtsQuery('  ')).toBeNull();
    expect(buildFtsQuery('night bloom')).toBe('"night"* "bloom"*');
    expect(buildFtsQuery('a"b* OR (c)')).toBe('"a"* "b"* "OR"* "c"*');
  });

  it('compares Windows paths case-insensitively', () => {
    expect(pathKey('C:\\Music\\A.mp3', 'win32')).toBe(pathKey('c:/music/a.MP3', 'win32'));
    expect(pathKey('C:\\Music\\', 'win32')).toBe('c:\\music');
  });

  it('detects nested folders without false prefix matches', () => {
    expect(isPathInside('c:\\music\\rock', 'c:\\music')).toBe(true);
    expect(isPathInside('c:\\music', 'c:\\music')).toBe(true);
    expect(isPathInside('c:\\musicals', 'c:\\music')).toBe(false);
  });

  it('groups albums case-insensitively', () => {
    expect(albumKey('The Band', 'Album')).toBe(albumKey(' the  band', 'ALBUM'));
    expect(albumKey('A', 'X')).not.toBe(albumKey('B', 'X'));
  });

  it('recognises supported extensions', () => {
    expect(isSupportedAudioFile('x.FLAC')).toBe(true);
    expect(isSupportedAudioFile('x.txt')).toBe(false);
  });
});

describe('parseLrc', () => {
  it('parses timestamps, multi-stamps and offsets', () => {
    const lines = parseLrc('[ti:x]\n[00:01.50]One\n[00:03.00][00:05.25]Two\n');
    expect(lines).toEqual([
      { time: 1.5, text: 'One' },
      { time: 3, text: 'Two' },
      { time: 5.25, text: 'Two' },
    ]);
    expect(parseLrc('[offset:+500]\n[00:01.00]A')[0].time).toBeCloseTo(1.5);
  });

  it('returns null for plain text', () => {
    expect(parseLrc('just words')).toBeNull();
  });
});

describe('parseRange', () => {
  it('parses byte ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
  });
  it('handles missing and unsatisfiable ranges', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('bytes=2000-', 1000)).toEqual({ unsatisfiable: true });
  });
});
