import { useRef, useState } from 'react';
import { Disc3, Play, Shuffle } from 'lucide-react';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { useLibraryQuery } from '../../app/LibraryContext.jsx';
import { useSettings } from '../../app/SettingsContext.jsx';
import { useNavigation } from '../../app/NavigationContext.jsx';
import { AlbumCard } from '../../components/Cards.jsx';
import { TrackList } from '../../components/TrackList.jsx';
import { Artwork, PageHeader, SearchField, useDebounced, EmptyState, ErrorBlock, SkeletonGrid, SkeletonHero, SkeletonRows } from '../../components/primitives.jsx';
import { DetailBackdrop } from '../../components/DetailBackdrop.jsx';
import { usePageTitle } from '../../app/PageTitleContext.jsx';
import { formatLongDuration, plural } from '../../utils/format.js';

const SORTS = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['year', 'Year'],
  ['dateAdded', 'Recently added'],
];

export function AlbumsView() {
  const { settings, update } = useSettings();
  const [filter, setFilter] = useState('');
  const search = useDebounced(filter, 180);
  const sort = settings.albumsSort ?? 'title';
  const { data: albums, error } = useLibraryQuery(() => api.library.listAlbums({ search, sort }), [search, sort]);

  return (
    <div className="view">
      <PageHeader
        title="Albums"
        subtitle={albums ? plural(albums.length, 'album') : ' '}
        actions={
          <>
            <SearchField value={filter} onChange={setFilter} placeholder="Filter albums" />
            <label className="select">
              <span className="sr-only">Sort albums by</span>
              <select value={sort} onChange={(e) => update('albumsSort', e.target.value)}>
                {SORTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    Sort: {l}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      {error && !albums ? (
        <ErrorBlock error={error} />
      ) : !albums ? (
        <SkeletonGrid />
      ) : !albums.length ? (
        <EmptyState icon={Disc3} title={search ? 'No matching albums' : 'No albums yet'} message={search ? `Nothing matches “${search}”.` : 'Albums appear here once your music folders are scanned.'} />
      ) : (
        <div className="card-grid">
          {albums.map((a, i) => (
            <AlbumCard key={a.id} album={a} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AlbumDetailView({ id, preview }) {
  const { data, error, loading } = useLibraryQuery(() => api.library.getAlbum(id), [id]);
  const heroRef = useRef(null);
  // Until the album loads, render the hero from the preview the card passed along.
  const album = data ?? (loading && preview ? { ...preview, id, tracks: null } : null);
  usePageTitle(album?.title ?? null, heroRef);
  if (error) return <ErrorBlock error={error} />;
  if (!album && loading) return <div className="view"><SkeletonHero /><SkeletonRows /></div>;
  if (!album) return <EmptyState title="Album not found" message="It may have been removed from your library." />;

  const tracks = album.tracks;
  const discs = album.discCount > 1 ? ` · ${album.discCount} discs` : '';
  return (
    <div className="view">
      <DetailBackdrop hash={album.artHash} palette={album.palette} />
      <header className="detail-hero" ref={heroRef}>
        <Artwork hash={album.artHash} kind="full" rounded="lg" className="detail-hero__art" style={{ viewTransitionName: 'hero-art' }} />
        <div className="detail-hero__text">
          <div className="eyebrow">Album</div>
          <h1 className="detail-hero__title">{album.title}</h1>
          <p className="detail-hero__meta">
            <ArtistLink id={album.artistId} name={album.artist} />
            {album.year ? ` · ${album.year}` : ''}
            {tracks && <> · {plural(album.trackCount, 'song')} · {formatLongDuration(album.duration)}{discs}</>}
          </p>
          <div className="detail-hero__actions">
            <button className="btn btn--primary" disabled={!tracks?.length} onClick={() => player.playTracks(tracks, 0, { shuffle: false })}>
              <Play size={16} fill="currentColor" strokeWidth={0} /> Play
            </button>
            <button className="btn btn--secondary" disabled={!tracks?.length} onClick={() => player.playTracks(tracks, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </header>
      {tracks ? (
        <TrackList tracks={tracks} columns={['index', 'title', 'artist', 'duration']} discHeaders showArt={false} numbering="track" label={`Tracks on ${album.title}`} />
      ) : (
        <SkeletonRows count={8} />
      )}
    </div>
  );
}

function ArtistLink({ id, name }) {
  const { navigate } = useNavigation();
  if (!id) return <span>{name}</span>;
  return (
    <button type="button" className="link-btn link-btn--strong" onClick={() => navigate('artist', { id })}>
      {name}
    </button>
  );
}
