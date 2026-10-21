import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Disc3, Heart, Loader2, Music2 } from 'lucide-react';
import { artUrl } from '../services/playbackController.js';
import { usePageTitle } from '../app/PageTitleContext.jsx';
import { toastBus } from '../app/toastBus.js';

/** Album artwork with a graceful placeholder when missing or failing to load. */
export function Artwork({ hash, kind = 'thumb', size, alt = '', className = '', rounded = 'md', icon: Icon = Music2, style: extraStyle }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [hash]);
  const style = size || extraStyle ? { ...(size ? { width: size, height: size } : null), ...extraStyle } : undefined;
  const src = artUrl(hash, kind);
  return (
    <div className={`artwork artwork--${rounded} ${className}`} style={style}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="artwork__placeholder" aria-hidden>
          <Icon size={size ? Math.max(14, Math.round(size * 0.34)) : 32} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

export const IconButton = forwardRef(function IconButton(
  { label, icon: Icon, onClick, active = false, size = 'md', iconSize, className = '', disabled, variant, ...rest },
  ref,
) {
  const px = iconSize ?? (size === 'sm' ? 16 : size === 'lg' ? 22 : 18);
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn icon-btn--${size}${active ? ' is-active' : ''}${variant ? ` icon-btn--${variant}` : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={typeof active === 'boolean' && rest['aria-pressed'] !== undefined ? active : undefined}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <Icon size={px} aria-hidden />
    </button>
  );
});

/**
 * Accessible slider (seek bar / volume). Pointer drag shows a preview value and commits on release,
 * so seeking doesn't hammer the audio element. Arrow keys / Home / End work when focused.
 * tip(value) renders a floating label under the pointer while hovering or dragging.
 * onWheel(direction) lets the mouse wheel nudge the value (+1 up, -1 down).
 */
export function Slider({ value, max, onChange, onPreview, label, step = 1, bigStep = 10, formatValue, tip, onWheel, className = '', disabled }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  const valueAt = useCallback(
    (clientX) => {
      const r = ref.current.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * max;
    },
    [max],
  );

  const onPointerDown = (e) => {
    if (disabled || !max) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valueAt(e.clientX);
    setDrag(v);
    onPreview?.(v);
  };
  const onPointerMove = (e) => {
    if (tip && !disabled && max) setHover(valueAt(e.clientX));
    if (drag === null) return;
    const v = valueAt(e.clientX);
    setDrag(v);
    onPreview?.(v);
  };
  const onPointerUp = (e) => {
    if (drag === null) return;
    const v = valueAt(e.clientX);
    setDrag(null);
    onPreview?.(null);
    onChange(v);
  };
  const onKeyDown = (e) => {
    if (disabled || !max) return;
    const map = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + bigStep,
      PageDown: value - bigStep,
      Home: 0,
      End: max,
    };
    if (e.key in map) {
      e.preventDefault();
      e.stopPropagation();
      onChange(Math.min(max, Math.max(0, map[e.key])));
    }
  };

  return (
    <div
      ref={ref}
      className={`slider${drag !== null ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''} ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max) || 0}
      aria-valuenow={Math.round(shown) || 0}
      aria-valuetext={formatValue ? formatValue(shown) : undefined}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        onPreview?.(null);
      }}
      onPointerLeave={() => setHover(null)}
      onWheel={
        onWheel && !disabled
          ? (e) => {
              if (e.deltaY) onWheel(e.deltaY < 0 ? 1 : -1);
            }
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      <div className="slider__track">
        <div className="slider__fill" style={{ width: `${pct}%` }} />
        {hover !== null && drag === null && <div className="slider__hover" style={{ width: `${(hover / max) * 100}%` }} />}
      </div>
      <div className="slider__thumb" style={{ left: `${pct}%` }} />
      {tip && (hover !== null || drag !== null) && (
        <div className="slider__tip" style={{ left: `${((drag ?? hover) / max) * 100}%` }} aria-hidden>
          {tip(drag ?? hover)}
        </div>
      )}
    </div>
  );
}

/** Heart toggle that pops (with a ring burst) only at the moment something becomes a favorite. */
export function FavButton({ active, onToggle, size = 'sm', className = '', plain = false }) {
  const [pop, setPop] = useState(false);
  const prev = useRef(active);
  useEffect(() => {
    if (active && !prev.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 650);
      prev.current = active;
      return () => clearTimeout(t);
    }
    prev.current = active;
  }, [active]);
  const label = active ? 'Remove from favorites' : 'Add to favorites';
  const cls = `${className}${active ? (plain ? ' is-active' : ' is-fav') : ''}${pop ? ' just-faved' : ''}`;
  if (plain) {
    return (
      <button
        type="button"
        tabIndex={-1}
        className={cls}
        aria-label={label}
        title={label}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <Heart size={15} fill={active ? 'currentColor' : 'none'} />
      </button>
    );
  }
  return <HoldableHeart label={label} size={size} cls={cls} active={active} onToggle={onToggle} />;
}

/**
 * Attack on Titan: press and hold the heart to dedicate it — "Shinzou wo sasageyo!".
 * A normal click still just toggles.
 */
function HoldableHeart({ label, size, cls, active, onToggle }) {
  const timer = useRef(null);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);
  const [salute, setSalute] = useState(false);
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      label={label}
      icon={Heart}
      size={size}
      className={`fav-btn ${cls}${holding ? ' is-holding' : ''}${salute ? ' sasageyo' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        setHolding(true);
        timer.current = setTimeout(() => {
          held.current = true;
          setHolding(false);
          setSalute(true);
          setTimeout(() => setSalute(false), 950);
          if (!active) onToggle();
          toastBus.push({ title: 'Shinzou wo sasageyo!', message: 'Heart dedicated.' });
        }, 650);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onToggle();
      }}
    />
  );
}

/** Shimmering placeholders shaped like the content that is loading. */
export function SkeletonGrid({ count = 12, round = false }) {
  return (
    <div className="card-grid skeleton-wrap" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="media-card">
          <div className="skeleton" style={{ aspectRatio: '1', borderRadius: round ? '50%' : undefined }} />
          <div className="skeleton" style={{ height: 12, width: '70%', marginTop: 12 }} />
          <div className="skeleton" style={{ height: 10, width: '45%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 10 }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton" style={{ width: 36, height: 36 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 12, width: `${40 + ((i * 37) % 35)}%` }} />
            <div className="skeleton" style={{ height: 10, width: `${20 + ((i * 23) % 20)}%`, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="detail-hero skeleton-wrap" aria-busy="true" aria-label="Loading">
      <div className="skeleton detail-hero__art" style={{ aspectRatio: '1' }} />
      <div className="detail-hero__text" style={{ gap: 12 }}>
        <div className="skeleton" style={{ height: 10, width: 80 }} />
        <div className="skeleton" style={{ height: 48, width: '60%' }} />
        <div className="skeleton" style={{ height: 12, width: '35%' }} />
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Disc3, title, message, children }) {
  return (
    <div className="empty-state">
      {/* Ghibli: soot sprites keep empty pages company. */}
      <span className="soot" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <div className="empty-state__icon">
        <Icon size={28} strokeWidth={1.5} aria-hidden />
      </div>
      <h2 className="empty-state__title">{title}</h2>
      {message && <p className="empty-state__message">{message}</p>}
      {children && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}

export function Spinner({ size = 18, label = 'Loading' }) {
  return <Loader2 className="spinner" size={size} aria-label={label} role="status" />;
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <EmptyState title="Something went wrong" message={error?.message ?? String(error)}>
      {onRetry && (
        <button className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </EmptyState>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }) {
  const ref = useRef(null);
  usePageTitle(typeof title === 'string' ? title : null, ref);
  return (
    <header className="page-header" ref={ref}>
      <div className="page-header__text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search', inputRef, autoFocus, label, shortcut }) {
  return (
    <label className="search-field">
      <span className="sr-only">{label ?? placeholder}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {shortcut && !value && <kbd className="kbd">{shortcut}</kbd>}
    </label>
  );
}

export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
