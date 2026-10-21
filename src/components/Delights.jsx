// Small moments of delight. Most are quiet nods to anime the Reson crew loves:
// One Piece, Bleach, Attack on Titan, JoJo, Ghibli, Dragon Ball, Spy × Family.
// Every animation here respects reduced motion (see motion.css / delight.css).
import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../hooks/usePlayer.js';
import { prefersReducedMotion } from '../app/motion.js';
import logoUrl from '../assets/reson-logo.png';
import { Artwork } from './primitives.jsx';

/** JoJo: when the queue runs out, a "To Be Continued" arrow slides in for a moment. */
export function ToBeContinued() {
  const endedAt = usePlayer((s) => s.endedAt ?? 0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!endedAt || Date.now() - endedAt > 2000) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(t);
  }, [endedAt]);
  if (!visible) return null;
  return (
    <div className="tbc" role="status" aria-label="Queue finished">
      <svg viewBox="0 0 220 44" aria-hidden>
        <path d="M2 22 L26 4 L26 14 L216 14 L216 30 L26 30 L26 40 Z" />
      </svg>
      <span>To Be Continued</span>
    </div>
  );
}

/** Bleach: Senbonzakura — a short burst of drifting petals (used when entering Bankai). */
export function Petals({ count = 26 }) {
  const [petals] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.6 + Math.random() * 2,
      drift: (Math.random() - 0.5) * 30,
      size: 7 + Math.random() * 8,
      spin: (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360),
    })),
  );
  if (prefersReducedMotion()) return null;
  return (
    <div className="petals" aria-hidden>
      {petals.map((p) => (
        <i
          key={p.id}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.7,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.drift}vw`,
            '--spin': `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}

/** Counts up to `value` once when it first appears (library stats). */
export function CountUp({ value, format = (n) => n.toLocaleString(), duration = 900 }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(a + (value - a) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}

/**
 * Light sheen that follows the pointer, plus a gentle 3D tilt. Writes CSS variables only,
 * so React doesn't re-render on mouse move.
 */
export function useTilt(maxDeg = 6) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    const onMove = (e) => {
      if (prefersReducedMotion()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        el.style.setProperty('--rx', `${((0.5 - y) * maxDeg).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${((x - 0.5) * maxDeg).toFixed(2)}deg`);
        el.dataset.tilting = 'true';
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      delete el.dataset.tilting;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [maxDeg]);
  return ref;
}

/** A farewell card shown for a beat before Reson quits: "Mata ashita" (see you later). */
export function Farewell() {
  return (
    <div className="farewell" role="status">
      <span className="farewell__jp" lang="ja">また明日</span>
      <span className="farewell__main">Mata ashita.</span>
      <span className="farewell__sub">See you later</span>
    </div>
  );
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** Calls onUnlock when the Konami code is typed (ignored while typing in inputs). */
export function useKonami(onUnlock) {
  const cb = useRef(onUnlock);
  cb.current = onUnlock;
  useEffect(() => {
    let pos = 0;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // An extra ↑ at the start keeps the sequence alive (↑↑↑↓… still counts).
      if (key === KONAMI[pos]) pos += 1;
      else if (key === 'ArrowUp') pos = pos >= 2 && KONAMI[pos - 1] === 'ArrowUp' ? 2 : 1;
      else pos = 0;
      if (pos === KONAMI.length) {
        pos = 0;
        cb.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * One Piece: the Soul King takes the stage. A short title card when the mode is switched on
 * (click or wait to dismiss).
 */
export function SoulKingIntro({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, prefersReducedMotion() ? 1200 : 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="sk-intro" role="status" onClick={onDone}>
      <div className="sk-intro__notes" aria-hidden>
        {['♪', '♫', '♬', '♪', '♩', '♫', '♬', '♪'].map((n, i) => (
          <i key={i} style={{ '--i': i }}>
            {n}
          </i>
        ))}
      </div>
      <img className="sk-intro__logo" src={logoUrl} alt="" draggable={false} />
      <div className="sk-intro__label">Soul King mode</div>
      <div className="sk-intro__laugh">Yohohoho!</div>
    </div>
  );
}

const NOTE_GLYPHS = ['♪', '♫', '♬', '♩'];

/** Soul King mode: music notes drifting slowly up behind the content, like a concert hall. */
export function SoulKingNotes({ count = 16 }) {
  const [notes] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      glyph: NOTE_GLYPHS[i % NOTE_GLYPHS.length],
      left: 4 + Math.random() * 92,
      size: 14 + Math.random() * 22,
      duration: 14 + Math.random() * 14,
      delay: -Math.random() * 28,
      sway: (Math.random() - 0.5) * 60,
    })),
  );
  return (
    <div className="sk-notes" aria-hidden>
      {notes.map((n) => (
        <i
          key={n.id}
          style={{
            left: `${n.left}%`,
            fontSize: n.size,
            animationDuration: `${n.duration}s`,
            animationDelay: `${n.delay}s`,
            '--sway': `${n.sway}px`,
          }}
        >
          {n.glyph}
        </i>
      ))}
    </div>
  );
}

/**
 * Focus (Bankai) mode: the song's artwork becomes the label of a vinyl record on a turntable.
 * The record spins at 33⅓ RPM while playing and stops when paused; the tonearm swings onto the
 * record when playback starts and lifts away on pause. The light reflection stays still while the
 * record turns underneath it, like real light on vinyl.
 */
export function Vinyl({ hash, playing }) {
  return (
    <div className={`vinyl${playing ? ' is-playing' : ''}`}>
      <div className="vinyl__record">
        <div className="vinyl__grooves" aria-hidden />
        <div className="vinyl__label">
          <Artwork hash={hash} kind="full" rounded="full" />
        </div>
        <div className="vinyl__spindle" aria-hidden />
      </div>
      <div className="vinyl__sheen" aria-hidden />
      <svg className="vinyl__arm" viewBox="0 0 80 420" aria-hidden>
        {/* pivot base */}
        <circle cx="40" cy="40" r="30" fill="#1c1c1c" stroke="#3a3a3a" strokeWidth="2" />
        <circle cx="40" cy="40" r="14" fill="#9a9a9a" />
        <circle cx="40" cy="40" r="5" fill="#d8d8d8" />
        {/* tube */}
        <path d="M40 40 L40 300 L28 345" fill="none" stroke="#d6d6d6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        {/* headshell + stylus */}
        <rect x="10" y="338" width="30" height="44" rx="4" transform="rotate(14 25 360)" fill="#262626" stroke="#4a4a4a" strokeWidth="1.5" />
        <rect x="18" y="376" width="12" height="10" rx="2" transform="rotate(14 25 360)" fill="#e0893a" />
      </svg>
    </div>
  );
}
