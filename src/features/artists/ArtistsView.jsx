import { useRef, useState } from 'react';
import { Mic2, Play, Shuffle } from 'lucide-react';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { useLibraryQuery } from '../../app/LibraryContext.jsx';
import { ArtistCard, AlbumCard } from '../../components/Cards.jsx';
import { TrackList } from '../../components/TrackList.jsx';
import { Artwork, PageHeader, SearchField, useDebounced, EmptyState, ErrorBlock, SkeletonGrid, SkeletonHero, SkeletonRows } from '../../components/primitives.jsx';
import { DetailBackdrop } from '../../components/DetailBackdrop.jsx';
import { usePageTitle } from '../../app/PageTitleContext.jsx';
import { formatLongDuration, plural, relativeTime } from '../../utils/format.js';

export function ArtistsView() {
  const [filter, setFilter] = useState('');
  const search = useDebounced(filter, 180);
  const { data: artists, error } = useLibraryQuery(() => api.library.listArtists({ search }), [search]);
  return (
    <div className="view">
      <PageHeader
        title="Artists"
        subtitle={artists ? plural(artists.length, 'artist') : ' '}
        actions={<SearchField value={filter} onChange={setFilter} placeholder="Filter artists" />}
      />
      {error && !artists ? (
        <ErrorBlock error={error} />
      ) : !artists ? (
        <SkeletonGrid round />
      ) : !artists.length ? (
        <EmptyState icon={Mic2} title={search ? 'No matching artists' : 'No artists yet'} message={search ? `Nothing matches “${search}”.` : 'Artists appear here once your music is scanned.'} />
      ) : (
        <div className="card-grid card-grid--artists">
          {artists.map((a, i) => (
            <ArtistCard key={a.id} artist={a} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtistDetailView({ id, preview }) {
  const { data: artist, error, loading } = useLibraryQuery(() => api.library.getArtist(id), [id]);
  const heroRef = useRef(null);
  usePageTitle(artist?.name ?? preview?.name ?? null, heroRef);
  if (error) return <ErrorBlock error={error} />;
  if (!artist && loading) {
    // Render the hero from the card's preview so the artwork morph has somewhere to land.
    return preview ? (
      <div className="view">
        <DetailBackdrop hash={preview.artHash} />
        <header className="detail-hero" ref={heroRef}>
          <Artwork hash={preview.artHash} kind="full" rounded="full" className="detail-hero__art" icon={Mic2} style={{ viewTransitionName: 'hero-art' }} />
          <div className="detail-hero__text">
            <div className="eyebrow">Artist</div>
            <h1 className="detail-hero__title">{preview.name}</h1>
          </div>
        </header>
        <SkeletonRows />
      </div>
    ) : (
      <div className="view">
        <SkeletonHero />
        <SkeletonRows />
      </div>
    );
  }
  if (!artist) return <EmptyState title="Artist not found" message="They may have been removed from your library." />;

  const duration = artist.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const heroAlbum = artist.albums.find((a) => a.artHash);
  const heroHash = heroAlbum?.artHash ?? artist.tracks.find((t) => t.artHash)?.artHash;
  const { stats } = artist;

  return (
    <div className="view">
      <DetailBackdrop hash={heroHash} palette={heroAlbum?.palette} />
      <header className="detail-hero" ref={heroRef}>
        <Artwork hash={heroHash} kind="full" rounded="full" className="detail-hero__art" icon={Mic2} style={{ viewTransitionName: 'hero-art' }} />
        <div className="detail-hero__text">
          <div className="eyebrow">Artist</div>
          <h1 className="detail-hero__title">{artist.name}</h1>
          <p className="detail-hero__meta">
            {plural(artist.tracks.length, 'song')} · {plural(artist.albums.length, 'album')} · {formatLongDuration(duration)}
          </p>
          <div className="detail-hero__actions">
            <button className="btn btn--primary" disabled={!artist.tracks.length} onClick={() => player.playTracks(artist.tracks, 0, { shuffle: false })}>
              <Play size={16} fill="currentColor" strokeWidth={0} /> Play
            </button>
            <button className="btn btn--secondary" disabled={!artist.tracks.length} onClick={() => player.playTracks(artist.tracks, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </header>

      {stats.plays > 0 && (
        <div className="stat-row" aria-label="Your listening">
          <div className="stat">
            <div className="stat__value">{stats.plays.toLocaleString()}</div>
            <div className="stat__label">plays</div>
          </div>
          <div className="stat">
            <div className="stat__value">{formatLongDuration(stats.listened)}</div>
            <div className="stat__label">listened</div>
          </div>
          <div className="stat">
            <div className="stat__value">{relativeTime(stats.lastPlayed)}</div>
            <div className="stat__label">last played</div>
          </div>
        </div>
      )}

      {artist.topTracks.length > 0 && (
        <section className="section">
          <h2 className="section-title">Your most played</h2>
          <TrackList tracks={artist.topTracks} columns={['index', 'title', 'album', 'plays', 'duration']} label="Most played" />
        </section>
      )}

      {artist.albums.length > 0 && (
        <section className="section">
          <h2 className="section-title">Albums</h2>
          <div className="card-grid">
            {artist.albums.map((a, i) => (
              <AlbumCard key={a.id} album={a} index={i} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">All songs</h2>
        <TrackList tracks={artist.tracks} columns={['index', 'title', 'album', 'duration']} label={`Songs by ${artist.name}`} />
      </section>
    </div>
  );
}
