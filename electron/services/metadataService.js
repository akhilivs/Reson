import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { normalizeMetadata } from './normalize.js';

const FP_CHUNK = 32 * 1024;

/**
 * Reads tags without loading the whole audio file. music-metadata streams the file and,
 * with duration:false, avoids full scans of VBR MP3s lacking a Xing header.
 */
export async function readTrackMetadata(filePath) {
  const meta = await parseFile(filePath, { duration: false, skipCovers: false, skipPostHeaders: true });
  const record = normalizeMetadata(meta, filePath);
  const pictures = meta.common.picture ?? [];
  const picture =
    pictures.find((p) => /front|cover/i.test(p.type ?? '')) ?? pictures.find((p) => p.data?.length) ?? null;
  return { record, picture: picture?.data ?? null };
}

/** Content fingerprint used to recognise moved/renamed files: size + head + tail bytes. */
export async function fingerprintFile(filePath, size) {
  const handle = await fs.open(filePath, 'r');
  try {
    const hash = createHash('sha1');
    hash.update(String(size));
    const head = Buffer.alloc(Math.min(FP_CHUNK, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > FP_CHUNK * 2) {
      const tail = Buffer.alloc(FP_CHUNK);
      await handle.read(tail, 0, FP_CHUNK, size - FP_CHUNK);
      hash.update(tail);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** Parses LRC text into [{ time, text }] sorted by time. Returns null if no timestamps are found. */
export function parseLrc(text) {
  const lines = [];
  const offsetMatch = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(text);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      const time = Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac + offset);
      lines.push({ time, text: content });
    }
  }
  if (!lines.length) return null;
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Finds lyrics for a track: a sidecar .lrc (synced) or .txt next to the file, then embedded tags.
 * Returns { synced: [{time,text}] } | { plain: string } | null.
 */
export async function readLyrics(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  for (const ext of ['.lrc', '.txt']) {
    try {
      const text = await fs.readFile(path.join(dir, base + ext), 'utf8');
      const synced = ext === '.lrc' ? parseLrc(text) : null;
      if (synced) return { synced, source: 'sidecar' };
      if (text.trim()) return { plain: text.trim(), source: 'sidecar' };
    } catch {
      /* no sidecar */
    }
  }
  try {
    const meta = await parseFile(filePath, { duration: false, skipCovers: true });
    const lyr = meta.common.lyrics?.[0];
    if (lyr) {
      if (Array.isArray(lyr.syncText) && lyr.syncText.length && lyr.syncText.some((l) => l.timestamp != null)) {
        return {
          synced: lyr.syncText.map((l) => ({ time: (l.timestamp ?? 0) / 1000, text: l.text })),
          source: 'embedded',
        };
      }
      const text = typeof lyr === 'string' ? lyr : lyr.text;
      if (text?.trim()) {
        const synced = parseLrc(text);
        return synced ? { synced, source: 'embedded' } : { plain: text.trim(), source: 'embedded' };
      }
    }
  } catch {
    /* unreadable file: no lyrics */
  }
  return null;
}
