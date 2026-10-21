import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getTrackPath, getArtworkFile } from './libraryRepo.js';
import { needsTranscode } from './transcodeService.js';

export const APP_ORIGIN = 'app://vela';

export const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' vela-art: data: blob:",
  "media-src vela-media:",
  "font-src 'self'",
  "connect-src 'self' vela-art:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' vela-art: data: blob:",
  "media-src vela-media:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:* vela-art:",
  "object-src 'none'",
].join('; ');

/** Must be called before app 'ready'. */
export function registerSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'vela-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
    { scheme: 'vela-art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
};

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

/** Parses a single "bytes=start-end" range. Returns null for absent/unsatisfiable ranges. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end };
}

export async function serveFile(filePath, request, contentType) {
  const stat = await fsp.stat(filePath);
  const size = stat.size;
  const range = parseRange(request.headers.get('range'), size);
  const base = { 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (range?.unsatisfiable) {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  if (range) {
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...base,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...base, 'content-length': String(size) },
  });
}

export function registerProtocolHandlers({ protocol, getDb, artworkDir, distDir, isDev, transcoder }) {
  // Audio: vela-media://track/<id>. Only indexed tracks can be streamed — no arbitrary paths.
  protocol.handle('vela-media', async (request) => {
    const url = new URL(request.url);
    const id = Number(url.pathname.replace(/^\//, ''));
    if (url.hostname !== 'track' || !Number.isSafeInteger(id) || id <= 0) return text(400, 'Bad request');
    const row = getTrackPath(getDb(), id);
    if (!row) return text(404, 'Unknown track');
    try {
      if (needsTranscode(row.codec) && transcoder) {
        // Formats Chromium can't decode (ALAC) are converted losslessly to FLAC once, then cached.
        const converted = await transcoder.ensure(row);
        return await serveFile(converted, request, 'audio/flac');
      }
      const ext = path.extname(row.path).toLowerCase();
      return await serveFile(row.path, request, AUDIO_MIME[ext] ?? 'application/octet-stream');
    } catch (err) {
      return text(err.code === 'ENOENT' ? 404 : 500, 'File unavailable');
    }
  });

  // Artwork: vela-art://thumb/<sha1> or vela-art://full/<sha1>.
  protocol.handle('vela-art', async (request) => {
    const url = new URL(request.url);
    const hash = url.pathname.replace(/^\//, '');
    if (!['thumb', 'full'].includes(url.hostname) || !/^[0-9a-f]{40}$/.test(hash)) return text(400, 'Bad request');
    const file = getArtworkFile(getDb(), hash, url.hostname);
    if (!file || !/^[0-9a-f]{40}(_t)?\.jpg$/.test(file)) return text(404, 'Not found');
    try {
      const data = await fsp.readFile(path.join(artworkDir, file));
      return new Response(data, {
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'max-age=31536000, immutable',
          // Only Reson's own pages can reach this scheme; CORS lets them read it as a blob (media session artwork).
          'access-control-allow-origin': '*',
        },
      });
    } catch {
      return text(404, 'Not found');
    }
  });

  // App shell: app://vela/<file> served from the built renderer with a strict CSP.
  if (!isDev) {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'vela') return text(404, 'Not found');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const full = path.resolve(distDir, rel);
      if (!full.startsWith(path.resolve(distDir) + path.sep)) return text(403, 'Forbidden');
      try {
        const data = await fsp.readFile(full);
        const type = STATIC_MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': type, 'content-security-policy': PROD_CSP } });
      } catch {
        return text(404, 'Not found');
      }
    });
  }
}
