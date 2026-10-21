import { useEffect, useRef } from 'react';
import { player } from '../services/player.js';
import { formatDuration } from '../utils/format.js';

/** Shows the on-screen key feedback badge (see KeyFeedback). */
export function osd(text, icon = null) {
  window.dispatchEvent(new CustomEvent('reson:osd', { detail: { text, icon } }));
}

const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
// Places where the arrow keys / Home / End already mean something (lists, sliders, menus).
const ownsVerticalKeys = (el) => !!el?.closest?.('[role="grid"], [role="list"], [role="listbox"], [role="menu"], [role="slider"], [role="tablist"]');
const ownsHorizontalKeys = (el) => !!el?.closest?.('[role="slider"], [role="menu"], [role="tablist"]');
const inModal = (el) => !!el?.closest?.('[role="dialog"] form, .palette');

const VOLUME_STEP = 0.05;

/**
 * Media-player keyboard controls (YouTube / Spotify conventions). Works wherever focus is,
 * except while typing; lists, sliders and menus keep the keys they already use.
 * `actions` supplies UI-level toggles that live in App (queue, Now Playing).
 */
export function useKeyboardControls(actions) {
  const ref = useRef(actions);
  ref.current = actions;

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (e.defaultPrevented || isTyping(el) || inModal(el)) return;
      if (e.altKey || e.metaKey) return; // Alt+arrows navigate / reorder; leave them alone.
      const key = e.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const snap = player.getSnapshot();
      const hasTrack = !!snap.current;
      // preventDefault only (no stopPropagation): other listeners, like the Konami code, still see keys.
      const done = () => e.preventDefault();

      // Ctrl/Shift + ←/→: previous / next track.
      if ((e.ctrlKey || e.shiftKey) && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        if (ownsHorizontalKeys(el)) return;
        done();
        if (key === 'ArrowRight') player.next();
        else player.previous();
        osd(key === 'ArrowRight' ? 'Next track' : 'Previous track', key === 'ArrowRight' ? '⏭' : '⏮');
        return;
      }
      if (e.ctrlKey) return; // other Ctrl shortcuts are handled elsewhere

      switch (lower) {
        case ' ':
        case 'k': {
          if (key === ' ' && el?.closest?.('[role="menu"]')) return; // Space picks a menu item
          // Space works even when a button or row has focus (it would otherwise "click" it).
          done();
          player.toggle();
          osd(snap.playing ? 'Paused' : 'Playing', snap.playing ? '⏸' : '▶');
          return;
        }
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'j':
        case 'l': {
          if ((key === 'ArrowLeft' || key === 'ArrowRight') && ownsHorizontalKeys(el)) return;
          if (!hasTrack) return;
          done();
          const step = lower === 'j' || lower === 'l' ? 10 : 5;
          const dir = key === 'ArrowRight' || lower === 'l' ? 1 : -1;
          const at = player.seekBy(dir * step);
          osd(`${dir > 0 ? '+' : '−'}${step}s · ${formatDuration(at)}`, dir > 0 ? '⏩' : '⏪');
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (ownsVerticalKeys(el)) return;
          done();
          const v = Math.max(0, Math.min(1, (snap.muted ? 0 : snap.volume) + (key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)));
          player.setVolume(v);
          osd(`Volume ${Math.round(v * 100)}%`, v === 0 ? '🔇' : '🔊');
          return;
        }
        case 'm':
          done();
          player.toggleMute();
          osd(snap.muted ? 'Sound on' : 'Muted', snap.muted ? '🔊' : '🔇');
          return;
        case 'Home':
          if (ownsVerticalKeys(el) || !hasTrack) return;
          done();
          player.seek(0);
          osd('Restarted', '⏮');
          return;
        case 's':
          done();
          player.toggleShuffle();
          osd(snap.shuffle ? 'Shuffle off' : 'Shuffle on · waku waku', '🔀');
          return;
        case 'r': {
          done();
          player.cycleRepeat();
          const next = { off: 'Repeat all', all: 'Repeat one · tatakae', one: 'Repeat off' }[snap.repeat];
          osd(next, '🔁');
          return;
        }
        case 'h':
          if (!hasTrack) return;
          done();
          player.toggleFavorite();
          osd(snap.current.favorite ? 'Removed from favorites' : 'Added to favorites', snap.current.favorite ? '♡' : '♥');
          return;
        case 'q':
          done();
          ref.current.toggleQueue?.();
          return;
        case 'n':
          done();
          ref.current.toggleNowPlaying?.();
          return;
        default:
          // 0–9: jump to 0%–90% of the track.
          if (/^[0-9]$/.test(key) && hasTrack && !e.shiftKey) {
            done();
            const at = player.seekToFraction(Number(key) / 10);
            osd(`${Number(key) * 10}% · ${formatDuration(at)}`, '⏱');
          }
      }
    };
    // Buttons "click" on Space key-up; swallow that so Space only plays/pauses.
    const onKeyUp = (e) => {
      if (e.key === ' ' && !isTyping(e.target) && !inModal(e.target) && !e.target?.closest?.('[role="menu"]')) e.preventDefault();
    };
    // Capture phase so Space is handled before a focused button can treat it as a click.
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);
}
