import * as Q from './queueModel.js';

const PUBLISH_INTERVAL_MS = 1000;
const PREVIOUS_RESTART_THRESHOLD = 3;

export const mediaUrl = (id) => `vela-media://track/${id}`;
export const artUrl = (hash, kind = 'thumb') => (hash ? `vela-art://${kind}/${hash}` : null);

/**
 * The single playback engine for a Reson session. It lives in the main window and owns:
 * the <audio> element, queue, current track, transport state, volume, shuffle/repeat and errors.
 *
 * React reads it through subscribe()/getSnapshot() (useSyncExternalStore). Position updates use a
 * separate, lower-cost channel so only progress UI re-renders on timeupdate.
 * Remote surfaces (mini-player, tray, media keys) send commands; they never own audio.
 */
export class PlaybackController {
  constructor({ api, audio, mediaSession = globalThis.navigator?.mediaSession, notify = () => {} }) {
    this.api = api;
    this.audio = audio;
    this.mediaSession = mediaSession;
    this.notify = notify;
    this.tracks = new Map();
    this.failed = new Set();
    this.listeners = new Set();
    this.positionListeners = new Set();
    this.loadToken = 0;
    this.settings = { missingTrackBehavior: 'skip', resumeOnLaunch: true };
    this.listen = { trackId: null, seconds: 0, recorded: false, lastTime: 0 };
    this.state = {
      queue: Q.createQueue(),
      current: null,
      playing: false,
      loading: false,
      volume: 0.8,
      muted: false,
      error: null,
    };
    this.position = { position: 0, duration: 0 };
    this.snapshot = this.#buildSnapshot();
    this.#bindAudio();
    this.#bindMediaSession();
  }

  // ---------- subscription ----------
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  subscribePosition = (fn) => {
    this.positionListeners.add(fn);
    return () => this.positionListeners.delete(fn);
  };
  getPosition = () => this.position;

  #buildSnapshot() {
    const { queue } = this.state;
    return {
      ...this.state,
      tracks: this.tracks,
      index: queue.index,
      shuffle: queue.shuffle,
      repeat: queue.repeat,
      hasNext: queue.index + 1 < queue.items.length || (queue.repeat !== 'off' && queue.items.length > 0),
      hasPrevious: queue.items.length > 0,
    };
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.snapshot = this.#buildSnapshot();
    for (const fn of this.listeners) fn();
    this.#schedulePublish();
    if ('queue' in patch) this.#schedulePersist();
  }

  #setPosition(patch) {
    const next = { ...this.position, ...patch };
    if (next.position === this.position.position && next.duration === this.position.duration) return;
    this.position = next;
    for (const fn of this.positionListeners) fn();
  }

  // ---------- setup ----------
  async init(settings) {
    this.applySettings(settings);
    this.audio.volume = settings.volume ?? 0.8;
    this.audio.muted = !!settings.muted;
    this.audio.preload = 'auto';
    let queue = Q.createQueue({ shuffle: !!settings.shuffle, repeat: settings.repeat ?? 'off' });
    this.#set({ volume: this.audio.volume, muted: this.audio.muted, queue });
    if (settings.outputDeviceId) this.setOutputDevice(settings.outputDeviceId, { silent: true });

    const session = settings.playbackSession;
    if (settings.resumeOnLaunch && session?.trackIds?.length) {
      try {
        const tracks = await this.api.library.getTracks(session.trackIds);
        this.#cacheTracks(tracks);
        const known = session.trackIds.filter((id) => this.tracks.has(id));
        if (known.length) {
          const currentId = session.trackIds[session.index];
          const index = Math.max(0, known.indexOf(currentId));
          queue = Q.restoreQueue(queue, known, index, session.originalTrackIds?.filter((id) => this.tracks.has(id)));
          this.#set({ queue });
          await this.#load({ autoplay: false, startAt: currentId === known[index] ? session.position : 0 });
        }
      } catch (err) {
        console.warn('Could not restore the previous session:', err);
      }
    }
    this.#publishNow();
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  #cacheTracks(tracks) {
    for (const t of tracks) this.tracks.set(t.id, t);
  }

  #bindAudio() {
    const a = this.audio;
    const token = () => this.loadToken;
    a.addEventListener('playing', () => {
      this.failed.clear();
      this.#set({ playing: true, loading: false, error: null });
    });
    a.addEventListener('pause', () => this.#set({ playing: false }));
    a.addEventListener('waiting', () => this.#set({ loading: true }));
    a.addEventListener('canplay', () => this.state.loading && this.#set({ loading: false }));
    a.addEventListener('timeupdate', () => {
      this.#trackListening(a.currentTime);
      this.#setPosition({ position: a.currentTime });
      this.#updatePositionState();
      // Persist the position periodically so a crash or quit resumes close to where it was.
      const now = Date.now();
      if (now - this.#lastPersist > 15000) {
        this.#lastPersist = now;
        this.persistSession();
      }
    });
    a.addEventListener('pause', () => this.persistSession());
    a.addEventListener('durationchange', () => {
      if (Number.isFinite(a.duration)) this.#setPosition({ duration: a.duration });
    });
    a.addEventListener('volumechange', () => this.#set({ volume: a.volume, muted: a.muted }));
    a.addEventListener('ended', () => this.#onEnded());
    a.addEventListener('error', () => {
      if (!a.getAttribute('src')) return;
      const code = a.error?.code;
      const reason =
        code === 4
          ? 'This file format or codec can’t be played'
          : code === 2
            ? 'The file could not be read (it may be missing or on a disconnected drive)'
            : code === 3
              ? 'The file appears to be corrupted'
              : 'Playback failed';
      this.#onFailure(token(), reason);
    });
  }

  #bindMediaSession() {
    const ms = this.mediaSession;
    if (!ms) return;
    const handlers = {
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.pause(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekto: (d) => d.seekTime != null && this.seek(d.seekTime),
      seekbackward: (d) => this.seek(this.audio.currentTime - (d.seekOffset || 10)),
      seekforward: (d) => this.seek(this.audio.currentTime + (d.seekOffset || 10)),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action unsupported on this platform */
      }
    }
  }

  #artObjectUrl = null;

  /** Updates Windows' media overlay (SMTC). MediaImage only accepts http/data/blob URLs, so art is passed as a blob. */
  async #updateMediaMetadata(track) {
    const ms = this.mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    if (!track) {
      ms.metadata = null;
      return;
    }
    const meta = { title: track.title, artist: track.artist, album: track.album, artwork: [] };
    ms.metadata = new MediaMetadata(meta);
    const art = artUrl(track.artHash, 'full');
    if (!art) return;
    try {
      const blob = await (await fetch(art)).blob();
      if (this.state.current?.id !== track.id) return;
      if (this.#artObjectUrl) URL.revokeObjectURL(this.#artObjectUrl);
      this.#artObjectUrl = URL.createObjectURL(blob);
      ms.metadata = new MediaMetadata({ ...meta, artwork: [{ src: this.#artObjectUrl, sizes: '512x512', type: 'image/jpeg' }] });
    } catch {
      /* artwork is optional for the media overlay */
    }
  }

  #lastPositionState = 0;
  #updatePositionState() {
    const ms = this.mediaSession;
    const now = Date.now();
    if (!ms?.setPositionState || now - this.#lastPositionState < 1000) return;
    this.#lastPositionState = now;
    const d = this.audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({ duration: d, position: Math.min(this.audio.currentTime, d), playbackRate: this.audio.playbackRate });
    } catch {
      /* ignore */
    }
  }

  // ---------- loading & failure handling ----------
  async #load({ autoplay = true, startAt = 0 } = {}) {
    const token = ++this.loadToken;
    const item = Q.currentItem(this.state.queue);
    if (!item) {
      this.#stop();
      return;
    }
    let track = this.tracks.get(item.id);
    if (!track) {
      const [fetched] = await this.api.library.getTracks([item.id]).catch(() => []);
      if (token !== this.loadToken) return;
      if (fetched) this.#cacheTracks([fetched]);
      track = fetched;
    }
    this.listen = { trackId: item.id, seconds: 0, recorded: false, lastTime: startAt };
    if (!track) return this.#onFailure(token, 'This track is no longer in your library');
    this.#set({ current: track, error: null, loading: autoplay });
    this.#setPosition({ position: startAt, duration: track.duration ?? 0 });
    this.#updateMediaMetadata(track);

    if (!track.available) return this.#onFailure(token, 'The file is unavailable (missing or on a disconnected drive)');
    if (track.unsupportedReason) return this.#onFailure(token, track.unsupportedReason);

    this.audio.src = mediaUrl(track.id);
    this.#prepareUpcoming();
    if (startAt > 0) {
      const seekWhenReady = () => {
        if (token === this.loadToken) this.audio.currentTime = startAt;
      };
      this.audio.addEventListener('loadedmetadata', seekWhenReady, { once: true });
    }
    if (!autoplay) {
      this.audio.load();
      return;
    }
    try {
      await this.audio.play();
    } catch (err) {
      // AbortError: superseded by a newer load or pause — expected during rapid switching.
      if (token !== this.loadToken || err?.name === 'AbortError') return;
      if (err?.name === 'NotSupportedError') this.#onFailure(token, 'This file format or codec can’t be played');
    }
  }

  /** Lets the main process pre-convert upcoming tracks that need it (ALAC), so they start instantly. */
  #prepareUpcoming() {
    const q = this.state.queue;
    const ids = q.items.slice(q.index + 1, q.index + 3).map((it) => it.id);
    if (ids.length) this.api.library.prepare?.(ids).catch(() => {});
  }

  #onFailure(token, reason) {
    if (token !== this.loadToken) return;
    const item = Q.currentItem(this.state.queue);
    const track = item ? this.tracks.get(item.id) : null;
    if (item) this.failed.add(item.id);
    this.audio.removeAttribute('src');
    this.audio.load();
    this.#set({ playing: false, loading: false, error: { trackId: item?.id ?? null, message: reason } });
    this.notify({ type: 'error', title: track ? `Can’t play “${track.title}”` : 'Can’t play track', message: reason });

    if (this.settings.missingTrackBehavior !== 'skip') return;
    const q = this.state.queue;
    const isPlayable = (id) => {
      const t = this.tracks.get(id);
      return !this.failed.has(id) && (!t || (t.available && !t.unsupportedReason));
    };
    const nextPos = Q.findPlayable(q, q.index + 1, isPlayable, 1);
    if (nextPos === -1) return; // nothing playable left: stay stopped with the error shown
    this.#set({ queue: Q.jumpTo(q, nextPos) });
    this.#load({ autoplay: true });
  }

  #onEnded() {
    this.#flushListening(true);
    const r = Q.next(this.state.queue, { auto: true });
    if (r.repeated) {
      this.listen = { trackId: this.listen.trackId, seconds: 0, recorded: false, lastTime: 0 };
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (r.ended) {
      this.audio.currentTime = 0;
      this.#setPosition({ position: 0 });
      // endedAt lets the UI mark the end of the queue (the "To Be Continued" arrow).
      this.#set({ playing: false, endedAt: Date.now() });
      return;
    }
    this.#set({ queue: r.state });
    this.#load({ autoplay: true });
  }

  #stop() {
    this.loadToken++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.#set({ current: null, playing: false, loading: false });
    this.#setPosition({ position: 0, duration: 0 });
    this.#updateMediaMetadata(null);
  }

  // ---------- listening history ----------
  #trackListening(time) {
    const l = this.listen;
    if (!l.trackId || this.audio.paused) {
      l.lastTime = time;
      return;
    }
    const delta = time - l.lastTime;
    l.lastTime = time;
    if (delta > 0 && delta < 1.5) l.seconds += delta;
    const duration = this.position.duration || this.state.current?.duration || 0;
    const threshold = duration > 0 ? Math.min(30, duration * 0.5) : 30;
    if (!l.recorded && l.seconds >= threshold) this.#flushListening(false);
  }

  #flushListening(force) {
    const l = this.listen;
    if (!l.trackId || l.recorded) return;
    if (!force && l.seconds <= 0) return;
    if (force && l.seconds < 1) return;
    l.recorded = true;
    this.api.history.record(l.trackId, Math.round(l.seconds * 10) / 10).catch(() => {});
  }

  // ---------- public transport API ----------
  /** Replaces the queue with `tracks` and starts at startIndex. */
  playTracks(tracks, startIndex = 0, { shuffle } = {}) {
    if (!tracks?.length) return;
    this.#cacheTracks(tracks);
    let queue = this.state.queue;
    if (shuffle != null && shuffle !== queue.shuffle) queue = { ...queue, shuffle, original: null };
    const start = shuffle && startIndex === 0 ? Math.floor(Math.random() * tracks.length) : startIndex;
    this.failed.clear();
    this.#set({ queue: Q.setQueue(queue, tracks.map((t) => t.id), start) });
    this.#load({ autoplay: true });
  }

  enqueue(tracks) {
    if (!tracks?.length) return;
    this.#cacheTracks(tracks);
    const wasEmpty = !this.state.queue.items.length;
    let queue = Q.enqueue(this.state.queue, tracks.map((t) => t.id));
    if (wasEmpty) queue = Q.jumpTo(queue, 0);
    this.#set({ queue });
    if (wasEmpty) this.#load({ autoplay: false });
  }

  playNext(tracks) {
    if (!tracks?.length) return;
    if (!this.state.queue.items.length) return this.enqueue(tracks);
    this.#cacheTracks(tracks);
    this.#set({ queue: Q.playNext(this.state.queue, tracks.map((t) => t.id)) });
  }

  play() {
    if (!this.state.current) {
      if (this.state.queue.items.length) {
        this.#set({ queue: Q.jumpTo(this.state.queue, Math.max(0, this.state.queue.index)) });
        this.#load({ autoplay: true });
      }
      return;
    }
    if (this.state.error?.trackId === this.state.current.id) {
      this.failed.delete(this.state.current.id);
      this.#load({ autoplay: true, startAt: 0 });
      return;
    }
    if (!this.audio.getAttribute('src')) {
      this.#load({ autoplay: true, startAt: this.position.position });
      return;
    }
    this.audio.play().catch((err) => {
      if (err?.name !== 'AbortError') console.warn('play() failed:', err);
    });
  }

  pause() {
    this.audio.pause();
    this.#flushListening(false);
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(seconds) {
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.position.duration;
    if (!this.state.current || !d) return;
    const t = Math.max(0, Math.min(seconds, d - 0.05));
    this.audio.currentTime = t;
    this.listen.lastTime = t;
    this.#setPosition({ position: t });
    this.#schedulePublish();
  }

  /** Seeks relative to the current position (keyboard skip). Returns the new position. */
  seekBy(delta) {
    const now = this.audio.currentTime || this.position.position || 0;
    this.seek(now + delta);
    return this.position.position;
  }

  /** Seeks to a fraction (0..1) of the track (number keys 0–9). */
  seekToFraction(fraction) {
    const d = Number.isFinite(this.audio.duration) ? this.audio.duration : this.position.duration;
    if (d) this.seek(Math.max(0, Math.min(1, fraction)) * d);
    return this.position.position;
  }

  next() {
    const q = this.state.queue;
    if (!q.items.length) return;
    this.#flushListening(false);
    const r = Q.next(q);
    if (r.ended) {
      // Manual "next" at the end of a non-repeating queue: stop at the end.
      this.audio.pause();
      this.seek(0);
      return;
    }
    this.#set({ queue: r.state });
    this.#load({ autoplay: true });
  }

  previous() {
    if (!this.state.queue.items.length) return;
    if (this.audio.currentTime > PREVIOUS_RESTART_THRESHOLD) {
      this.seek(0);
      return;
    }
    this.#flushListening(false);
    this.#set({ queue: Q.previous(this.state.queue) });
    this.#load({ autoplay: true });
  }

  jumpTo(position) {
    this.#flushListening(false);
    this.failed.clear();
    this.#set({ queue: Q.jumpTo(this.state.queue, position) });
    this.#load({ autoplay: true });
  }

  removeFromQueue(positions) {
    const { state, currentRemoved } = Q.removeAt(this.state.queue, positions);
    this.#set({ queue: state });
    if (currentRemoved) {
      if (state.index === -1) this.#stop();
      else this.#load({ autoplay: this.state.playing });
    }
  }

  moveInQueue(from, to) {
    this.#set({ queue: Q.move(this.state.queue, from, to) });
  }

  /** Snapshot of the queue that restoreQueueState() can put back (used for Undo). */
  snapshotQueue() {
    return this.state.queue;
  }

  /** Restores a snapshot without interrupting the current track (if it is still in the snapshot). */
  restoreQueueState(snapshot) {
    const cur = Q.currentItem(this.state.queue);
    const index = cur ? snapshot.items.findIndex((it) => it.qid === cur.qid) : -1;
    this.#set({ queue: { ...snapshot, index: index >= 0 ? index : snapshot.index } });
  }

  /** Clears upcoming tracks, keeping the current one. */
  clearUpcoming() {
    const q = this.state.queue;
    const positions = q.items.map((_, i) => i).filter((i) => i !== q.index);
    this.removeFromQueue(positions);
  }

  toggleShuffle() {
    const queue = Q.toggleShuffle(this.state.queue);
    this.#set({ queue });
    this.api.settings.set('shuffle', queue.shuffle).catch(() => {});
  }

  cycleRepeat() {
    const queue = Q.cycleRepeat(this.state.queue);
    this.#set({ queue });
    this.api.settings.set('repeat', queue.repeat).catch(() => {});
  }

  #volumeTimer = null;
  setVolume(volume) {
    const v = Math.max(0, Math.min(1, volume));
    this.audio.volume = v;
    if (v > 0 && this.audio.muted) this.audio.muted = false;
    clearTimeout(this.#volumeTimer);
    this.#volumeTimer = setTimeout(() => {
      this.api.settings.set('volume', v).catch(() => {});
      this.api.settings.set('muted', this.audio.muted).catch(() => {});
    }, 400);
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.api.settings.set('muted', this.audio.muted).catch(() => {});
  }

  async setOutputDevice(deviceId, { silent = false } = {}) {
    if (typeof this.audio.setSinkId !== 'function') return false;
    try {
      await this.audio.setSinkId(deviceId === 'default' ? '' : deviceId);
      return true;
    } catch (err) {
      if (!silent) this.notify({ type: 'error', title: 'Could not switch audio output', message: err.message });
      return false;
    }
  }

  async toggleFavorite(track = this.state.current) {
    if (!track) return;
    const value = !track.favorite;
    await this.api.favorites.set([track.id], value);
    this.updateTracks([{ ...track, favorite: value }]);
  }

  /** Refreshes cached track data (favorite/availability changes) for tracks in the queue. */
  updateTracks(tracks) {
    if (!tracks.length) return;
    this.#cacheTracks(tracks);
    const cur = this.state.current ? this.tracks.get(this.state.current.id) : null;
    this.#set({ current: cur ?? this.state.current });
  }

  async refreshFromLibrary() {
    const ids = [...new Set(Q.trackIds(this.state.queue))];
    if (!ids.length) return;
    const fresh = await this.api.library.getTracks(ids).catch(() => null);
    if (!fresh) return;
    const freshIds = new Set(fresh.map((t) => t.id));
    for (const id of ids) {
      if (!freshIds.has(id)) {
        // Removed from the library (e.g. folder removed): keep queue entries but mark unavailable.
        const t = this.tracks.get(id);
        if (t) this.tracks.set(id, { ...t, available: false });
      }
    }
    this.updateTracks(fresh);
  }

  handleCommand(cmd) {
    switch (cmd?.type) {
      case 'toggle': return this.toggle();
      case 'play': return this.play();
      case 'pause': return this.pause();
      case 'next': return this.next();
      case 'previous': return this.previous();
      case 'seek': return this.seek(cmd.position);
      case 'setVolume': return this.setVolume(cmd.volume);
      case 'toggleShuffle': return this.toggleShuffle();
      case 'cycleRepeat': return this.cycleRepeat();
      case 'toggleFavorite': return this.toggleFavorite();
      default: return undefined;
    }
  }

  // ---------- publishing to the mini-player / tray ----------
  #publishTimer = null;
  #publishInterval = null;

  #schedulePublish() {
    if (this.#publishTimer) return;
    this.#publishTimer = setTimeout(() => {
      this.#publishTimer = null;
      this.#publishNow();
    }, 50);
  }

  publicState() {
    const t = this.state.current;
    return {
      track: t
        ? { id: t.id, title: t.title, artist: t.artist, album: t.album, artHash: t.artHash, palette: t.palette, favorite: !!t.favorite }
        : null,
      playing: this.state.playing,
      loading: this.state.loading,
      position: this.audio.currentTime || this.position.position || 0,
      duration: this.position.duration || 0,
      timestamp: Date.now(),
      shuffle: this.state.queue.shuffle,
      repeat: this.state.queue.repeat,
      volume: this.state.volume,
      muted: this.state.muted,
      hasNext: this.snapshot.hasNext,
      error: this.state.error?.message ?? null,
    };
  }

  #publishNow() {
    this.api.player.publish(this.publicState()).catch(() => {});
    // While playing, refresh periodically so remote progress bars stay in sync after seeks/drift.
    if (this.state.playing && !this.#publishInterval) {
      this.#publishInterval = setInterval(() => this.#publishNow(), PUBLISH_INTERVAL_MS);
    } else if (!this.state.playing && this.#publishInterval) {
      clearInterval(this.#publishInterval);
      this.#publishInterval = null;
    }
  }

  // ---------- session persistence ----------
  #persistTimer = null;
  #lastPersist = 0;
  #schedulePersist() {
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => this.persistSession(), 1500);
  }

  persistSession() {
    const q = this.state.queue;
    const session = q.items.length
      ? {
          trackIds: Q.trackIds(q).slice(0, 20000),
          originalTrackIds: q.original ? q.original.map((i) => i.id).slice(0, 20000) : null,
          index: q.index,
          position: Math.max(0, this.audio.currentTime || 0),
        }
      : null;
    return this.api.settings.set('playbackSession', session).catch(() => {});
  }

  destroy() {
    clearTimeout(this.#persistTimer);
    clearTimeout(this.#publishTimer);
    clearInterval(this.#publishInterval);
    this.audio.pause();
    this.listeners.clear();
    this.positionListeners.clear();
  }
}
