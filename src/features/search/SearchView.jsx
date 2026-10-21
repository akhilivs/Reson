import { Search } from 'lucide-react';
import { api } from '../../services/api.js';
import { useLibraryQuery } from '../../app/LibraryContext.jsx';
import { AlbumCard, ArtistCard } from '../../components/Cards.jsx';
import { TrackList } from '../../components/TrackList.jsx';
import { PageHeader, SkeletonRows, EmptyState } from '../../components/primitives.jsx';
import { plural } from '../../utils/format.js';

export function SearchView({ q }) {
  const { data, loading } = useLibraryQuery(() => api.library.search(q ?? ''), [q]);
  const empty = data && !data.tracks.length && !data.albums.length && !data.artists.length;
  return (
    <div className="view">
      <PageHeader title={`Results for “${q}”`} subtitle={data ? `${plural(data.tracks.length, 'song')} · ${plural(data.albums.length, 'album')} · ${plural(data.artists.length, 'artist')}` : ' '} />
      {!data && loading ? (
        <SkeletonRows count={8} />
      ) : empty ? (
        <EmptyState icon={Search} title="No results" message="Try a different spelling, or search by artist, album or file name." />
      ) : (
        <>
          {data.artists.length > 0 && (
            <section className="section">
              <h2 className="section-title">Artists</h2>
              <div className="card-grid card-grid--artists">
                {data.artists.slice(0, 12).map((a, i) => (
                  <ArtistCard key={a.id} artist={a} index={i} />
                ))}
              </div>
            </section>
          )}
          {data.albums.length > 0 && (
            <section className="section">
              <h2 className="section-title">Albums</h2>
              <div className="card-grid">
                {data.albums.slice(0, 12).map((a, i) => (
                  <AlbumCard key={a.id} album={a} index={i} />
                ))}
              </div>
            </section>
          )}
          {data.tracks.length > 0 && (
            <section className="section">
              <h2 className="section-title">Songs</h2>
              <TrackList tracks={data.tracks} columns={['index', 'title', 'artist', 'album', 'duration']} label="Matching songs" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
