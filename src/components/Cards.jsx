import { Play, Shuffle, Mic2, ListMusic, MoreHorizontal } from 'lucide-react';
import { Artwork } from './primitives.jsx';
import { api } from '../services/api.js';
import { player } from '../services/player.js';
import { toastBus } from '../app/toastBus.js';
import { useNavigation } from '../app/NavigationContext.jsx';
import { useTrackActions } from '../hooks/useTrackActions.js';
import { nameForTransition } from '../app/motion.js';
import { useTilt } from './Delights.jsx';
import { plural } from '../utils/format.js';

async function playAlbum(id, shuffle = false) {
  try {
    const album = await api.library.getAlbum(id);
    if (album?.tracks.length) player.playTracks(album.tracks, 0, { shuffle });
  } catch (err) {
    toastBus.push({ type: 'error', title: 'Could not play album', message: err.message });
  }
}

/** Data the album page can render immediately (before its tracks load), so the art morph lands. */
const albumPreview = (a) => ({ title: a.title, artist: a.artist, artistId: a.artistId, year: a.year, artHash: a.artHash, palette: a.palette });

export function AlbumCard({ album, index = 0 }) {
  const { navigate } = useNavigation();
  const { openTrackMenu } = useTrackActions();
  const tiltRef = useTilt(7);
  const open = (e) => {
    nameForTransition(e?.currentTarget?.closest('.media-card')?.querySelector('.artwork'), 'hero-art');
    navigate('album', { id: album.id, preview: albumPreview(album) });
  };
  const onContextMenu = async (e) => {
    e.preventDefault();
    const target = e.currentTarget;
    const { clientX, clientY } = e;
    const full = await api.library.getAlbum(album.id).catch(() => null);
    if (full?.tracks.length) openTrackMenu({ preventDefault() {}, stopPropagation() {}, clientX, clientY, currentTarget: target }, full.tracks);
  };
  return (
    <div className="media-card rise" style={{ '--i': index }} onContextMenu={onContextMenu}>
      <div className="media-card__art tilt sheen" ref={tiltRef}>
        <button type="button" className="media-card__open" onClick={open} aria-label={`Open album ${album.title}`}>
          <Artwork hash={album.artHash} rounded="md" />
        </button>
        <div className="media-card__actions">
          <button type="button" className="card-action card-action--primary" onClick={() => playAlbum(album.id)} aria-label={`Play ${album.title}`} title="Play">
            <Play size={18} fill="currentColor" strokeWidth={0} />
          </button>
          <button type="button" className="card-action" onClick={() => playAlbum(album.id, true)} aria-label={`Shuffle ${album.title}`} title="Shuffle">
            <Shuffle size={15} />
          </button>
        </div>
      </div>
      <button type="button" className="media-card__title link-btn" onClick={open} title={album.title}>
        {album.title}
      </button>
      <div className="media-card__sub" title={album.artist}>
        {album.artist}
        {album.year ? ` · ${album.year}` : ''}
      </div>
    </div>
  );
}

export function ArtistCard({ artist, index = 0 }) {
  const { navigate } = useNavigation();
  const open = (e) => {
    nameForTransition(e?.currentTarget?.closest('.media-card')?.querySelector('.artwork'), 'hero-art');
    navigate('artist', { id: artist.id, preview: { name: artist.name, artHash: artist.artHash } });
  };
  return (
    <div className="media-card media-card--artist rise" style={{ '--i': index }}>
      <button type="button" className="media-card__open" onClick={open} aria-label={`Open artist ${artist.name}`}>
        <Artwork hash={artist.artHash} rounded="full" icon={Mic2} />
      </button>
      <button type="button" className="media-card__title link-btn" onClick={open} title={artist.name}>
        {artist.name}
      </button>
      <div className="media-card__sub">
        {plural(artist.trackCount, 'song')}
        {artist.albumCount ? ` · ${plural(artist.albumCount, 'album')}` : ''}
      </div>
    </div>
  );
}

export function PlaylistCard({ playlist, onMenu, smart, index = 0 }) {
  const { navigate } = useNavigation();
  const open = () => navigate('playlist', smart ? { smart: playlist.key } : { id: playlist.id });
  const hashes = playlist.artHashes ?? [];
  const Icon = playlist.icon ?? ListMusic;
  return (
    <div className="media-card media-card--playlist rise" style={{ '--i': index }}>
      <div className="media-card__art">
        <button type="button" className="media-card__open" onClick={open} aria-label={`Open playlist ${playlist.name}`}>
          {hashes.length >= 4 ? (
            <div className="mosaic">
              {hashes.slice(0, 4).map((h) => (
                <Artwork key={h} hash={h} rounded="none" />
              ))}
            </div>
          ) : hashes.length ? (
            <Artwork hash={hashes[0]} rounded="md" />
          ) : (
            <div className={`playlist-tile${smart ? ' playlist-tile--smart' : ''}`}>
              <Icon size={34} strokeWidth={1.5} aria-hidden />
            </div>
          )}
        </button>
        {onMenu && (
          <div className="media-card__actions">
            <button type="button" className="card-action" onClick={(e) => onMenu(e, playlist)} aria-label={`More actions for ${playlist.name}`} title="More actions">
              <MoreHorizontal size={16} />
            </button>
          </div>
        )}
      </div>
      <button type="button" className="media-card__title link-btn" onClick={open} title={playlist.name}>
        {playlist.name}
      </button>
      <div className="media-card__sub">{playlist.subtitle ?? plural(playlist.trackCount ?? 0, 'track')}</div>
    </div>
  );
}

/** Horizontal row of cards with a section heading. */
export function Shelf({ title, action, children }) {
  return (
    <section className="shelf">
      <div className="shelf__head">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      <div className="shelf__row">{children}</div>
    </section>
  );
}
