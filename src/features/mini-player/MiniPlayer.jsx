import { useEffect, useRef, useState } from 'react';
import { Heart, Maximize2, Pause, Pin, PinOff, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { Artwork, Slider } from '../../components/primitives.jsx';
import { applyPalette, applyPreferences } from '../../services/themeService.js';
import { formatDuration } from '../../utils/format.js';

const api = window.vela;
const send = (cmd) => api.player.command(cmd).catch(() => {});

/**
 * Remote view of the single playback engine (which runs in the main window).
 * Receives state snapshots via the main process and sends commands back; it owns no audio.
 */
export function MiniPlayer() {
  const [state, setState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [preview, setPreview] = useState(null);
  const stateRef = useRef(null);
  stateRef.current = state;

  useEffect(() => {
    api.player.getState().then((s) => s && setState(s)).catch(() => {});
    api.settings.get().then(setSettings).catch(() => {});
    const offState = api.player.onState(setState);
    const offSettings = api.settings.onChanged(({ key, value }) => setSettings((s) => (s ? { ...s, [key]: value } : s)));
    return () => {
      offState();
      offSettings();
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyPreferences(settings);
    applyPalette(state?.track?.palette ?? null, settings);
  }, [settings, state?.track?.palette]);

  // Interpolate position locally between snapshots (cheap 4 Hz tick, only while playing).
  useEffect(() => {
    if (!state?.playing) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [state?.playing]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('[role="slider"]')) return;
      const st = stateRef.current;
      const live = st ? st.position + (st.playing ? Math.max(0, Date.now() - st.timestamp) / 1000 : 0) : 0;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        send({ type: 'toggle' });
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && st?.track) {
        e.preventDefault();
        if (e.shiftKey || e.ctrlKey) send({ type: e.key === 'ArrowRight' ? 'next' : 'previous' });
        else send({ type: 'seek', position: Math.max(0, Math.min(st.duration || 0, live + (e.key === 'ArrowRight' ? 5 : -5))) });
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && st) {
        e.preventDefault();
        const v = Math.max(0, Math.min(1, (st.muted ? 0 : st.volume) + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
        send({ type: 'setVolume', volume: v });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const track = state?.track;
  const duration = state?.duration ?? 0;
  const position = state
    ? Math.min(duration || Infinity, state.position + (state.playing ? Math.max(0, now - state.timestamp) / 1000 : 0))
    : 0;
  const pinned = settings?.miniAlwaysOnTop ?? true;

  return (
    <div className="mini">
      <div className="mini__art">
        <Artwork hash={track?.artHash} rounded="md" />
      </div>
      <div className="mini__body">
        <div className="mini__top">
          <div className="mini__meta">
            <div className="mini__title" title={track?.title}>
              {track?.title ?? 'Nothing playing'}
            </div>
            <div className="mini__artist" title={state?.error ?? track?.artist}>
              {state?.error ? <span className="text-warning">{state.error}</span> : (track?.artist ?? 'Reson')}
            </div>
          </div>
          <div className="mini__window-btns">
            <button type="button" className="mini-btn" onClick={() => api.settings.set('miniAlwaysOnTop', !pinned)} aria-label={pinned ? 'Don’t keep on top' : 'Keep on top'} title={pinned ? 'Don’t keep on top' : 'Keep on top'}>
              {pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
            <button type="button" className="mini-btn" onClick={() => api.windows.showMain()} aria-label="Open Reson" title="Open Reson">
              <Maximize2 size={14} />
            </button>
            <button type="button" className="mini-btn" onClick={() => api.windows.hideMini()} aria-label="Close mini player" title="Close mini player">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="mini__controls">
          <button
            type="button"
            className={`mini-btn${track?.favorite ? ' is-fav' : ''}`}
            onClick={() => send({ type: 'toggleFavorite' })}
            disabled={!track}
            aria-label={track?.favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={track?.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={15} fill={track?.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="mini-btn mini-btn--lg" onClick={() => send({ type: 'previous' })} disabled={!track} aria-label="Previous" title="Previous">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button type="button" className="mini-play" onClick={() => send({ type: 'toggle' })} disabled={!track} aria-label={state?.playing ? 'Pause' : 'Play'} title={state?.playing ? 'Pause' : 'Play'}>
            {state?.playing ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
          </button>
          <button type="button" className="mini-btn mini-btn--lg" onClick={() => send({ type: 'next' })} disabled={!track || !state?.hasNext} aria-label="Next" title="Next">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <span className="mini__time">
            {formatDuration(preview ?? position)} / {formatDuration(duration)}
          </span>
        </div>
        <Slider
          className="mini__progress"
          label="Seek"
          value={position}
          max={duration}
          step={5}
          disabled={!track || !duration}
          onPreview={setPreview}
          onChange={(v) => send({ type: 'seek', position: v })}
          formatValue={(v) => formatDuration(v)}
        />
      </div>
    </div>
  );
}
