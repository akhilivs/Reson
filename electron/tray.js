import { Tray, Menu, nativeImage } from 'electron';

/** System tray with real playback controls routed to the single playback controller. */
export class AppTray {
  constructor({ iconPath, onCommand, onShowMain, onToggleMini, onQuit }) {
    this.tray = new Tray(nativeImage.createFromPath(iconPath));
    this.handlers = { onCommand, onShowMain, onToggleMini, onQuit };
    this.state = { title: null, artist: null, playing: false, hasTrack: false };
    this.miniVisible = false;
    this.tray.setToolTip('Reson');
    this.tray.on('click', () => onShowMain());
    this.#rebuild();
  }

  update(state) {
    const next = {
      title: state?.track?.title ?? null,
      artist: state?.track?.artist ?? null,
      playing: !!state?.playing,
      hasTrack: !!state?.track,
    };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    const tip = next.title ? `${next.title} — ${next.artist}` : 'Reson';
    this.tray.setToolTip(tip.length > 120 ? tip.slice(0, 117) + '…' : tip);
    this.#rebuild();
  }

  setMiniVisible(v) {
    this.miniVisible = v;
    this.#rebuild();
  }

  #rebuild() {
    const { onCommand, onShowMain, onToggleMini, onQuit } = this.handlers;
    const s = this.state;
    const label = (t) => (t.length > 48 ? t.slice(0, 47) + '…' : t);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(s.title ? [{ label: label(`${s.title} — ${s.artist}`), enabled: false }, { type: 'separator' }] : []),
        { label: s.playing ? 'Pause' : 'Play', enabled: s.hasTrack, click: () => onCommand({ type: 'toggle' }) },
        { label: 'Next', enabled: s.hasTrack, click: () => onCommand({ type: 'next' }) },
        { label: 'Previous', enabled: s.hasTrack, click: () => onCommand({ type: 'previous' }) },
        { type: 'separator' },
        { label: 'Show Reson', click: onShowMain },
        { label: this.miniVisible ? 'Hide mini player' : 'Show mini player', click: onToggleMini },
        { type: 'separator' },
        { label: 'Quit Reson', click: onQuit },
      ]),
    );
  }

  destroy() {
    this.tray.destroy();
  }
}
