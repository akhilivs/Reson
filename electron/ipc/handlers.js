import { ipcMain, dialog, shell, app } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as v from './validators.js';
import * as repo from '../services/libraryRepo.js';
import { readLyrics } from '../services/metadataService.js';
import { currentSchemaVersion } from '../services/migrations.js';
import { needsTranscode } from '../services/transcodeService.js';

/**
 * Registers every IPC endpoint. Each handler:
 *  - checks the sender is one of Reson's own windows (and the main window for engine-only calls),
 *  - validates arguments,
 *  - returns { ok, data } or { ok:false, error } so the renderer gets clean error messages.
 */
export function registerIpc(ctx) {
  const { db, library, windows, settings, artworkDir, paths, transcoder } = ctx;

  const handle = (channel, fn, { mainOnly = false } = {}) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!windows.isOwnWebContents(event.sender)) return { ok: false, error: 'Unauthorized sender' };
      if (mainOnly && event.sender !== windows.main?.webContents) return { ok: false, error: 'Unauthorized sender' };
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err) {
        if (!(err instanceof v.ValidationError)) console.error(`[ipc] ${channel} failed:`, err);
        return { ok: false, error: err instanceof v.ValidationError ? err.message : friendlyError(err) };
      }
    });
  };

  // ----- Library -----
  handle('library:getFolders', () => repo.listFolders(db));
  handle('library:addFolders', async () => {
    const parent = windows.main && !windows.main.isDestroyed() ? windows.main : undefined;
    const res = await dialog.showOpenDialog(parent, {
      title: 'Choose music folders',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });
    if (res.canceled || !res.filePaths.length) return { added: [], skipped: [], canceled: true };
    return library.addFolders(res.filePaths);
  });
  handle('library:removeFolder', (id) => library.removeFolder(v.id(id)));
  handle('library:rescan', (opts) => {
    const o = v.plainObject(opts);
    library.rescan({ full: o.full === true });
    return true;
  });
  handle('library:cancelScan', () => library.cancelScan());
  handle('library:status', () => library.status());
  handle('library:stats', () => repo.getStats(db));
  handle('library:listTracks', (q) => repo.listTracks(db, v.trackQuery(q)));
  handle('library:getTracks', (ids) => repo.getTracksByIds(db, v.idList(ids, { max: 20000 })));
  handle('library:listAlbums', (q) => repo.listAlbums(db, v.albumQuery(q)));
  handle('library:getAlbum', (id) => repo.getAlbum(db, v.id(id)));
  handle('library:listArtists', (q) => repo.listArtists(db, { search: v.optionalString(v.plainObject(q).search, { max: 200 }) }));
  handle('library:getArtist', (id) => repo.getArtist(db, v.id(id)));
  handle('library:search', (q) => repo.searchAll(db, v.optionalString(q, { max: 200, name: 'query' })));
  handle('library:home', () => repo.getHome(db));
  handle('library:reveal', async (id) => {
    const row = repo.getTrackPath(db, v.id(id));
    if (!row) throw new Error('Track not found');
    const exists = await fs.stat(row.path).then(() => true, () => false);
    if (!exists) throw new Error('The file is no longer at its saved location');
    shell.showItemInFolder(row.path);
    return true;
  });
  handle('library:lyrics', async (id) => {
    const row = repo.getTrackPath(db, v.id(id));
    if (!row) return null;
    return readLyrics(row.path);
  });
  handle('library:removeMissing', () => repo.removeUnavailableTracks(db));
  // Pre-converts upcoming ALAC tracks so they start instantly. Fire-and-forget; errors surface on play.
  handle(
    'library:prepare',
    (ids) => {
      for (const id of v.idList(ids, { max: 5 })) {
        const row = repo.getTrackPath(db, id);
        if (row?.available && needsTranscode(row.codec)) transcoder.ensure(row).catch(() => {});
      }
      return true;
    },
    { mainOnly: true },
  );

  // ----- Favorites & playlists -----
  handle('favorites:set', (ids, value) => {
    repo.setFavorites(db, v.idList(ids, { max: 20000, min: 1 }), v.bool(value, 'value'));
    windows.broadcast('library:changed', { reason: 'favorites' });
    return true;
  });
  handle('playlists:list', () => repo.listPlaylists(db));
  handle('playlists:get', (id) => repo.getPlaylist(db, v.id(id)));
  handle('playlists:smart', (key) => {
    const k = v.oneOf(key, v.SMART_KEYS, 'collection');
    return { key: k, name: repo.SMART_COLLECTIONS[k].name, tracks: repo.SMART_COLLECTIONS[k].get(db) };
  });
  handle('playlists:create', (name, ids) => repo.createPlaylist(db, v.playlistName(name), v.idList(ids ?? [], { max: 20000 })));
  handle('playlists:rename', (id, name) => repo.renamePlaylist(db, v.id(id), v.playlistName(name)));
  handle('playlists:delete', (id) => repo.deletePlaylist(db, v.id(id)));
  handle('playlists:add', (id, ids) => repo.addToPlaylist(db, v.id(id), v.idList(ids, { max: 20000, min: 1 })));
  handle('playlists:remove', (id, entryIds) => repo.removeFromPlaylist(db, v.id(id), v.idList(entryIds, { min: 1 })));
  handle('playlists:reorder', (id, entryIds) => repo.reorderPlaylist(db, v.id(id), v.idList(entryIds)));

  // ----- History -----
  handle(
    'history:record',
    (id, listened) => repo.recordPlay(db, v.id(id), v.number(listened, { min: 0, max: 1e7, name: 'listened' })),
    { mainOnly: true },
  );

  // ----- Settings -----
  handle('settings:get', () => settings.all());
  handle('settings:set', (key, value) => {
    const k = v.settingKey(key);
    const val = v.settingValue(k, value);
    settings.set(k, val);
    return val;
  });

  // ----- Player bridge (single engine in the main window) -----
  handle('player:publish', (state) => ctx.onPlayerState(v.playerState(state)), { mainOnly: true });
  handle('player:command', (cmd) => ctx.sendPlayerCommand(v.playerCommand(cmd)));
  handle('player:getState', () => ctx.getPlayerState());

  // ----- Windows & app -----
  handle('window:showMini', () => windows.showMini());
  handle('window:hideMini', () => windows.hideMini());
  handle('window:toggleMini', () => windows.toggleMini());
  handle('window:showMain', () => windows.showMain());
  handle('window:miniVisible', () => windows.miniVisible);
  handle(
    'window:setFullScreen',
    (value) => {
      const on = v.bool(value, 'value');
      windows.main?.setFullScreen(on);
      return on;
    },
    { mainOnly: true },
  );
  handle('app:quit', () => ctx.quit());
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    sqlite: process.versions.sqlite ?? null,
    platform: `${process.platform} ${process.getSystemVersion?.() ?? ''}`.trim(),
    arch: process.arch,
    schemaVersion: currentSchemaVersion(db),
    packaged: app.isPackaged,
    // First name only, for the greeting. Never leaves this computer.
    userName: displayName(),
  }));
  handle('app:storage', async () => {
    const size = async (p) => (await fs.stat(p).catch(() => null))?.size ?? 0;
    let artworkBytes = 0;
    let artworkFiles = 0;
    for (const f of await fs.readdir(artworkDir).catch(() => [])) {
      artworkBytes += await size(path.join(artworkDir, f));
      artworkFiles++;
    }
    const dbBytes = (await size(paths.db)) + (await size(paths.db + '-wal'));
    const converted = await transcoder.usage();
    return { dbBytes, artworkBytes, artworkFiles, convertedBytes: converted.bytes, convertedFiles: converted.files };
  });
  handle('app:clearConvertedAudio', () => transcoder.clear().then(() => true));
  handle('app:openDataFolder', () => shell.openPath(paths.userData).then(() => true));
  handle('app:cleanArtworkCache', async () => {
    const unused = repo.getUnusedArtwork(db);
    for (const a of unused) {
      for (const f of [a.file, a.thumbFile]) await fs.rm(path.join(artworkDir, f), { force: true });
    }
    repo.deleteArtworkRows(db, unused.map((a) => a.id));
    return unused.length;
  });
}

function displayName() {
  try {
    const raw = os.userInfo().username.split(/[s._-]+/)[0];
    return raw ? raw[0].toUpperCase() + raw.slice(1) : null;
  } catch {
    return null;
  }
}

function friendlyError(err) {
  if (err?.code === 'ENOENT') return 'File or folder not found';
  if (err?.code === 'EACCES' || err?.code === 'EPERM') return 'Permission denied';
  return err?.message ? String(err.message).slice(0, 300) : 'Something went wrong';
}
