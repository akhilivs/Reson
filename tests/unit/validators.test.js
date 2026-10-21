import { describe, it, expect } from 'vitest';
import * as v from '../../electron/ipc/validators.js';

describe('IPC validators', () => {
  it('accepts positive integer ids only', () => {
    expect(v.id(5)).toBe(5);
    for (const bad of [0, -1, 1.5, '5', null, undefined, NaN, {}, 2 ** 60]) {
      expect(() => v.id(bad)).toThrow(v.ValidationError);
    }
  });

  it('validates id lists with bounds', () => {
    expect(v.idList([1, 2])).toEqual([1, 2]);
    expect(() => v.idList('1,2')).toThrow();
    expect(() => v.idList([1, 'x'])).toThrow();
    expect(() => v.idList([], { min: 1 })).toThrow();
    expect(() => v.idList([1, 2, 3], { max: 2 })).toThrow();
  });

  it('whitelists sort columns (prevents SQL injection via ORDER BY)', () => {
    expect(v.trackQuery({ sort: 'artist', dir: 'desc' })).toMatchObject({ sort: 'artist', dir: 'desc' });
    expect(() => v.trackQuery({ sort: 'title; DROP TABLE tracks' })).toThrow();
    expect(() => v.trackQuery({ dir: 'sideways' })).toThrow();
    expect(v.trackQuery(undefined)).toMatchObject({ sort: 'title', dir: 'asc', search: '' });
  });

  it('validates playlist names', () => {
    expect(v.playlistName('  Chill  ')).toBe('Chill');
    expect(() => v.playlistName('   ')).toThrow();
    expect(() => v.playlistName('x'.repeat(200))).toThrow();
    expect(() => v.playlistName(42)).toThrow();
  });

  it('rejects unknown settings and invalid values', () => {
    expect(() => v.settingKey('__proto__')).toThrow();
    expect(() => v.settingKey('nodeIntegration')).toThrow();
    expect(v.settingValue('volume', 0.5)).toBe(0.5);
    expect(() => v.settingValue('volume', 3)).toThrow();
    expect(() => v.settingValue('repeat', 'forever')).toThrow();
    expect(v.settingValue('accentColor', '#AABBCC')).toBe('#aabbcc');
    expect(() => v.settingValue('accentColor', 'red; background:url(x)')).toThrow();
  });

  it('fills defaults and drops corrupt stored settings', () => {
    const s = v.settingsWithDefaults({ volume: 9, repeat: 'all' });
    expect(s.volume).toBe(0.8);
    expect(s.repeat).toBe('all');
    expect(s.dynamicAccent).toBe(true);
  });

  it('validates the persisted playback session', () => {
    const ok = v.settingValue('playbackSession', { trackIds: [1, 2], index: 1, position: 12.5 });
    expect(ok).toEqual({ trackIds: [1, 2], originalTrackIds: null, index: 1, position: 12.5 });
    expect(v.settingValue('playbackSession', null)).toBeNull();
    expect(() => v.settingValue('playbackSession', { trackIds: ['a'] })).toThrow();
  });

  it('only allows known player commands', () => {
    expect(v.playerCommand({ type: 'next' })).toEqual({ type: 'next' });
    expect(v.playerCommand({ type: 'seek', position: 10, extra: 'x' })).toEqual({ type: 'seek', position: 10 });
    expect(() => v.playerCommand({ type: 'eval' })).toThrow();
    expect(() => v.playerCommand({ type: 'setVolume', volume: 2 })).toThrow();
  });

  it('bounds the size of published player state', () => {
    expect(() => v.playerState({ blob: 'x'.repeat(30000) })).toThrow();
    expect(v.playerState({ playing: true })).toEqual({ playing: true });
  });
});
