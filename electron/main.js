import { app, protocol, session, nativeImage, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './services/database.js';
import { ArtworkService, createNativeImageAdapter } from './services/artworkService.js';
import { LibraryService } from './services/libraryService.js';
import { registerSchemes, registerProtocolHandlers, DEV_CSP, APP_ORIGIN } from './services/protocols.js';
import * as repo from './services/libraryRepo.js';
import { settingsWithDefaults } from './ipc/validators.js';
import { registerIpc } from './ipc/handlers.js';
import { WindowManager } from './windows/windowManager.js';
import { WindowStateStore } from './windows/windowState.js';
import { AppTray } from './tray.js';
import { TranscodeService, resolveFfmpegPath } from './services/transcodeService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEV_SERVER = process.env.VELA_DEV_SERVER || null;

if (process.env.VELA_USER_DATA) app.setPath('userData', path.resolve(process.env.VELA_USER_DATA));
app.setAppUserModelId('com.reson.player');
registerSchemes(protocol);

const QUIET = process.env.VELA_QUIET === '1';
if (QUIET) {
  // Automated tests: keep Windows media keys / media overlay with whatever the user is actually playing.
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
}
Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => ctx.windows?.showMain());
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('Reson failed to start:', err);
    app.exit(1);
  });
}

const ctx = {
  db: null,
  library: null,
  windows: null,
  tray: null,
  playerState: null,
};

function createSettings(db, windows, library) {
  let cache = settingsWithDefaults(repo.getSettings(db));
  return {
    all: () => ({ ...cache }),
    get: (k) => cache[k],
    set(key, value) {
      repo.setSetting(db, key, value);
      cache = { ...cache, [key]: value };
      if (key === 'miniAlwaysOnTop') windows.setMiniAlwaysOnTop(value);
      if (key === 'watchFolders') library.setWatching(value);
      if (key !== 'playbackSession') windows.broadcast('settings:changed', { key, value });
    },
  };
}

async function bootstrap() {
  const userData = app.getPath('userData');
  const paths = {
    userData,
    db: path.join(userData, 'vela-library.db'),
    artwork: path.join(userData, 'artwork'),
    windowState: path.join(userData, 'window-state.json'),
    transcode: path.join(userData, 'converted-audio'),
  };
  fs.mkdirSync(userData, { recursive: true });

  const db = openDatabase(paths.db);
  const artwork = new ArtworkService({
    db,
    cacheDir: paths.artwork,
    imageAdapter: createNativeImageAdapter(nativeImage),
  });
  await artwork.init();

  const library = new LibraryService({ db, artwork });
  const transcoder = new TranscodeService({ cacheDir: paths.transcode, ffmpegPath: await resolveFfmpegPath() });
  if (!transcoder.available) console.warn('ffmpeg not found: ALAC files will not play');
  const windows = new WindowManager({
    preload: path.join(__dirname, 'preload.cjs'),
    rendererUrl: (page) => (DEV_SERVER ? `${DEV_SERVER}/${page}` : `${APP_ORIGIN}/${page}`),
    icon: path.join(ROOT, 'build', 'icon.ico'),
    stateStore: new WindowStateStore(paths.windowState),
    getSettings: () => settings.all(),
  });
  const settings = createSettings(db, windows, library);
  library.setWatching(settings.get('watchFolders'));
  Object.assign(ctx, { db, library, windows, settings, transcoder, artworkDir: paths.artwork, paths });

  hardenSessions();
  registerProtocolHandlers({
    protocol,
    getDb: () => db,
    artworkDir: paths.artwork,
    distDir: path.join(ROOT, 'dist'),
    isDev: !!DEV_SERVER,
    transcoder,
  });

  ctx.onPlayerState = (state) => {
    ctx.playerState = state;
    if (windows.mini && !windows.mini.isDestroyed()) windows.mini.webContents.send('player:state', state);
    ctx.tray?.update(state);
    return true;
  };
  ctx.sendPlayerCommand = (cmd) => {
    if (!windows.main || windows.main.isDestroyed()) return false;
    windows.main.webContents.send('player:command', cmd);
    return true;
  };
  ctx.getPlayerState = () => ctx.playerState;
  ctx.quit = () => {
    windows.quitting = true;
    app.quit();
  };
  registerIpc(ctx);

  library.on('progress', (p) => windows.broadcast('library:scanProgress', p));
  let changeTimer = null;
  library.on('changed', () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => windows.broadcast('library:changed', { reason: 'library' }), 250);
  });

  windows.on('quit-requested', () => ctx.quit());
  windows.on('mini-visibility', (visible) => {
    ctx.tray?.setMiniVisible(visible);
    windows.broadcast('window:miniVisibility', visible);
  });

  windows.createMain();
  if (!QUIET) try {
    ctx.tray = new AppTray({
      iconPath: path.join(ROOT, 'build', 'tray.ico'),
      onCommand: (cmd) => ctx.sendPlayerCommand(cmd),
      onShowMain: () => windows.showMain(),
      onToggleMini: () => windows.toggleMini(),
      onQuit: () => ctx.quit(),
    });
  } catch (err) {
    console.warn('Tray unavailable:', err.message);
  }

  library.start();
  // Pick up changes made while Reson was closed (quick: unchanged files are skipped by size+mtime).
  if (repo.listFolders(db).length) setTimeout(() => library.rescan(), 2500);

  if (process.env.VELA_E2E === '1') {
    // Test-only hook: lets Playwright add folders without the native dialog.
    globalThis.__velaTest = {
      addFolders: (paths) => library.addFolders(paths),
      waitForScan: () => library.scanner.running ?? Promise.resolve(),
      windows,
      getPlayerState: () => ctx.playerState,
    };
  }
}

function hardenSessions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'speaker-selection'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'speaker-selection' || permission === 'media');
  if (DEV_SERVER) {
    ses.webRequest.onHeadersReceived({ urls: [`${DEV_SERVER}/*`] }, (details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } });
    });
  }
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    const allowed = DEV_SERVER ? url.startsWith(DEV_SERVER) : url.startsWith(APP_ORIGIN);
    if (!allowed) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('before-quit', () => {
  if (ctx.windows) ctx.windows.quitting = true;
});

app.on('will-quit', () => {
  try {
    ctx.windows?.destroyAll();
    ctx.tray?.destroy();
    ctx.library?.close();
    ctx.db?.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
});

// Windows: keep running in the tray when all windows are hidden; quitting is explicit.
app.on('window-all-closed', () => {
  if (ctx.windows?.quitting) app.quit();
});
