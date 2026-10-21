import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 ** 3; // 2 GB of converted audio, least-recently-played evicted first

/** Codecs Chromium can't decode, which Reson converts losslessly to FLAC before playback. */
export function needsTranscode(codec) {
  return typeof codec === 'string' && /alac/i.test(codec);
}

/**
 * Resolves the bundled ffmpeg binary. Inside a packaged app it lives in app.asar.unpacked,
 * because executables can't be spawned from within the asar archive.
 */
export async function resolveFfmpegPath() {
  try {
    const mod = await import('ffmpeg-static');
    const p = mod.default ?? mod;
    if (!p) return null;
    const unpacked = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    await fs.access(unpacked);
    return unpacked;
  } catch {
    return null;
  }
}

/**
 * Converts ALAC files to FLAC in a private cache. Lossless: the decoded PCM is identical.
 * Source files are only read, never modified. Concurrent requests for the same track share one job.
 */
export class TranscodeService {
  constructor({ cacheDir, ffmpegPath, maxBytes = DEFAULT_MAX_BYTES, logger = console }) {
    this.cacheDir = cacheDir;
    this.ffmpegPath = ffmpegPath;
    this.maxBytes = maxBytes;
    this.logger = logger;
    this.inflight = new Map();
  }

  get available() {
    return !!this.ffmpegPath;
  }

  cacheKey(track) {
    return createHash('sha1').update(`${track.uid}|${track.size}|${track.mtime}`).digest('hex');
  }

  /** Returns the path of a playable FLAC for the track, converting it first if needed. */
  async ensure(track) {
    if (!this.ffmpegPath) throw new Error('The bundled audio decoder (ffmpeg) is missing');
    const key = this.cacheKey(track);
    const out = path.join(this.cacheDir, `${key}.flac`);
    try {
      await fs.access(out);
      const now = new Date();
      await fs.utimes(out, now, now).catch(() => {}); // mark as recently used for LRU
      return out;
    } catch {
      /* not cached yet */
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.#convert(track.path, out).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async #convert(src, out) {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const tmp = `${out}.${process.pid}.${Date.now()}.part`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src, '-map', '0:a:0', '-vn', '-c:a', 'flac', '-compression_level', '5', '-f', 'flac', tmp];
    try {
      await new Promise((resolve, reject) => {
        // Argument array, no shell: file names can never be interpreted as commands.
        execFile(this.ffmpegPath, args, { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(`Could not convert this file for playback${stderr ? `: ${String(stderr).trim().split('\n').pop()}` : ''}`));
          else resolve();
        });
      });
      await fs.rename(tmp, out);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    this.prune().catch((e) => this.logger.warn?.('Transcode cache prune failed:', e.message));
    return out;
  }

  async usage() {
    let bytes = 0;
    let files = 0;
    for (const f of await fs.readdir(this.cacheDir).catch(() => [])) {
      if (!f.endsWith('.flac')) continue;
      const st = await fs.stat(path.join(this.cacheDir, f)).catch(() => null);
      if (st) {
        bytes += st.size;
        files++;
      }
    }
    return { bytes, files };
  }

  /** Evicts least-recently-used conversions until the cache fits the size limit. */
  async prune() {
    const entries = [];
    for (const f of await fs.readdir(this.cacheDir).catch(() => [])) {
      if (!f.endsWith('.flac')) continue;
      const p = path.join(this.cacheDir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st) entries.push({ p, size: st.size, mtime: st.mtimeMs });
    }
    let total = entries.reduce((s, e) => s + e.size, 0);
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const e of entries) {
      if (total <= this.maxBytes) break;
      await fs.rm(e.p, { force: true });
      total -= e.size;
    }
  }

  async clear() {
    for (const f of await fs.readdir(this.cacheDir).catch(() => [])) {
      if (f.endsWith('.flac') || f.endsWith('.part')) await fs.rm(path.join(this.cacheDir, f), { force: true });
    }
  }
}
