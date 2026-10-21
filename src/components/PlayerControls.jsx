import { useState } from 'react';
import { Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { IconButton, Slider } from './primitives.jsx';
import { usePlayer, usePosition, player } from '../hooks/usePlayer.js';
import { formatDuration } from '../utils/format.js';

// Play ⇄ pause morph: both shapes are drawn with two 4-point paths so CSS can interpolate `d`.
const PLAY_PATHS = ['M7 4.5 L13.25 8.25 L13.25 15.75 L7 19.5 Z', 'M13.25 8.25 L19.5 12 L19.5 12 L13.25 15.75 Z'];
const PAUSE_PATHS = ['M6 5 L10 5 L10 19 L6 19 Z', 'M14 5 L18 5 L18 19 L14 19 Z'];

function PlayPauseGlyph({ playing, size }) {
  const paths = playing ? PAUSE_PATHS : PLAY_PATHS;
  return (
    <svg className="pp-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} fill="currentColor" strokeLinejoin="round" style={{ d: `path("${d}")` }} />
      ))}
    </svg>
  );
}

export function PlayPauseButton({ size = 'md' }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading && s.playing === false && !!s.current);
  const hasQueue = usePlayer((s) => s.queue.items.length > 0);
  const px = size === 'lg' ? 28 : size === 'sm' ? 16 : 20;
  return (
    <button
      type="button"
      className={`play-btn play-btn--${size}${loading ? ' is-loading' : ''}`}
      onClick={() => player.toggle()}
      disabled={!hasQueue}
      aria-label={playing ? 'Pause' : 'Play'}
      title={`${playing ? 'Pause' : 'Play'} (Space)`}
    >
      {loading ? <Loader2 size={px} /> : <PlayPauseGlyph playing={playing} size={px} />}
    </button>
  );
}

export function TransportControls({ size = 'md', showModes = true }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const hasQueue = usePlayer((s) => s.queue.items.length > 0);
  const hasNext = usePlayer((s) => s.hasNext);
  const iconSize = size === 'lg' ? 24 : 20;
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;
  const repeatLabel = repeat === 'off' ? 'Repeat: off' : repeat === 'all' ? 'Repeat: all' : 'Repeat: one';
  return (
    <div className={`transport transport--${size}`}>
      {showModes && (
        <IconButton
          label={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
          // Spy × Family: Anya approves of surprises.
          title={shuffle ? 'Shuffle: on · Waku waku!' : 'Shuffle: off'}
          icon={Shuffle}
          active={shuffle}
          aria-pressed={shuffle}
          iconSize={iconSize - 4}
          onClick={() => player.toggleShuffle()}
        />
      )}
      <IconButton label="Previous (Ctrl+Left)" icon={SkipBack} iconSize={iconSize} disabled={!hasQueue} onClick={() => player.previous()} className="transport__skip" />
      <PlayPauseButton size={size} />
      <IconButton label="Next (Ctrl+Right)" icon={SkipForward} iconSize={iconSize} disabled={!hasNext} onClick={() => player.next()} className="transport__skip" />
      {showModes && (
        <IconButton
          label={repeatLabel}
          // Attack on Titan: repeat one, over and over. Tatakae.
          title={repeat === 'one' ? 'Repeat: one · Tatakae, tatakae' : repeatLabel}
          icon={RepeatIcon}
          active={repeat !== 'off'}
          aria-pressed={repeat !== 'off'}
          iconSize={iconSize - 4}
          onClick={() => player.cycleRepeat()}
        />
      )}
    </div>
  );
}

export function SeekBar({ className = '' }) {
  const { position, duration } = usePosition();
  const hasTrack = usePlayer((s) => !!s.current);
  const [preview, setPreview] = useState(null);
  const shown = preview ?? position;
  return (
    <div className={`seek ${className}`}>
      <span className="seek__time">{hasTrack ? formatDuration(shown) : '0:00'}</span>
      <Slider
        className="seek__slider"
        label="Seek"
        value={position}
        max={duration || 0}
        step={5}
        bigStep={30}
        disabled={!hasTrack || !duration}
        onPreview={setPreview}
        onChange={(v) => player.seek(v)}
        formatValue={(v) => `${formatDuration(v)} of ${formatDuration(duration)}`}
        tip={formatDuration}
      />
      <span className="seek__time seek__time--end">{hasTrack ? formatDuration(duration) : '0:00'}</span>
    </div>
  );
}

export function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 0.34 ? Volume : effective < 0.67 ? Volume1 : Volume2;
  return (
    <div className="volume">
      <IconButton label={muted ? 'Unmute' : 'Mute'} icon={Icon} onClick={() => player.toggleMute()} />
      <Slider
        className="volume__slider"
        label="Volume"
        value={effective * 100}
        max={100}
        step={5}
        bigStep={20}
        onPreview={(v) => v != null && player.setVolume(v / 100)}
        onChange={(v) => player.setVolume(v / 100)}
        formatValue={(v) => `${Math.round(v)}%`}
        tip={(v) => `${Math.round(v)}%`}
        onWheel={(dir) => player.setVolume(Math.max(0, Math.min(1, effective + dir * 0.05)))}
      />
    </div>
  );
}

/** Full-width hairline progress that sits on the top edge of the transport bar. */
export function SeekLine() {
  const { position, duration } = usePosition();
  const hasTrack = usePlayer((s) => !!s.current);
  const buffering = usePlayer((s) => !!s.current && s.loading);
  return (
    <Slider
      className={`seek-line${buffering ? ' is-buffering' : ''}`}
      label="Seek"
      value={position}
      max={duration || 0}
      step={5}
      bigStep={30}
      disabled={!hasTrack || !duration}
      onChange={(v) => player.seek(v)}
      formatValue={(v) => `${formatDuration(v)} of ${formatDuration(duration)}`}
      tip={formatDuration}
    />
  );
}

export function TimeCode() {
  const { position, duration } = usePosition();
  const hasTrack = usePlayer((s) => !!s.current);
  return (
    <span className="timecode" aria-hidden>
      <span>{hasTrack ? formatDuration(position) : '0:00'}</span>
      <span className="timecode__sep">/</span>
      <span className="timecode__total">{hasTrack ? formatDuration(duration) : '0:00'}</span>
    </span>
  );
}
