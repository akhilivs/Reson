import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractPalette } from './palette.js';
import { getOrCreateArtwork, hasArtworkHash } from './libraryRepo.js';

const FOLDER_ART_NAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
const FOLDER_ART_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FULL = 1000;
const THUMB = 320;

/**
 * Electron-backed image adapter. Kept separate so the scanner can be tested in plain Node
 * with a different adapter.
 */
export function createNativeImageAdapter(nativeImage) {
  return {
    process(buffer) {
      const img = nativeImage.createFromBuffer(buffer);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      const scaleTo = (max) => (width >= height ? { width: Math.min(max, width) } : { height: Math.min(max, height) });
      const full = width > MAX_FULL || height > MAX_FULL ? img.resize({ ...scaleTo(MAX_FULL), quality: 'best' }) : img;
      const thumb = img.resize({ ...scaleTo(THUMB), quality: 'best' });
      const tiny = img.resize({ width: 40, height: 40, quality: 'good' });
      return {
        width,
        height,
        full: full.toJPEG(90),
        thumb: thumb.toJPEG(85),
        // nativeImage bitmaps use Skia's N32 layout, which is BGRA on Windows.
        palette: extractPalette(tiny.toBitmap(), 'bgra'),
      };
    },
  };
}

export class ArtworkService {
  constructor({ db, cacheDir, imageAdapter, logger = console }) {
    this.db = db;
    this.cacheDir = cacheDir;
    this.adapter = imageAdapter;
    this.logger = logger;
    this.folderArtCache = new Map(); // directory -> artwork id | null
  }

  async init() {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  /** Stores image bytes in the cache (deduplicated by content hash). Returns artwork id or null. */
  async storeImage(buffer) {
    if (!buffer || !buffer.length || !this.adapter) return null;
    const hash = createHash('sha1').update(buffer).digest('hex');
    const existing = hasArtworkHash(this.db, hash);
    if (existing) return existing;
    let processed;
    try {
      processed = this.adapter.process(Buffer.from(buffer));
    } catch (err) {
      this.logger.warn?.('Artwork decode failed:', err.message);
      return null;
    }
    if (!processed) return null;
    const file = `${hash}.jpg`;
    const thumbFile = `${hash}_t.jpg`;
    await fs.writeFile(path.join(this.cacheDir, file), processed.full);
    await fs.writeFile(path.join(this.cacheDir, thumbFile), processed.thumb);
    return getOrCreateArtwork(this.db, {
      hash,
      file,
      thumbFile,
      width: processed.width,
      height: processed.height,
      palette: processed.palette,
    });
  }

  /** Looks for cover.jpg / folder.png etc. next to the audio file. */
  async folderArtwork(dir) {
    if (this.folderArtCache.has(dir)) return this.folderArtCache.get(dir);
    let id = null;
    try {
      const entries = await fs.readdir(dir);
      const match = entries.find((name) => {
        const ext = path.extname(name).toLowerCase();
        return FOLDER_ART_EXT.includes(ext) && FOLDER_ART_NAMES.includes(path.basename(name, ext).toLowerCase());
      });
      if (match) {
        const stat = await fs.stat(path.join(dir, match));
        if (stat.size < 20 * 1024 * 1024) id = await this.storeImage(await fs.readFile(path.join(dir, match)));
      }
    } catch {
      id = null;
    }
    this.folderArtCache.set(dir, id);
    return id;
  }

  resetFolderCache() {
    this.folderArtCache.clear();
  }

  resolveFile(fileName) {
    // fileName comes from our own DB rows; still guard against traversal.
    if (!/^[0-9a-f]{40}(_t)?\.jpg$/.test(fileName)) return null;
    return path.join(this.cacheDir, fileName);
  }
}
