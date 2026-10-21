import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const GROUPS = [
  [
    'Playback',
    [
      ['Space  /  K', 'Play / pause'],
      ['←  /  →', 'Back / forward 5 seconds'],
      ['J  /  L', 'Back / forward 10 seconds'],
      ['Shift ←  /  Shift →', 'Previous / next track (or Ctrl)'],
      ['0 – 9', 'Jump to 0% – 90% of the track'],
      ['Home', 'Restart the track'],
      ['↑  /  ↓', 'Volume up / down'],
      ['M', 'Mute / unmute'],
      ['S  /  R', 'Shuffle / repeat'],
      ['H', 'Heart the current song'],
    ],
  ],
  [
    'Views',
    [
      ['N', 'Now Playing'],
      ['Q', 'Queue'],
      ['F', 'Focus mode (Bankai)'],
    ],
  ],
  [
    'Navigation',
    [
      ['Ctrl K', 'Command palette'],
      ['Ctrl F', 'Search the library'],
      ['Alt ← / Alt →', 'Back / forward'],
      ['Ctrl ,', 'Library & settings'],
      ['Esc', 'Close Now Playing, menus and dialogs'],
    ],
  ],
  [
    'Lists',
    [
      ['↑ ↓  Home  End', 'Move through songs'],
      ['Shift / Ctrl + click', 'Select several songs'],
      ['Ctrl A', 'Select all'],
      ['Enter', 'Play selection'],
      ['Shift F10', 'Song menu'],
      ['Alt ↑ ↓', 'Reorder (playlists and queue)'],
      ['Delete', 'Remove from playlist / queue'],
    ],
  ],
  [
    'App',
    [
      ['?', 'This sheet'],
      ['Ctrl Q', 'Quit Reson'],
    ],
  ],
];

export function ShortcutSheet({ onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shortcuts glass-panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabIndex={-1} ref={ref}>
        <div className="shortcuts__head">
          <h2 id="shortcuts-title" className="shortcuts__title">
            Keyboard shortcuts
          </h2>
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="shortcuts__grid">
          {GROUPS.map(([title, rows], g) => (
            <section key={title} className="rise" style={{ '--i': g }}>
              <h3 className="mono-label">{title}</h3>
              <dl>
                {rows.map(([keys, what]) => (
                  <div key={keys} className="shortcuts__row">
                    <dt>{what}</dt>
                    <dd>
                      <kbd className="kbd">{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
