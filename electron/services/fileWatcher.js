import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isSupportedAudioFile, pathKey } from './normalize.js';
import * as repo from './libraryRepo.js';

const DEBOUNCE_MS = 1500;

/**
 * Watches library folders (recursive fs.watch, natively supported on Windows) and applies
 * incremental updates. Events are debounced and coalesced so bursts (e.g. copying an album)
 * result in one batch instead of a rescan per event.
 */
export class FileWatcher extends EventEmitter {
  constructor({ db, scanner, logger = console, debounceMs = DEBOUNCE_MS }) {
    super();
    this.db = db;
    this.scanner = scanner;
    this.logger = logger;
    this.debounceMs = debounceMs;
    this.watchers = new Map(); // folderId -> { watcher, root }
    this.pending = new Map(); // absolute path -> folderId
    this.timer = null;
    this.processing = false;
  }

  sync() {
    const folders = repo.listFolders(this.db);
    const wanted = new Set(folders.map((f) => f.id));
    for (const [id] of this.watchers) if (!wanted.has(id)) this.unwatch(id);
    for (const f of folders) if (!this.watchers.has(f.id)) this.watch(f);
  }

  watch(folder) {
    try {
      const watcher = fs.watch(folder.path, { recursive: true, persistent: false }, (_type, name) => {
        if (!name) return;
        this.#enqueue(path.join(folder.path, name.toString()), folder.id);
      });
      watcher.on('error', (err) => {
        // Typically the drive was disconnected. Re-check the folder; records are preserved.
        this.logger.warn?.(`Watcher error for ${folder.path}:`, err.message);
        this.unwatch(folder.id);
        this.scanner.scan({ folderIds: [folder.id] }).then(() => this.emit('changed'));
      });
      this.watchers.set(folder.id, { watcher, root: folder.path });
    } catch (err) {
      this.logger.warn?.(`Cannot watch ${folder.path}:`, err.message);
    }
  }

  unwatch(id) {
    const w = this.watchers.get(id);
    if (w) {
      w.watcher.close();
      this.watchers.delete(id);
    }
  }

  close() {
    for (const id of [...this.watchers.keys()]) this.unwatch(id);
    clearTimeout(this.timer);
  }

  #enqueue(p, folderId) {
    this.pending.set(p, folderId);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush() {
    if (this.processing || this.scanner.isScanning) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
      return;
    }
    this.processing = true;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    let changed = 0;
    try {
      for (const [p, folderId] of batch) {
        const st = await fsp.stat(p).catch(() => null);
        if (!st) {
          changed += repo.markUnavailableUnderPath(this.db, pathKey(p));
        } else if (st.isDirectory()) {
          changed += await this.#indexDirectory(p, folderId);
        } else if (st.isFile() && isSupportedAudioFile(p)) {
          const outcome = await this.scanner.indexFile(p, folderId).catch((err) => {
            this.logger.warn?.('Watcher could not index file:', err.message);
            return 'error';
          });
          if (outcome !== 'unchanged' && outcome !== 'error') changed++;
        }
      }
      if (changed) {
        repo.pruneOrphans(this.db);
        this.emit('changed');
      }
    } finally {
      this.processing = false;
    }
  }

  async #indexDirectory(dir, folderId) {
    let n = 0;
    const entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile() || !isSupportedAudioFile(e.name)) continue;
      const full = path.join(e.parentPath ?? dir, e.name);
      const outcome = await this.scanner.indexFile(full, folderId).catch(() => 'error');
      if (outcome !== 'unchanged' && outcome !== 'error') n++;
    }
    return n;
  }
}
