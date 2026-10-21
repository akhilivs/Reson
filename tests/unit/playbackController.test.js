import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlaybackController } from '../../src/services/playbackController.js';

/** Minimal HTMLAudioElement stand-in: tracks src/play/pause and lets tests fire media events. */
class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.attrs = {};
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.volume = 1;
    this.muted = false;
    this.playbackRate = 1;
    this.error = null;
    this.playCalls = [];
    this.failSrc = new Set();
  }
  set src(v) {
    this.attrs.src = v;
    this.currentTime = 0;
  }
  get src() {
    return this.attrs.src ?? '';
  }
  getAttribute(n) {
    return this.attrs[n] ?? null;
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  load() {}
  play() {
    const src = this.attrs.src;
    this.playCalls.push(src);
    if (this.failSrc.has(src)) {
      queueMicrotask(() => {
        this.error = { code: 4 };
        this.dispatchEvent(new Event('error'));
      });
      return Promise.reject(Object.assign(new Error('fail'), { name: 'NotSupportedError' }));
    }
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}

const track = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', album: 'B', duration: 100, available: true, unsupportedReason: null, favorite: false, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeApi(library = {}) {
  return {
    library: { getTracks: vi.fn(async (ids) => ids.map((id) => library[id]).filter(Boolean)) },
    history: { record: vi.fn(async () => true) },
    settings: { set: vi.fn(async () => true) },
    favorites: { set: vi.fn(async () => true) },
    player: { publish: vi.fn(async () => true) },
  };
}

let audio;
let api;
let notify;
let pc;

beforeEach(async () => {
  audio = new FakeAudio();
  api = makeApi();
  notify = vi.fn();
  pc = new PlaybackController({ api, audio, mediaSession: null, notify });
  await pc.init({ volume: 0.5, repeat: 'off', shuffle: false, resumeOnLaunch: false, missingTrackBehavior: 'skip' });
});

describe('PlaybackController', () => {
  it('plays a list starting at the chosen index', async () => {
    pc.playTracks([track(1), track(2), track(3)], 1);
    await flush();
    expect(audio.src).toBe('vela-media://track/2');
    expect(pc.getSnapshot()).toMatchObject({ playing: true, index: 1 });
    expect(pc.getSnapshot().current.id).toBe(2);
  });

  it('rapid switching only keeps the last request', async () => {
    pc.playTracks([track(1), track(2), track(3), track(4)], 0);
    pc.next();
    pc.next();
    pc.next();
    await flush();
    expect(audio.src).toBe('vela-media://track/4');
    expect(pc.getSnapshot().current.id).toBe(4);
    expect(pc.getSnapshot().error).toBeNull();
  });

  it('skips unavailable tracks with a notification and never loops forever', async () => {
    pc.playTracks([track(1, { available: false }), track(2, { available: false }), track(3)], 0);
    await flush();
    expect(pc.getSnapshot().current.id).toBe(3);
    expect(notify).toHaveBeenCalledTimes(1); // track 2 is skipped without an attempt (known unavailable)

    pc.playTracks([track(5, { available: false }), track(6, { unsupportedReason: 'ALAC' })], 0);
    await flush();
    expect(pc.getSnapshot().playing).toBe(false);
    expect(pc.getSnapshot().current.id).toBe(5);
    expect(pc.getSnapshot().error.message).toMatch(/unavailable/);
  });

  it('skips tracks whose decoding fails at runtime', async () => {
    audio.failSrc.add('vela-media://track/1');
    pc.playTracks([track(1), track(2)], 0);
    await flush();
    await flush();
    expect(pc.getSnapshot().current.id).toBe(2);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('stops on failure when the setting says so', async () => {
    pc.applySettings({ missingTrackBehavior: 'stop' });
    pc.playTracks([track(1, { available: false }), track(2)], 0);
    await flush();
    expect(pc.getSnapshot().current.id).toBe(1);
    expect(pc.getSnapshot().playing).toBe(false);
  });

  it('advances on ended, then stops at the end without repeat', async () => {
    pc.playTracks([track(1), track(2)], 0);
    await flush();
    audio.emit('ended');
    await flush();
    expect(pc.getSnapshot().current.id).toBe(2);
    audio.paused = true;
    audio.emit('ended');
    await flush();
    expect(pc.getSnapshot().current.id).toBe(2);
    expect(pc.getSnapshot().playing).toBe(false);
  });

  it('repeat one replays the same track on ended', async () => {
    pc.playTracks([track(1), track(2)], 0);
    await flush();
    pc.cycleRepeat();
    pc.cycleRepeat();
    expect(pc.getSnapshot().repeat).toBe('one');
    audio.currentTime = 99;
    audio.emit('ended');
    await flush();
    expect(pc.getSnapshot().current.id).toBe(1);
    expect(audio.currentTime).toBe(0);
    expect(api.settings.set).toHaveBeenCalledWith('repeat', 'one');
  });

  it('previous restarts the track after 3 seconds, otherwise goes back', async () => {
    pc.playTracks([track(1), track(2)], 1);
    await flush();
    audio.duration = 100;
    audio.currentTime = 10;
    pc.previous();
    expect(audio.currentTime).toBe(0);
    expect(pc.getSnapshot().current.id).toBe(2);
    pc.previous();
    await flush();
    expect(pc.getSnapshot().current.id).toBe(1);
  });

  it('records a play after listening long enough', async () => {
    pc.playTracks([track(1, { duration: 20 })], 0);
    await flush();
    for (let t = 0.25; t <= 11; t += 0.25) {
      audio.currentTime = t;
      audio.emit('timeupdate');
    }
    expect(api.history.record).toHaveBeenCalledTimes(1);
    expect(api.history.record.mock.calls[0][0]).toBe(1);
  });

  it('does not count seeking jumps as listening time', async () => {
    pc.playTracks([track(1, { duration: 300 })], 0);
    await flush();
    audio.currentTime = 200;
    audio.emit('timeupdate');
    expect(api.history.record).not.toHaveBeenCalled();
  });

  it('removing the current track from the queue loads the next one', async () => {
    pc.playTracks([track(1), track(2), track(3)], 0);
    await flush();
    pc.removeFromQueue([0]);
    await flush();
    expect(pc.getSnapshot().current.id).toBe(2);
    pc.clearUpcoming();
    expect(pc.getSnapshot().queue.items.map((i) => i.id)).toEqual([2]);
  });

  it('undoing "clear queue" restores upcoming tracks without restarting the current one', async () => {
    pc.playTracks([track(1), track(2), track(3)], 0);
    await flush();
    const playCalls = audio.playCalls.length;
    const snapshot = pc.snapshotQueue();
    pc.clearUpcoming();
    expect(pc.getSnapshot().queue.items.map((i) => i.id)).toEqual([1]);
    pc.restoreQueueState(snapshot);
    expect(pc.getSnapshot().queue.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(pc.getSnapshot().current.id).toBe(1);
    expect(audio.playCalls.length).toBe(playCalls);
  });

  it('seeks relatively and by fraction, clamped to the track', async () => {
    pc.playTracks([track(1)], 0);
    await flush();
    audio.duration = 100;
    audio.currentTime = 10;
    expect(pc.seekBy(5)).toBe(15);
    expect(pc.seekBy(-60)).toBe(0);
    expect(pc.seekToFraction(0.5)).toBe(50);
    expect(pc.seekBy(1000)).toBeCloseTo(99.95);
  });

  it('handles remote commands from the mini-player', async () => {
    pc.playTracks([track(1), track(2)], 0);
    await flush();
    pc.handleCommand({ type: 'toggle' });
    expect(pc.getSnapshot().playing).toBe(false);
    pc.handleCommand({ type: 'next' });
    await flush();
    expect(pc.getSnapshot().current.id).toBe(2);
    pc.handleCommand({ type: 'setVolume', volume: 0.25 });
    expect(audio.volume).toBe(0.25);
  });

  it('publishes a compact state for remote surfaces', async () => {
    pc.playTracks([track(1)], 0);
    await flush();
    await new Promise((r) => setTimeout(r, 80));
    const last = api.player.publish.mock.calls.at(-1)[0];
    expect(last.track).toMatchObject({ id: 1, title: 'T1' });
    expect(last.playing).toBe(true);
    expect(JSON.stringify(last).length).toBeLessThan(20000);
  });

  it('restores the previous session paused at the saved position', async () => {
    const lib = { 1: track(1), 2: track(2) };
    const a2 = new FakeAudio();
    const pc2 = new PlaybackController({ api: makeApi(lib), audio: a2, mediaSession: null });
    await pc2.init({ resumeOnLaunch: true, playbackSession: { trackIds: [1, 2, 99], index: 1, position: 42 } });
    expect(pc2.getSnapshot().current.id).toBe(2);
    expect(pc2.getSnapshot().playing).toBe(false);
    expect(pc2.getSnapshot().queue.items.map((i) => i.id)).toEqual([1, 2]); // unknown id dropped
    a2.emit('loadedmetadata');
    expect(a2.currentTime).toBe(42);
    expect(a2.playCalls).toEqual([]);
  });
});
