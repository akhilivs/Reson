import { ListMusic, Maximize2, PictureInPicture2, AlertCircle } from 'lucide-react';
import { Artwork, IconButton, FavButton } from './primitives.jsx';
import { TransportControls, VolumeControl, SeekLine, TimeCode } from './PlayerControls.jsx';
import { usePlayer, player } from '../hooks/usePlayer.js';
import { useNavigation } from '../app/NavigationContext.jsx';

export function PlayerBar({ queueOpen, onToggleQueue, onOpenNowPlaying, nowPlayingOpen = false, miniVisible, onToggleMini }) {
  const current = usePlayer((s) => s.current);
  const error = usePlayer((s) => s.error);
  const { navigate } = useNavigation();

  return (
    <footer className="player-bar" aria-label="Playback">
      <SeekLine />
      <div className="player-bar__track">
        {current ? (
          <>
            <button
              type="button"
              className="player-bar__art"
              onClick={onOpenNowPlaying}
              aria-label="Open Now Playing"
              title="Open Now Playing"
              // Shared-element morph into the Now Playing artwork.
              style={{ viewTransitionName: nowPlayingOpen ? 'none' : 'np-art' }}
            >
              <Artwork hash={current.artHash} size={44} rounded="sm" />
            </button>
            <div className="player-bar__meta meta-in" key={current.id}>
              <button type="button" className="player-bar__title link-btn" onClick={onOpenNowPlaying} title={current.title}>
                {current.title}
              </button>
              {error?.trackId === current.id ? (
                <span className="player-bar__error" title={error.message}>
                  <AlertCircle size={12} aria-hidden /> {error.message}
                </span>
              ) : (
                <button
                  type="button"
                  className="player-bar__artist link-btn"
                  onClick={() => current.artistId && navigate('artist', { id: current.artistId })}
                  title={current.artist}
                >
                  {current.artist}
                </button>
              )}
            </div>
            <FavButton active={!!current.favorite} onToggle={() => player.toggleFavorite()} />
          </>
        ) : (
          <div className="player-bar__idle">
            <span className="mono-label">Idle</span> Silence on deck. Choose something to play
          </div>
        )}
      </div>

      <div className="player-bar__center">
        <TransportControls />
      </div>

      <div className="player-bar__right">
        <TimeCode />
        <span className="player-bar__divider" aria-hidden />
        <IconButton label={queueOpen ? 'Hide queue' : 'Show queue'} icon={ListMusic} active={queueOpen} aria-pressed={queueOpen} onClick={onToggleQueue} />
        <IconButton
          label={miniVisible ? 'Hide mini player' : 'Open mini player'}
          icon={PictureInPicture2}
          active={miniVisible}
          aria-pressed={miniVisible}
          onClick={onToggleMini}
          className="hide-narrow"
        />
        <VolumeControl />
        <IconButton label="Now Playing" icon={Maximize2} onClick={onOpenNowPlaying} disabled={!current} />
      </div>
    </footer>
  );
}
