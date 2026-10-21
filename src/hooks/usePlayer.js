import { useSyncExternalStore, useRef } from 'react';
import { player } from '../services/player.js';

/** Subscribes to the playback controller. Pass a selector to limit re-renders. */
export function usePlayer(selector = (s) => s) {
  const sel = useRef(selector);
  sel.current = selector;
  return useSyncExternalStore(player.subscribe, () => sel.current(player.getSnapshot()));
}

/** Position/duration only — updates ~4x per second while playing. */
export function usePosition() {
  return useSyncExternalStore(player.subscribePosition, player.getPosition);
}

export { player };
