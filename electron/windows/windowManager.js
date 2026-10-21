import { BrowserWindow, screen } from 'electron';
import { EventEmitter } from 'node:events';
import { ensureVisible } from './windowState.js';

// Quiet mode (automated tests): windows never appear on screen and all audio is muted.
const QUIET = process.env.VELA_QUIET === '1';

/**
 * Owns both windows and their lifecycle.
 *
 * Playback engine lives in the MAIN window's renderer. Therefore the main window is never
 * destroyed while the app runs: closing it hides it (when close-to-tray is on), and playback
 * continues. The mini-player is a remote control + display that talks to the engine via IPC,
 * so there is exactly one audio engine per session.
 */
export class WindowManager extends EventEmitter {
  constructor({ preload, rendererUrl, icon, stateStore, getSettings }) {
    super();
    this.preload = preload;
    this.rendererUrl = rendererUrl; // (page) => url
    this.icon = icon;
    this.stateStore = stateStore;
    this.getSettings = getSettings;
    this.main = null;
    this.mini = null;
    this.quitting = false;
  }

  #webPreferences() {
    return {
      preload: this.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Keep audio events/timers running while hidden or minimized.
      backgroundThrottling: false,
      // Quiet (test) mode also turns off animations: hidden windows never render frames to finish them.
      additionalArguments: QUIET ? ['--brook-quiet'] : [],
    };
  }

  createMain() {
    const saved = this.stateStore.get('main');
    const bounds = ensureVisible(saved?.bounds, screen.getAllDisplays(), {
      width: 1280,
      height: 820,
      minWidth: 760,
      minHeight: 540,
    });
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 760,
      minHeight: 540,
      show: false,
      title: 'Reson',
      icon: this.icon,
      backgroundColor: '#111318',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#c9ccd6', height: 44 },
      webPreferences: this.#webPreferences(),
    });
    this.stateStore.track('main', win);
    if (saved?.maximized) win.maximize();

    win.once('ready-to-show', () => {
      if (!QUIET && !process.env.VELA_START_HIDDEN) win.show();
    });
    win.on('close', (e) => {
      if (this.quitting) return;
      if (this.getSettings().closeToTray) {
        e.preventDefault();
        win.hide();
        this.emit('main-hidden');
      } else {
        e.preventDefault();
        this.emit('quit-requested');
      }
    });
    win.on('closed', () => {
      this.main = null;
      // The engine is gone; never leave a mini-player controlling nothing.
      if (!this.quitting) this.emit('quit-requested');
    });
    if (QUIET) win.webContents.setAudioMuted(true);
    win.loadURL(this.rendererUrl('index.html'));
    this.main = win;
    return win;
  }

  showMain() {
    if (!this.main) return;
    if (this.main.isMinimized()) this.main.restore();
    if (QUIET) return;
    this.main.show();
    this.main.focus();
  }

  createMini() {
    const saved = this.stateStore.get('mini');
    const size = { width: 380, height: 140 };
    const bounds = ensureVisible(saved?.bounds ? { ...saved.bounds, ...size } : null, screen.getAllDisplays(), size);
    if (!saved?.bounds) {
      // Default: bottom-right corner of the primary work area.
      const wa = screen.getPrimaryDisplay().workArea;
      bounds.x = wa.x + wa.width - size.width - 24;
      bounds.y = wa.y + wa.height - size.height - 24;
    }
    const win = new BrowserWindow({
      ...bounds,
      ...size,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      roundedCorners: true,
      title: 'Reson Mini Player',
      icon: this.icon,
      backgroundColor: '#15171d',
      alwaysOnTop: this.getSettings().miniAlwaysOnTop,
      webPreferences: this.#webPreferences(),
    });
    this.stateStore.track('mini', win);
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
      this.emit('mini-visibility', false);
    });
    win.on('closed', () => {
      this.mini = null;
    });
    if (QUIET) win.webContents.setAudioMuted(true);
    win.loadURL(this.rendererUrl('mini.html'));
    this.mini = win;
    return win;
  }

  showMini() {
    if (!this.mini) this.createMini();
    const win = this.mini;
    const reveal = () => {
      win.setAlwaysOnTop(!!this.getSettings().miniAlwaysOnTop, 'floating');
      if (QUIET) this.quietMiniVisible = true;
      else win.showInactive();
      this.emit('mini-visibility', true);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal);
    else reveal();
  }

  hideMini() {
    if (QUIET && this.quietMiniVisible) {
      this.quietMiniVisible = false;
      this.emit('mini-visibility', false);
      return;
    }
    if (this.mini?.isVisible()) {
      this.mini.hide();
      this.emit('mini-visibility', false);
    }
  }

  toggleMini() {
    if (this.miniVisible) this.hideMini();
    else this.showMini();
  }

  get miniVisible() {
    return QUIET ? !!this.quietMiniVisible : !!this.mini?.isVisible();
  }

  setMiniAlwaysOnTop(value) {
    this.mini?.setAlwaysOnTop(value, 'floating');
  }

  broadcast(channel, payload) {
    for (const w of [this.main, this.mini]) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  isOwnWebContents(wc) {
    return (this.main && wc === this.main.webContents) || (this.mini && wc === this.mini.webContents);
  }

  destroyAll() {
    this.quitting = true;
    this.stateStore.flush();
    for (const w of [this.mini, this.main]) if (w && !w.isDestroyed()) w.destroy();
  }
}
