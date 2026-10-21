import { useState } from 'react';
import { Play, Shuffle, FolderPlus, Music } from 'lucide-react';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { useLibraryQuery } from '../../app/LibraryContext.jsx';
import { useSettings } from '../../app/SettingsContext.jsx';
import { TrackList } from '../../components/TrackList.jsx';
import { PageHeader, SearchField, useDebounced, SkeletonRows, ErrorBlock, EmptyState } from '../../components/primitives.jsx';
import { formatLongDuration, plural } from '../../utils/format.js';

export function SongsView() {
  const { settings, update } = useSettings();
  const [filter, setFilter] = useState('');
  const search = useDebounced(filter, 180);
  const sort = settings.songsSort ?? { sort: 'title', dir: 'asc' };
  const { data: tracks, error, loading } = useLibraryQuery(
    () => api.library.listTracks({ search, sort: sort.sort, dir: sort.dir, includeUnavailable: settings.showUnavailable }),
    [search, sort.sort, sort.dir, settings.showUnavailable],
  );

  const onSort = (key) => {
    const dir = sort.sort === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'dateAdded' ? 'desc' : 'asc';
    update('songsSort', { sort: key, dir });
  };

  const total = tracks?.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;

  return (
    <div className="view">
      <PageHeader
        title="Songs"
        subtitle={tracks ? `${plural(tracks.length, 'song')} · ${formatLongDuration(total)}` : ' '}
        actions={
          <>
            <SearchField value={filter} onChange={setFilter} placeholder="Filter songs" />
            <button className="btn btn--primary" disabled={!tracks?.length} onClick={() => player.playTracks(tracks, 0, { shuffle: false })}>
              <Play size={16} fill="currentColor" strokeWidth={0} /> Play
            </button>
            <button className="btn btn--secondary" disabled={!tracks?.length} onClick={() => player.playTracks(tracks, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
          </>
        }
      />
      {error && !tracks ? (
        <ErrorBlock error={error} />
      ) : !tracks && loading ? (
        <SkeletonRows count={12} />
      ) : tracks.length === 0 ? (
        search ? (
          <EmptyState icon={Music} title="No matching songs" message={`Nothing in your library matches “${search}”.`} />
        ) : (
          <EmptyState icon={Music} title="No songs yet" message="Add a music folder to start building your library.">
            <button className="btn btn--primary" onClick={() => api.library.addFolders()}>
              <FolderPlus size={16} /> Choose music folders
            </button>
          </EmptyState>
        )
      ) : (
        <TrackList tracks={tracks} columns={['index', 'title', 'artist', 'album', 'dateAdded', 'duration']} sort={sort} onSort={onSort} label="All songs" />
      )}
    </div>
  );
}
