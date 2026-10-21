import path from 'node:path';

export const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus']);

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

export function isSupportedAudioFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Case/whitespace/Unicode-insensitive key for grouping names. */
export function nameKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** Stable comparison key for a filesystem path (Windows paths are case-insensitive). */
export function pathKey(p, platform = process.platform) {
  const pathLib = platform === 'win32' ? path.win32 : path.posix;
  let resolved = pathLib.resolve(String(p)).normalize('NFC');
  if (platform === 'win32') resolved = resolved.toLowerCase();
  return resolved.replace(/[\\/]+$/, '') || resolved;
}

/** True when child is inside (or equal to) parent, comparing path keys. */
export function isPathInside(childKey, parentKey) {
  if (childKey === parentKey) return true;
  return childKey.startsWith(parentKey + '\\') || childKey.startsWith(parentKey + '/');
}

function cleanText(value) {
  if (value == null) return null;
  if (Array.isArray(value)) value = value.filter(Boolean).join(', ');
  const s = String(value).replace(/\u0000/g, '').normalize('NFC').trim().replace(/\s+/g, ' ');
  return s.length ? s.slice(0, 500) : null;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.floor(n) : null;
}

/** Derives a readable title from a file name: "03 - My Song.mp3" -> "My Song". */
export function titleFromFileName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const stripped = base.replace(/^\s*(\d{1,3}[\s.\-_]+)+/, '').replace(/_/g, ' ').trim();
  return stripped || base || 'Untitled';
}

function lyricsText(common) {
  const lyr = common?.lyrics;
  if (!lyr || !lyr.length) return null;
  const first = lyr[0];
  if (typeof first === 'string') return first;
  if (first?.text) return first.text;
  if (Array.isArray(first?.syncText) && first.syncText.length) {
    return first.syncText.map((l) => l.text).join('\n');
  }
  return null;
}

const LOSSLESS_CODECS = /flac|alac|pcm|wav|aiff/i;

/**
 * Converts music-metadata output (or a partial object with the same shape) into a
 * normalized Reson track record. Missing tags fall back to sensible values derived
 * from the file name, so incomplete files still index cleanly.
 */
export function normalizeMetadata(meta, filePath) {
  const common = meta?.common ?? {};
  const format = meta?.format ?? {};
  const fileName = path.basename(filePath);

  const title = cleanText(common.title) ?? titleFromFileName(fileName);
  const artist = cleanText(common.artist) ?? cleanText(common.artists) ?? cleanText(common.albumartist) ?? UNKNOWN_ARTIST;
  const albumArtist = cleanText(common.albumartist) ?? artist;
  const album = cleanText(common.album) ?? UNKNOWN_ALBUM;

  let year = positiveInt(common.year);
  if (!year && common.date) year = positiveInt(String(common.date).slice(0, 4));
  if (year && (year < 1000 || year > 3000)) year = null;

  const duration = Number.isFinite(format.duration) && format.duration > 0 ? format.duration : null;
  const codec = cleanText(format.codec);
  const container = cleanText(format.container);
  const lossless = format.lossless === true || (codec ? LOSSLESS_CODECS.test(codec) : false);

  let unsupportedReason = null;
  // ALAC is not flagged: Reson converts it losslessly to FLAC on first play (transcodeService.js).
  if (!codec && !container && !duration) unsupportedReason = 'No readable audio stream (file may be corrupt)';

  return {
    title,
    artistName: artist,
    albumTitle: album,
    albumArtist,
    trackNo: positiveInt(common.track?.no),
    trackTotal: positiveInt(common.track?.of),
    discNo: positiveInt(common.disk?.no),
    discTotal: positiveInt(common.disk?.of),
    year,
    genre: cleanText(common.genre),
    duration,
    bitrate: positiveInt(format.bitrate),
    sampleRate: positiveInt(format.sampleRate),
    codec,
    container,
    lossless,
    lyrics: lyricsText(common),
    unsupportedReason,
  };
}

/** Album grouping key: album artist + album title, case-insensitive. */
export function albumKey(albumArtist, albumTitle) {
  return `${nameKey(albumArtist)}\u0001${nameKey(albumTitle)}`;
}

/**
 * Builds an FTS5 MATCH expression from free-form user input.
 * Every token must match (AND) and is treated as a prefix. Returns null for empty input.
 */
export function buildFtsQuery(input) {
  const tokens = String(input ?? '')
    .normalize('NFKC')
    .replace(/["*^:(){}[\]\-+]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}
