import { useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, X, AlertCircle } from 'lucide-react';
import { Artwork } from './primitives.jsx';
import { usePlayer, player } from '../hooks/usePlayer.js';
import { formatDuration } from '../utils/format.js';
import { toastBus } from '../app/toastBus.js';

const ROW = 56;
const OVERSCAN = 8;

/**
 * The live play queue: current track + up next. Virtualized inside its own scroll container,
 * reorderable by drag or Alt+Arrow, removable per item.
 */
export function QueueList({ compact = false }) {
  const queue = usePlayer((s) => s.queue);
  const tracks = usePlayer((s) => s.tracks);
  const playing = usePlayer((s) => s.playing);
  const scrollRef = useRef(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [drag, setDrag] = useState(null);
  const dragFrom = useRef(null);

  // Show the current track and what follows it.
  const start = Math.max(0, queue.index);
  const upcoming = queue.items.slice(start);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  if (!queue.items.length) {
    return <div className="queue-empty">The stage is empty. Play something, or use “Add to queue” from any track’s menu.</div>;
  }

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(upcoming.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);

  const onKeyDown = (e, pos) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const to = pos + (e.key === 'ArrowUp' ? -1 : 1);
      if (to <= queue.index || to >= queue.items.length) return;
      player.moveInQueue(pos, to);
      requestAnimationFrame(() => scrollRef.current?.querySelector(`[data-pos="${to}"]`)?.focus());
    } else if (e.key === 'Delete') {
      e.preventDefault();
      player.removeFromQueue([pos]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      player.jumpTo(pos);
    }
  };

  return (
    <div ref={scrollRef} className={`queue-list${compact ? ' queue-list--compact' : ''}`} role="list" aria-label="Play queue">
      <div style={{ height: upcoming.length * ROW, position: 'relative' }}>
        {upcoming.slice(first, last).map((item, i) => {
          const pos = start + first + i;
          const t = tracks.get(item.id);
          const isCurrent = pos === queue.index;
          const unavailable = t && (!t.available || t.unsupportedReason);
          return (
            <div
              key={item.qid}
              role="listitem"
              tabIndex={0}
              data-pos={pos}
              className={`queue-item${isCurrent ? ' is-current' : ''}${unavailable ? ' is-unavailable' : ''}${drag?.pos === pos ? ` drop-${drag.after ? 'after' : 'before'}` : ''}`}
              style={{ top: (first + i) * ROW }}
              onDoubleClick={() => player.jumpTo(pos)}
              onKeyDown={(e) => onKeyDown(e, pos)}
              aria-label={`${t?.title ?? 'Unknown track'} by ${t?.artist ?? 'unknown artist'}${isCurrent ? ', now playing' : ''}`}
              draggable={!isCurrent}
              onDragStart={(e) => {
                dragFrom.current = pos;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(pos));
              }}
              onDragOver={(e) => {
                if (dragFrom.current == null || pos <= queue.index) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDrag({ pos, after: e.clientY > r.top + r.height / 2 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                const d = drag;
                setDrag(null);
                if (from == null || !d) return;
                let to = d.after ? d.pos + 1 : d.pos;
                if (from < to) to--;
                if (to > queue.index && to !== from) player.moveInQueue(from, to);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDrag(null);
              }}
            >
              {!isCurrent ? <GripVertical size={14} className="queue-item__grip" aria-hidden /> : <span className="queue-item__grip" />}
              <Artwork hash={t?.artHash} size={40} rounded="sm" />
              <div className="queue-item__meta">
                <div className="queue-item__title">
                  {isCurrent && <span className={`eq-bars eq-bars--sm${playing ? ' is-playing' : ''}`} aria-hidden><i /><i /><i /></span>}
                  <span>{t?.title ?? 'Loading…'}</span>
                </div>
                <div className="queue-item__artist">
                  {unavailable ? (
                    <span className="tl-warning"><AlertCircle size={11} aria-hidden /> Unavailable</span>
                  ) : (
                    t?.artist
                  )}
                </div>
              </div>
              <span className="queue-item__time">{formatDuration(t?.duration)}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm queue-item__remove"
                aria-label="Remove from queue"
                title="Remove from queue"
                tabIndex={-1}
                onClick={() => player.removeFromQueue([pos])}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function QueueDrawer({ onClose }) {
  const count = usePlayer((s) => Math.max(0, s.queue.items.length - Math.max(0, s.queue.index) - 1));
  return (
    <aside className="queue-drawer glass-panel" aria-label="Queue">
      <div className="queue-drawer__head">
        <div>
          <h2 className="section-title">Queue</h2>
          <div className="meta-text">{count ? `${count} up next` : 'Nothing up next'}</div>
        </div>
        <div className="queue-drawer__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const before = player.snapshotQueue();
              player.clearUpcoming();
              toastBus.push({ title: `Cleared ${count} from the queue`, action: { label: 'Undo', run: () => player.restoreQueueState(before) } });
            }}
            disabled={!count}
          >
            Clear
          </button>
          <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Close queue" title="Close queue">
            <X size={16} />
          </button>
        </div>
      </div>
      <QueueList />
      <div className="queue-drawer__hint">Drag or Alt+↑/↓ to reorder · Delete to remove</div>
    </aside>
  );
}
