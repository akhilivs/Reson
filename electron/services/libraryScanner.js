import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupportedAudioFile, pathKey } from './normalize.js';
import { readTrackMetadata, fingerprintFile } from './metadataService.js';
import * as repo from './libraryRepo.js';

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git']);
const CONCURRENCY = 4;

class ScanCancelled extends Error {}

/**
 * Indexes audio files from user-selected folders into the database.
 * - Never modifies, moves or deletes music files.
 * - Missing files are marked unavailable (playlists/history are preserved).
 * - Per-file errors are collected; they never abort the scan.
 * Emits 'progress' and 'done' events.
 */
export class LibraryScanner extends EventEmitter {
  constructor({ db, artwork, readMetadata = readTrackMetadata, fingerprint = fingerprintFile, logger = console }) {
    super();
    this.db = db;
    this.artwork = artwork;
    this.readMetadata = readMetadata;
    this.fingerprint = fingerprint;
    this.logger = logger;
    this.running = null;
    this.cancelRequested = false;
    this.lastErrors = [];
    this.progress = { phase: 'idle' };
  }

  get isScanning() {
    return !!this.running;
  }

  cancel() {
    if (this.running) this.cancelRequested = true;
  }

  /** Scans the given folder ids (or all folders). Concurrent requests share/queue behind the running scan. */
  scan({ folderIds = null, full = false } = {}) {
    const start = () => {
      this.running = this.#run(folderIds, full).finally(() => {
        this.running = null;
      });
      return this.running;
    };
    if (this.running) return this.running.then(start, start);
    return start();
  }

  #emitProgress(patch, force = false) {
    Object.assign(this.progress, patch);
    const now = Date.now();
    if (force || !this.lastEmit || now - this.lastEmit > 120) {
      this.lastEmit = now;
      this.emit('progress', { ...this.progress });
    }
  }

  #checkCancel() {
    if (this.cancelRequested) throw new ScanCancelled('Scan cancelled');
  }

  async #run(folderIds, full) {
    this.cancelRequested = false;
    this.artwork?.resetFolderCache?.();
    const errors = [];
    const folders = repo.listFolders(this.db).filter((f) => !folderIds || folderIds.includes(f.id));
    const summary = { added: 0, updated: 0, unchanged: 0, missing: 0, restored: 0, moved: 0, errors: 0, cancelled: false };
    this.progress = { phase: 'enumerating', processed: 0, total: 0, current: '', folders: folders.length };
    this.#emitProgress({}, true);

    try {
      // Phase 1: enumerate.
      const work = [];
      for (const folder of folders) {
        this.#checkCancel();
        const reachable = await fs
          .stat(folder.path)
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (!reachable) {
          // Drive unplugged or folder removed: keep records, mark them unavailable.
          summary.missing += repo.setFolderTracksAvailability(this.db, folder.id, false);
          repo.setFolderScanned(this.db, folder.id, false);
          errors.push({ file: folder.path, reason: 'Folder is not reachable (drive disconnected or folder moved)' });
          continue;
        }
        const files = [];
        await this.#walk(folder.path, files, errors, new Set());
        work.push({ folder, files });
        this.#emitProgress({ total: this.progress.total + files.length });
      }

      // Phase 2: index.
      this.#emitProgress({ phase: 'indexing' }, true);
      for (const { folder, files } of work) {
        const index = repo.getFolderTrackIndex(this.db, folder.id);
        const seen = new Set(files.map((f) => pathKey(f)));
        // Mark missing files first, so a file that moved within the library is recognised
        // (by fingerprint) as the same track when its new path is indexed below.
        const missingIds = [...index.values()].filter((t) => !seen.has(t.pathKey) && t.available).map((t) => t.id);
        summary.missing += repo.setTracksAvailability(this.db, missingIds, false);
        for (const t of index.values()) if (missingIds.includes(t.id)) t.available = 0;

        let cursor = 0;
        const worker = async () => {
          while (cursor < files.length) {
            this.#checkCancel();
            const file = files[cursor++];
            const key = pathKey(file);
            try {
              const result = await this.indexFile(file, folder.id, { full, existing: index.get(key) });
              summary[result]++;
            } catch (err) {
              summary.errors++;
              errors.push({ file, reason: describeError(err) });
            }
            this.#emitProgress({ processed: this.progress.processed + 1, current: path.basename(file) });
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        if (summary.moved) summary.missing = Math.max(0, summary.missing - summary.moved);
        repo.setFolderScanned(this.db, folder.id, true);
      }
      repo.pruneOrphans(this.db);
    } catch (err) {
      if (err instanceof ScanCancelled) summary.cancelled = true;
      else {
        this.logger.error?.('Library scan failed:', err);
        errors.push({ file: '', reason: describeError(err) });
        summary.errors++;
        summary.failed = true;
      }
    }

    this.lastErrors = errors.slice(0, 500);
    summary.errors = errors.length;
    this.progress = { phase: 'done', processed: this.progress.processed, total: this.progress.total, summary };
    this.#emitProgress({}, true);
    this.emit('done', summary);
    return summary;
  }

  async #walk(dir, out, errors, visited) {
    let real;
    try {
      real = await fs.realpath(dir);
    } catch (err) {
      errors.push({ file: dir, reason: describeError(err) });
      return;
    }
    const realKey = pathKey(real);
    if (visited.has(realKey)) return; // symlink/junction loop guard
    visited.add(realKey);
    let handle;
    try {
      handle = await fs.opendir(dir);
    } catch (err) {
      errors.push({ file: dir, reason: describeError(err) });
      return;
    }
    const subdirs = [];
    try {
      for await (const entry of handle) {
        if (this.cancelRequested) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          if (entry.isSymbolicLink()) {
            const st = await fs.stat(full).catch(() => null);
            if (st?.isDirectory()) subdirs.push(full);
            else if (st?.isFile() && isSupportedAudioFile(full)) out.push(full);
            continue;
          }
          subdirs.push(full);
        } else if (entry.isFile() && isSupportedAudioFile(entry.name)) {
          out.push(full);
        }
      }
    } catch (err) {
      errors.push({ file: dir, reason: describeError(err) });
    }
    for (const sub of subdirs) {
      this.#checkCancel();
      await this.#walk(sub, out, errors, visited);
    }
  }

  /**
   * Indexes one file. Returns 'added' | 'updated' | 'unchanged' | 'restored' | 'moved'.
   * Also used by the file watcher for incremental updates.
   */
  async indexFile(file, folderId, { full = false, existing } = {}) {
    const key = pathKey(file);
    existing ??= repo.findTrackByPathKey(this.db, key);
    const stat = await fs.stat(file);
    const mtime = Math.floor(stat.mtimeMs);
    if (existing && !full && existing.size === stat.size && existing.mtime === mtime) {
      if (!existing.available) {
        repo.setTracksAvailability(this.db, [existing.id], true);
        return 'restored';
      }
      return 'unchanged';
    }

    const fingerprint = await this.fingerprint(file, stat.size);
    let existingId = existing?.id ?? null;
    let outcome = existing ? 'updated' : 'added';
    if (!existingId) {
      const moved = repo.findMovedCandidate(this.db, fingerprint);
      if (moved) {
        existingId = moved.id;
        outcome = 'moved';
      }
    }

    const { record, picture } = await this.readMetadata(file);
    let artworkId = null;
    if (this.artwork) {
      artworkId = picture ? await this.artwork.storeImage(picture) : null;
      artworkId ??= await this.artwork.folderArtwork(path.dirname(file));
    }

    repo.upsertTrack(this.db, {
      ...record,
      hasLyrics: !!record.lyrics,
      existingId,
      folderId,
      path: file,
      pathKey: key,
      fileName: path.basename(file),
      size: stat.size,
      mtime,
      fingerprint,
      artworkId,
    });
    return outcome;
  }

  /** Marks a single path unavailable (used by the file watcher). */
  markMissing(file) {
    const t = repo.findTrackByPathKey(this.db, pathKey(file));
    if (t && t.available) repo.setTracksAvailability(this.db, [t.id], false);
    return !!t;
  }
}

function describeError(err) {
  switch (err?.code) {
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied';
    case 'ENOENT':
      return 'File not found';
    case 'EBUSY':
      return 'File is locked by another program';
    case 'ENAMETOOLONG':
      return 'Path is too long';
    default:
      return err?.message ? String(err.message).slice(0, 200) : 'Unknown error';
  }
}
