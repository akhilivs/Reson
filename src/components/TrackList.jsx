import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Clock3, MoreHorizontal } from 'lucide-react';
import { Artwork, FavButton } from './primitives.jsx';
import { usePlayer, player } from '../hooks/usePlayer.js';
import { useTrackActions } from '../hooks/useTrackActions.js';
import { useSettings } from '../app/SettingsContext.jsx';
import { formatDuration, formatDate } from '../utils/format.js';

/** The main scrolling element; virtualized lists measure against it. */
export const ScrollContext = createContext({ current: null });

const ROW_HEIGHT = 52;
export const TRACKS_MIME = 'application/x-reson-tracks';

/** A small "♪ 3 songs" chip that follows the pointer while dragging. */
function setDragChip(e, sel) {
  const chip = document.createElement('div');
  chip.className = 'drag-chip';
  chip.textContent = sel.length === 1 ? sel[0].title : `${sel.length} songs`;
  document.body.appendChild(chip);
  e.dataTransfer.setDragImage(chip, 14, 14);
  setTimeout(() => chip.remove(), 0);
}
const DISC_HEIGHT = 44;
const OVERSCAN = 10;
const VIRTUALIZE_AFTER = 120;

const COLUMN_DEFS = {
  index: { label: '#', className: 'col-index' },
  title: { label: 'Title', className: 'col-title', sort: 'title' },
  artist: { label: 'Artist', className: 'col-artist', sort: 'artist' },
  album: { label: 'Album', className: 'col-album', sort: 'album' },
  dateAdded: { label: 'Date added', className: 'col-date', sort: 'dateAdded' },
  plays: { label: 'Plays', className: 'col-plays' },
  duration: { label: <Clock3 size={14} aria-label="Duration" />, className: 'col-duration', sort: 'duration' },
};

function useVirtualWindow(count, rowHeights, enabled) {
  const scrollRef = useContext(ScrollContext);
  const bodyRef = useRef(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });

  const offsets = useMemo(() => {
    const o = new Array(count + 1);
    o[0] = 0;
    for (let i = 0; i < count; i++) o[i + 1] = o[i] + rowHeights(i);
    return o;
  }, [count, rowHeights]);

  const update = useCallback(() => {
    const container = scrollRef.current;
    const body = bodyRef.current;
    if (!enabled || !container || !body) {
      setRange({ start: 0, end: count });
      return;
    }
    const top = body.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const viewTop = -top;
    const viewBottom = viewTop + container.clientHeight;
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] < viewTop) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - OVERSCAN);
    let end = lo;
    while (end < count && offsets[end] < viewBottom) end++;
    end = Math.min(count, end + OVERSCAN);
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, [scrollRef, enabled, count, offsets]);

  useLayoutEffect(() => {
    update();
    const container = scrollRef.current;
    if (!container || !enabled) return;
    container.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => {
      container.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update, scrollRef, enabled]);

  const scrollToIndex = useCallback(
    (i) => {
      const container = scrollRef.current;
      const body = bodyRef.current;
      if (!container || !body) return;
      const bodyTop = body.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      const rowTop = bodyTop + offsets[i];
      const rowBottom = rowTop + rowHeights(i);
      const stickyOffset = 48;
      if (rowTop < container.scrollTop + stickyOffset) container.scrollTop = rowTop - stickyOffset;
      else if (rowBottom > container.scrollTop + container.clientHeight) container.scrollTop = rowBottom - container.clientHeight;
    },
    [scrollRef, offsets, rowHeights],
  );

  return { bodyRef, range: enabled ? range : { start: 0, end: count }, offsets, scrollToIndex };
}

/**
 * Virtualized, keyboard-accessible track list.
 * props:
 *  tracks, columns, sort, onSort, onRemove(tracks), removeLabel, onReorder(from, to),
 *  discHeaders (bool), showArt (bool), emptyMessage, label
 */
export function TrackList({
  tracks,
  columns = ['index', 'title', 'artist', 'album', 'duration'],
  sort,
  onSort,
  onRemove,
  removeLabel,
  onReorder,
  discHeaders = false,
  showArt = true,
  label = 'Tracks',
  numbering = 'position',
}) {
  const { settings } = useSettings();
  const { openTrackMenu, setFavorite } = useTrackActions();
  const currentId = usePlayer((s) => s.current?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const [selected, setSelected] = useState(() => new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const anchor = useRef(-1);
  // Only keyboard navigation scrolls the list; scrolling under the pointer would make
  // the second click of a double-click land on a different element.
  const keyboardNav = useRef(false);
  const gridRef = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const dragFrom = useRef(null);

  // Rows: optional disc headers interleaved with tracks.
  const rows = useMemo(() => {
    const showDiscs = discHeaders && new Set(tracks.map((t) => t.discNo ?? 1)).size > 1;
    const out = [];
    let lastDisc = null;
    tracks.forEach((t, i) => {
      const disc = t.discNo ?? 1;
      if (showDiscs && disc !== lastDisc) {
        out.push({ type: 'disc', disc, key: `disc-${disc}` });
        lastDisc = disc;
      }
      out.push({ type: 'track', track: t, index: i, key: t.entryId ? `e${t.entryId}` : `t${t.id}-${i}` });
    });
    return out;
  }, [tracks, discHeaders]);
  const rowIndexOfTrack = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => r.type === 'track' && m.set(r.index, i));
    return m;
  }, [rows]);

  const rowHeights = useCallback((i) => (rows[i]?.type === 'disc' ? DISC_HEIGHT : ROW_HEIGHT), [rows]);
  const virtual = useVirtualWindow(rows.length, rowHeights, rows.length > VIRTUALIZE_AFTER);

  // Reset selection when the list identity changes.
  useEffect(() => {
    setSelected(new Set());
    setFocusIndex(-1);
    anchor.current = -1;
  }, [tracks]);

  const selection = useCallback(() => tracks.filter((_, i) => selected.has(i)), [tracks, selected]);

  const activate = useCallback(
    (index) => {
      const t = tracks[index];
      if (!t) return;
      if (settings.doubleClickBehavior === 'playSingle') player.playTracks([t], 0);
      else if (settings.doubleClickBehavior === 'enqueue') player.enqueue([t]);
      else player.playTracks(tracks, index);
    },
    [tracks, settings.doubleClickBehavior],
  );

  const selectIndex = useCallback(
    (index, { shift = false, toggle = false } = {}) => {
      setSelected((prev) => {
        if (shift && anchor.current >= 0) {
          const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
          const next = toggle ? new Set(prev) : new Set();
          for (let i = a; i <= b; i++) next.add(i);
          return next;
        }
        if (toggle) {
          const next = new Set(prev);
          next.has(index) ? next.delete(index) : next.add(index);
          anchor.current = index;
          return next;
        }
        anchor.current = index;
        return new Set([index]);
      });
      setFocusIndex(index);
    },
    [],
  );

  const onRowMouseDown = (e, index) => {
    if (e.button === 2) {
      if (!selected.has(index)) selectIndex(index);
      return;
    }
    if (e.button !== 0) return;
    selectIndex(index, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
  };

  const onRowContextMenu = (e, index) => {
    const sel = selected.has(index) ? selection() : [tracks[index]];
    openTrackMenu(e, sel, { list: tracks, index, onRemove, removeLabel });
  };

  useEffect(() => {
    if (focusIndex < 0 || !keyboardNav.current) return;
    keyboardNav.current = false;
    const ri = rowIndexOfTrack.get(focusIndex);
    if (ri != null) virtual.scrollToIndex(ri);
    // Focus the row element after it is rendered.
    requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-index="${focusIndex}"]`)?.focus({ preventScroll: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);

  const onKeyDown = (e) => {
    if (!tracks.length) return;
    const cur = focusIndex < 0 ? 0 : focusIndex;
    const move = (to) => {
      e.preventDefault();
      keyboardNav.current = true;
      const idx = Math.max(0, Math.min(tracks.length - 1, to));
      if (e.altKey && onReorder && selected.size <= 1) {
        onReorder(cur, idx);
        anchor.current = idx;
        setSelected(new Set([idx]));
        setFocusIndex(idx);
        return;
      }
      selectIndex(idx, { shift: e.shiftKey });
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(cur + 1);
      case 'ArrowUp':
        return move(cur - 1);
      case 'PageDown':
        return move(cur + 10);
      case 'PageUp':
        return move(cur - 10);
      case 'Home':
        return move(0);
      case 'End':
        return move(tracks.length - 1);
      case 'Enter':
        e.preventDefault();
        if (selected.size > 1) player.playTracks(selection(), 0);
        else activate(cur);
        return;
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setSelected(new Set(tracks.map((_, i) => i)));
        }
        return;
      case 'Escape':
        setSelected(new Set());
        return;
      case 'Delete':
        if (onRemove && selected.size) {
          e.preventDefault();
          onRemove(selection());
        }
        return;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        e.preventDefault();
        if (focusIndex >= 0) {
          const el = gridRef.current?.querySelector(`[data-index="${focusIndex}"]`);
          const rect = el?.getBoundingClientRect();
          const sel = selected.size ? selection() : [tracks[focusIndex]];
          openTrackMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect?.left + 48, clientY: rect?.bottom, currentTarget: el }, sel, {
            list: tracks,
            index: focusIndex,
            onRemove,
            removeLabel,
          });
        }
        return;
      default:
    }
  };

  // Drag-and-drop reordering (playlists).
  // Any song can be dragged onto a sidebar playlist; playlists additionally reorder by drag.
  const dragProps = (index) => ({
    draggable: true,
    onDragStart: (e) => {
      const sel = selected.has(index) ? selection() : [tracks[index]];
      e.dataTransfer.effectAllowed = onReorder ? 'copyMove' : 'copy';
      e.dataTransfer.setData(TRACKS_MIME, JSON.stringify(sel.map((t) => t.id)));
      e.dataTransfer.setData('text/plain', sel.map((t) => `${t.title} — ${t.artist}`).join('\n'));
      setDragChip(e, sel);
      if (onReorder) dragFrom.current = index;
    },
    ...(onReorder
      ? {
          onDragOver: (e) => {
            if (dragFrom.current == null) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > r.top + r.height / 2;
            setDragOver({ index, after });
          },
          onDragLeave: () => setDragOver((d) => (d?.index === index ? null : d)),
          onDrop: (e) => {
            e.preventDefault();
            const from = dragFrom.current;
            const over = dragOver;
            dragFrom.current = null;
            setDragOver(null);
            if (from == null || !over) return;
            let to = over.after ? over.index + 1 : over.index;
            if (from < to) to--;
            if (to !== from) onReorder(from, to);
          },
        }
      : {}),
    onDragEnd: () => {
      dragFrom.current = null;
      setDragOver(null);
    },
  });

  const { start, end } = virtual.range;
  const padTop = virtual.offsets[start] ?? 0;
  const padBottom = (virtual.offsets[rows.length] ?? 0) - (virtual.offsets[end] ?? 0);
  const gridTemplate = columns.map((c) => `var(--${COLUMN_DEFS[c].className})`).join(' ');

  return (
    <div
      ref={gridRef}
      className="track-list"
      role="grid"
      aria-label={label}
      aria-rowcount={tracks.length + 1}
      aria-multiselectable="true"
      style={{ '--grid-template': gridTemplate }}
      onKeyDown={onKeyDown}
    >
      <div className="track-list__head" role="row">
        {columns.map((c) => {
          const def = COLUMN_DEFS[c];
          const active = sort && def.sort === sort.sort;
          return (
            <div key={c} role="columnheader" className={`tl-cell ${def.className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {def.sort && onSort ? (
                <button type="button" className={`tl-sort${active ? ' is-active' : ''}`} onClick={() => onSort(def.sort)}>
                  {def.label}
                  {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </button>
              ) : (
                <span>{def.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <div ref={virtual.bodyRef} className="track-list__body" role="rowgroup">
        <div style={{ height: padTop }} aria-hidden />
        {rows.slice(start, end).map((row) => {
          if (row.type === 'disc') {
            return (
              <div key={row.key} className="tl-disc" role="row">
                <div role="gridcell">Disc {row.disc}</div>
              </div>
            );
          }
          const { track: t, index } = row;
          return (
            <TrackRow
              key={row.key}
              track={t}
              index={index}
              numbering={numbering}
              columns={columns}
              showArt={showArt}
              selected={selected.has(index)}
              focused={focusIndex === index}
              tabbable={focusIndex < 0 ? index === 0 : focusIndex === index}
              isCurrent={currentId === t.id}
              playing={playing}
              dropIndicator={dragOver?.index === index ? (dragOver.after ? 'after' : 'before') : null}
              onMouseDown={onRowMouseDown}
              onDoubleClick={activate}
              onContextMenu={onRowContextMenu}
              onToggleFavorite={(tr) => setFavorite([tr], !tr.favorite)}
              onMore={onRowContextMenu}
              dragProps={dragProps(index)}
            />
          );
        })}
        <div style={{ height: padBottom }} aria-hidden />
      </div>
    </div>
  );
}

function PlayingBars({ playing }) {
  return (
    <span className={`eq-bars${playing ? ' is-playing' : ''}`} aria-label={playing ? 'Now playing' : 'Paused'}>
      <i />
      <i />
      <i />
    </span>
  );
}

const TrackRow = memo(function TrackRow({
  track: t,
  index,
  numbering,
  columns,
  showArt,
  selected,
  focused,
  tabbable,
  isCurrent,
  playing,
  dropIndicator,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onToggleFavorite,
  onMore,
  dragProps,
}) {
  const unavailable = !t.available || !!t.unsupportedReason;
  const cells = {
    index: (
      <div className="tl-cell col-index" role="gridcell">
        {isCurrent ? <PlayingBars playing={playing} /> : <span className="tl-num">{numbering === 'track' ? t.trackNo ?? '–' : index + 1}</span>}
      </div>
    ),
    title: (
      <div className="tl-cell col-title" role="gridcell">
        {showArt && <Artwork hash={t.artHash} size={36} rounded="sm" />}
        <div className="tl-title-text">
          <span className="tl-title" title={t.title}>
            {t.title}
          </span>
          {unavailable && (
            <span className="tl-warning" title={t.unsupportedReason ?? 'File is missing or its drive is disconnected'}>
              <AlertCircle size={12} aria-hidden /> {t.unsupportedReason ? 'Unsupported' : 'Unavailable'}
            </span>
          )}
        </div>
      </div>
    ),
    artist: (
      <div className="tl-cell col-artist tl-muted" role="gridcell" title={t.artist}>
        {t.artist}
      </div>
    ),
    album: (
      <div className="tl-cell col-album tl-muted" role="gridcell" title={t.album}>
        {t.album}
      </div>
    ),
    dateAdded: (
      <div className="tl-cell col-date tl-muted" role="gridcell">
        {formatDate(t.dateAdded)}
      </div>
    ),
    plays: (
      <div className="tl-cell col-plays tl-muted" role="gridcell">
        {t.plays ?? ''}
      </div>
    ),
    duration: (
      <div className="tl-cell col-duration" role="gridcell">
        <FavButton plain className="tl-fav" active={!!t.favorite} onToggle={() => onToggleFavorite(t)} />
        <span className="tl-muted tl-time">{formatDuration(t.duration)}</span>
        <button
          type="button"
          tabIndex={-1}
          className="tl-more"
          aria-label="More actions"
          title="More actions"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMore(e, index);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    ),
  };
  return (
    <div
      className={`tl-row${selected ? ' is-selected' : ''}${isCurrent ? ' is-current' : ''}${unavailable ? ' is-unavailable' : ''}${dropIndicator ? ` drop-${dropIndicator}` : ''}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-index={index}
      onMouseDown={(e) => onMouseDown(e, index)}
      onDoubleClick={(e) => {
        const row = e.currentTarget;
        row.classList.remove('flash');
        void row.offsetWidth; // restart the animation
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 750);
        onDoubleClick(index);
      }}
      onContextMenu={(e) => onContextMenu(e, index)}
      {...dragProps}
    >
      {columns.map((c) => (
        <FragmentKey key={c}>{cells[c]}</FragmentKey>
      ))}
    </div>
  );
});

function FragmentKey({ children }) {
  return children;
}
