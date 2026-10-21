import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Disc3 } from 'lucide-react';
import { Artwork, IconButton, FavButton } from '../../components/primitives.jsx';
import { Vinyl, useTilt } from '../../components/Delights.jsx';
import { TransportControls, SeekBar, VolumeControl } from '../../components/PlayerControls.jsx';
import { QueueList } from '../../components/QueueList.jsx';
import { usePlayer, usePosition, player } from '../../hooks/usePlayer.js';
import { useNavigation } from '../../app/NavigationContext.jsx';
import { api } from '../../services/api.js';
import { artUrl } from '../../services/playbackController.js';
import { formatDuration, trackFormatLabel } from '../../utils/format.js';

export function NowPlaying({ onClose, focus = false, soulKing = false }) {
  const tiltRef = useTilt(5);
  const current = usePlayer((s) => s.current);
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => Math.max(0, s.queue.index));
  const total = usePlayer((s) => s.queue.items.length);
  const { navigate } = useNavigation();
  const [tab, setTab] = useState('queue');
  const ref = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const go = (name, params) => {
    onClose();
    navigate(name, params);
  };

  return (
    <div
      className={`now-playing${playing ? ' is-playing' : ''}${focus ? ' is-focus' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      ref={ref}
      tabIndex={-1}
      style={{ viewTransitionName: 'now-playing' }}
    >
      <div className="now-playing__backdrop" aria-hidden>
        <div className="np-aura np-aura--a" />
        <div className="np-aura np-aura--b" />
        {current?.artHash && <img key={current.artHash} src={artUrl(current.artHash, 'thumb')} alt="" />}
      </div>
      <div className="now-playing__top">
        <IconButton label="Close Now Playing (Esc)" icon={ChevronDown} onClick={onClose} size="lg" />
        <span className="mono-label">Now playing</span>
        <span className="now-playing__top-spacer" />
      </div>

      {!current ? (
        <div className="now-playing__empty">Quiet as a ghost ship. Choose a song from your library to begin.</div>
      ) : (
        <div className="now-playing__body">
          <div className={`now-playing__art${focus ? '' : ' tilt'}`} ref={focus ? undefined : tiltRef} style={{ viewTransitionName: 'np-art' }}>
            {/* In Bankai (focus) mode each new track's artwork fades and settles in. */}
            <div key={focus ? `swap-${current.id}` : 'art'} className={focus ? 'focus-swap' : undefined}>
              {focus ? (
                <Vinyl hash={current.artHash} playing={playing} />
              ) : (
                <Artwork key={current.artHash ?? current.id} hash={current.artHash} kind="full" rounded="md" icon={Disc3} className="np-art-swap" />
              )}
            </div>
          </div>
          <section className="now-playing__column">
            <div className="meta-in" key={current.id}>
            <div className="mono-label">
              {focus && <span className="focus-badge">Bankai · </span>}
              {soulKing && <span className="sk-live">Soul King live · </span>}
              Track {position + 1} of {total}
              {current.lossless ? ' · Lossless' : ''}
            </div>
            <h1 className="now-playing__title" title={current.title}>
              {current.title}
            </h1>
            <div className="now-playing__sub">
              <button type="button" className="link-btn" onClick={() => current.artistId && go('artist', { id: current.artistId })}>
                {current.artist}
              </button>
              <span className="now-playing__sep" aria-hidden>—</span>
              <button type="button" className="link-btn link-btn--muted" onClick={() => current.albumId && go('album', { id: current.albumId })}>
                {current.album}
              </button>
            </div>
            </div>
            <SeekBar className="seek--large" />
            <div className="now-playing__controls">
              <TransportControls size='lg' />
              <div className="now-playing__aux">
                <FavButton size="md" active={!!current.favorite} onToggle={() => player.toggleFavorite()} />
                <VolumeControl />
              </div>
            </div>
            <div className="now-playing__panel-wrap">
              <div className="tabs" role="tablist" aria-label='Now Playing panels'>
                {[
                  ['queue', 'Up next'],
                  ['lyrics', 'Lyrics'],
                  ['details', 'Details'],
                ].map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="now-playing__panel" role="tabpanel">
                {tab === 'queue' && <QueueList compact />}
                {tab === 'lyrics' && <LyricsPanel track={current} />}
                {tab === 'details' && <DetailsPanel track={current} />}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Lyrics from local sources only: sidecar .lrc/.txt next to the file, or embedded tags. */
function LyricsPanel({ track }) {
  const [state, setState] = useState({ loading: true, lyrics: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, lyrics: null });
    api.library
      .lyrics(track.id)
      .then((lyrics) => alive && setState({ loading: false, lyrics }))
      .catch(() => alive && setState({ loading: false, lyrics: null }));
    return () => {
      alive = false;
    };
  }, [track.id]);

  if (state.loading) return <div className="panel-note">Looking for lyrics…</div>;
  if (!state.lyrics) {
    return (
      <div className="panel-note">
        <strong>No lyrics found for this track.</strong>
        <p>
          Reson shows lyrics stored with your music: a <code>.lrc</code> or <code>.txt</code> file with the same name as the audio file, or
          lyrics embedded in the file’s tags. Nothing is downloaded.
        </p>
      </div>
    );
  }
  if (state.lyrics.synced) return <SyncedLyrics lines={state.lyrics.synced} />;
  return <div className="lyrics lyrics--plain">{state.lyrics.plain}</div>;
}

function SyncedLyrics({ lines }) {
  const { position } = usePosition();
  const ref = useRef(null);
  const active = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= position + 0.15) idx = i;
      else break;
    }
    return idx;
  }, [lines, position]);
  // How far through the active line we are (drives the karaoke fill).
  const sung = useMemo(() => {
    if (active < 0) return 0;
    const start = lines[active].time;
    const end = lines[active + 1]?.time ?? start + 4;
    return Math.max(0, Math.min(100, ((position - start) / Math.max(0.5, end - start)) * 100));
  }, [lines, active, position]);

  useEffect(() => {
    const el = ref.current?.querySelector(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: document.documentElement.dataset.reduceMotion === 'true' ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <div className="lyrics lyrics--synced" ref={ref}>
      {lines.map((l, i) => (
        <button
          key={i}
          type="button"
          data-line={i}
          className={`lyrics__line${i === active ? ' is-active' : ''}${i < active ? ' is-past' : ''}`}
          style={i === active ? { '--sung': `${sung}%` } : undefined}
          onClick={() => player.seek(l.time)}
          title={`Jump to ${formatDuration(l.time)}`}
        >
          {l.text || '♪'}
        </button>
      ))}
    </div>
  );
}

function DetailsPanel({ track }) {
  const rows = [
    ['Title', track.title],
    ['Artist', track.artist],
    ['Album', track.album],
    ['Album artist', track.albumArtist],
    ['Track', track.trackNo ? `${track.trackNo}${track.discNo ? ` · Disc ${track.discNo}` : ''}` : null],
    ['Year', track.year],
    ['Genre', track.genre],
    ['Duration', formatDuration(track.duration)],
    ['Format', trackFormatLabel(track)],
    ['Bitrate', track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : null],
    ['Quality', track.lossless ? 'Lossless' : 'Lossy'],
    ['File', track.fileName],
  ].filter(([, v]) => v != null && v !== '');
  return (
    <dl className="details-list">
      {rows.map(([k, v]) => (
        <div key={k} className="details-list__row">
          <dt>{k}</dt>
          <dd title={String(v)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
