import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathKey, isPathInside } from './normalize.js';
import { LibraryScanner } from './libraryScanner.js';
import { FileWatcher } from './fileWatcher.js';
import * as repo from './libraryRepo.js';
import { transaction } from './database.js';

/**
 * Coordinates folders, scanning and watching. Emits:
 *  - 'progress' (scan progress snapshot)
 *  - 'changed'  (library content changed; UI should refresh)
 */
export class LibraryService extends EventEmitter {
  constructor({ db, artwork, logger = console, watch = true, scannerOptions = {} }) {
    super();
    this.db = db;
    this.logger = logger;
    this.scanner = new LibraryScanner({ db, artwork, logger, ...scannerOptions });
    this.watcher = new FileWatcher({ db, scanner: this.scanner, logger });
    this.watchEnabled = watch;
    this.scanner.on('progress', (p) => this.emit('progress', p));
    this.scanner.on('done', () => this.emit('changed'));
    this.watcher.on('changed', () => this.emit('changed'));
  }

  start() {
    if (this.watchEnabled) this.watcher.sync();
  }

  setWatching(enabled) {
    this.watchEnabled = enabled;
    if (enabled) this.watcher.sync();
    else this.watcher.close();
  }

  /**
   * Adds folders to the library. Folders already covered by an existing folder are skipped;
   * existing folders inside a newly added parent are merged into it (their tracks are kept).
   */
  async addFolders(paths) {
    const added = [];
    const skipped = [];
    for (const raw of paths) {
      const folderPath = path.resolve(raw);
      const stat = await fs.stat(folderPath).catch(() => null);
      if (!stat?.isDirectory()) {
        skipped.push({ path: folderPath, reason: 'Not a folder or not accessible' });
        continue;
      }
      const key = pathKey(folderPath);
      const existing = repo.listFolders(this.db).map((f) => ({ ...f, key: pathKey(f.path) }));
      const parent = existing.find((f) => isPathInside(key, f.key));
      if (parent) {
        skipped.push({
          path: folderPath,
          reason: parent.key === key ? 'Already in your library' : `Already included via ${parent.path}`,
        });
        continue;
      }
      const children = existing.filter((f) => isPathInside(f.key, key));
      const id = transaction(this.db, () => {
        const res = repo.addFolder(this.db, folderPath, key);
        for (const child of children) {
          // Re-home the child's tracks before removing the child folder row, so nothing is lost.
          this.db.prepare('UPDATE tracks SET folder_id = ? WHERE folder_id = ?').run(res.id, child.id);
          this.db.prepare('DELETE FROM folders WHERE id = ?').run(child.id);
        }
        return res.id;
      });
      added.push({ id, path: folderPath, merged: children.map((c) => c.path) });
    }
    if (added.length) {
      if (this.watchEnabled) this.watcher.sync();
      this.emit('changed');
      this.scanner.scan({ folderIds: added.map((a) => a.id) }).catch((err) => this.logger.error?.(err));
    }
    return { added, skipped };
  }

  /** Removes a folder from the library index. Never deletes files from disk. */
  removeFolder(id) {
    if (!repo.getFolder(this.db, id)) throw new Error('Folder not found');
    this.watcher.unwatch(id);
    const removedTracks = repo.removeFolder(this.db, id);
    this.emit('changed');
    return { removedTracks };
  }

  rescan({ full = false } = {}) {
    if (this.watchEnabled) this.watcher.sync();
    return this.scanner.scan({ full });
  }

  cancelScan() {
    this.scanner.cancel();
  }

  status() {
    return { scanning: this.scanner.isScanning, progress: this.scanner.progress, errors: this.scanner.lastErrors };
  }

  close() {
    this.scanner.cancel();
    this.watcher.close();
  }
}
