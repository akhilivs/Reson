import { PlaybackController } from './playbackController.js';
import { api } from './api.js';
import { toastBus } from '../app/toastBus.js';

// The single playback engine instance for this session (main window only).
const audio = new Audio();
audio.crossOrigin = null;

export const player = new PlaybackController({
  api,
  audio,
  notify: (t) => toastBus.push(t),
});

// Commands from the mini-player and tray arrive via the main process.
api.player.onCommand((cmd) => player.handleCommand(cmd));
