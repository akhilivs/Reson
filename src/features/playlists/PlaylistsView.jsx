import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Heart, History, ListMusic, Pencil, Play, Plus, Shuffle, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { toastBus } from '../../app/toastBus.js';
import { useLibrary, useLibraryQuery } from '../../app/LibraryContext.jsx';
import { useNavigation } from '../../app/NavigationContext.jsx';
import { useDialog, useContextMenu } from '../../app/Overlays.jsx';
import { useTrackActions } from '../../hooks/useTrackActions.js';
import { PlaylistCard } from '../../components/Cards.jsx';
import { TrackList } from '../../components/TrackList.jsx';
import { Artwork, PageHeader, EmptyState, ErrorBlock, IconButton, SkeletonHero, SkeletonRows } from '../../components/primitives.jsx';
import { DetailBackdrop } from '../../components/DetailBackdrop.jsx';
import { usePageTitle } from '../../app/PageTitleContext.jsx';
import { formatLongDuration, plural } from '../../utils/format.js';

/** System collections are dynamic (computed from your library and history); they can't be edited. */
export const SMART = [
  { key: 'favorites', name: 'Favorites', icon: Heart, subtitle: 'Songs you’ve hearted' },
  { key: 'recentlyPlayed', name: 'Recently Played', icon: History, subtitle: 'Your last 100 songs' },
  { key: 'recentlyAdded', name: 'Recently Added', icon: Clock, subtitle: 'Newest 100 in your library' },
  { key: 'mostPlayed', name: 'Most Played', icon: TrendingUp, subtitle: 'Your top 100' },
];

export function usePlaylistActions() {
  const dialog = useDialog();
  const { refresh } = useLibrary();
  const { navigate } = useNavigation();

  const rename = useCallback(
    async (p) => {
      const name = await dialog.prompt({ title: 'Rename playlist', label: 'Playlist name', initial: p.name, confirmLabel: 'Rename' });
      if (!name || name === p.name) return;
      try {
        await api.playlists.rename(p.id, name);
        refresh();
      } catch (err) {
        toastBus.push({ type: 'error', title: 'Could not rename playlist', message: err.message });
      }
    },
    [dialog, refresh],
  );

  const remove = useCallback(
    async (p, { thenNavigate = false } = {}) => {
      const ok = await dialog.confirm({
        title: `Delete “${p.name}”?`,
        message: `This removes the playlist${p.trackCount ? ` and its ${plural(p.trackCount, 'entry', 'entries')}` : ''}. Your music files are not affected. This can’t be undone.`,
        confirmLabel: 'Delete playlist',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.playlists.remove(p.id);
        toastBus.push({ title: `Deleted “${p.name}”` });
        refresh();
        if (thenNavigate) navigate('playlists');
      } catch (err) {
        toastBus.push({ type: 'error', title: 'Could not delete playlist', message: err.message });
      }
    },
    [dialog, refresh, navigate],
  );

  return { rename, remove };
}

export function PlaylistsView() {
  const { playlists } = useLibrary();
  const { createPlaylist } = useTrackActions();
  const { rename, remove } = usePlaylistActions();
  const openMenu = useContextMenu();
  const { navigate } = useNavigation();

  const playPlaylist = async (p) => {
    const full = await api.playlists.get(p.id);
    if (full?.tracks.length) player.playTracks(full.tracks, 0);
  };
  const menuFor = (e, p) =>
    openMenu(e, [
      { label: 'Play', icon: Play, onSelect: () => playPlaylist(p), disabled: !p.trackCount },
      { label: 'Rename…', icon: Pencil, onSelect: () => rename(p) },
      { type: 'separator' },
      { label: 'Delete…', icon: Trash2, danger: true, onSelect: () => remove(p) },
    ]);

  return (
    <div className="view">
      <PageHeader
        title="Playlists"
        subtitle={plural(playlists.length, 'playlist')}
        actions={
          <button
            className="btn btn--primary"
            onClick={async () => {
              const id = await createPlaylist([]);
              if (id) navigate('playlist', { id });
            }}
          >
            <Plus size={16} /> New playlist
          </button>
        }
      />
      <section className="section">
        <h2 className="section-title">
          <Sparkles size={16} aria-hidden className="section-title__icon" /> Smart collections
        </h2>
        <p className="section-note">Updated automatically from your library and listening history.</p>
        <div className="card-grid">
          {SMART.map((s, i) => (
            <PlaylistCard key={s.key} smart playlist={{ ...s, artHashes: [] }} index={i} />
          ))}
        </div>
      </section>
      <section className="section">
        <h2 className="section-title">Your playlists</h2>
        {playlists.length ? (
          <div className="card-grid">
            {playlists.map((p, i) => (
              <div key={p.id} onContextMenu={(e) => menuFor(e, p)}>
                <PlaylistCard playlist={p} onMenu={menuFor} index={i + SMART.length} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ListMusic} title="No playlists yet" message="Create one here, or right-click any song and choose “Add to playlist”." />
        )}
      </section>
    </div>
  );
}

export function PlaylistDetailView({ id, smart }) {
  const smartDef = smart ? SMART.find((s) => s.key === smart) : null;
  const { data, error, loading } = useLibraryQuery(() => (smart ? api.playlists.smart(smart) : api.playlists.get(id)), [id, smart]);
  const [tracks, setTracks] = useState(null);
  const { rename, remove } = usePlaylistActions();
  const { refresh } = useLibrary();
  const { setFavorite } = useTrackActions();
  const heroRef = useRef(null);
  usePageTitle(data?.name ?? null, heroRef);

  useEffect(() => setTracks(data?.tracks ?? null), [data]);

  if (error) return <ErrorBlock error={error} />;
  if (!data && loading) return <div className="view"><SkeletonHero /><SkeletonRows /></div>;
  if (!data || !tracks) return <EmptyState title="Playlist not found" message="It may have been deleted." />;

  const duration = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const artTrack = tracks.find((t) => t.artHash);
  const art = artTrack?.artHash;
  const Icon = smartDef?.icon ?? ListMusic;

  const onReorder = smart
    ? undefined
    : async (from, to) => {
        const next = [...tracks];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setTracks(next); // optimistic
        try {
          await api.playlists.reorder(id, next.map((t) => t.entryId));
        } catch (err) {
          toastBus.push({ type: 'error', title: 'Could not reorder', message: err.message });
          refresh();
        }
      };

  const onRemove = smart
    ? smart === 'favorites'
      ? (sel) => setFavorite(sel, false)
      : undefined
    : async (sel) => {
        const originalOrder = tracks.map((t) => t.entryId);
        const removed = new Set(sel.map((t) => t.entryId));
        try {
          await api.playlists.removeEntries(id, sel.map((t) => t.entryId));
          refresh();
          toastBus.push({
            title: `Removed ${plural(sel.length, 'track')} from “${data.name}”`,
            action: {
              label: 'Undo',
              run: async () => {
                // Re-add, then put the new entries back exactly where the old ones were.
                const removedInOrder = tracks.filter((t) => removed.has(t.entryId));
                await api.playlists.addTracks(id, removedInOrder.map((t) => t.id));
                const fresh = await api.playlists.get(id);
                const restored = fresh.tracks.slice(-removedInOrder.length).map((t) => t.entryId);
                let k = 0;
                const order = originalOrder.map((eid) => (removed.has(eid) ? restored[k++] : eid));
                await api.playlists.reorder(id, order);
                refresh();
              },
            },
          });
        } catch (err) {
          toastBus.push({ type: 'error', title: 'Could not remove tracks', message: err.message });
        }
      };

  const playlistInfo = { id, name: data.name, trackCount: tracks.length };

  return (
    <div className="view">
      <DetailBackdrop hash={art} palette={artTrack?.palette} />
      <header className="detail-hero" ref={heroRef}>
        {art ? (
          <Artwork hash={art} kind="full" rounded="lg" className="detail-hero__art" />
        ) : (
          <div className={`detail-hero__art playlist-tile${smart ? ' playlist-tile--smart' : ''}`}>
            <Icon size={56} strokeWidth={1.25} aria-hidden />
          </div>
        )}
        <div className="detail-hero__text">
          <div className="eyebrow">{smart ? 'Smart collection' : 'Playlist'}</div>
          <h1 className="detail-hero__title">{data.name}</h1>
          <p className="detail-hero__meta">
            {smartDef ? `${smartDef.subtitle} · ` : ''}
            {plural(tracks.length, 'song')} · {formatLongDuration(duration)}
          </p>
          <div className="detail-hero__actions">
            <button className="btn btn--primary" disabled={!tracks.length} onClick={() => player.playTracks(tracks, 0, { shuffle: false })}>
              <Play size={16} fill="currentColor" strokeWidth={0} /> Play
            </button>
            <button className="btn btn--secondary" disabled={!tracks.length} onClick={() => player.playTracks(tracks, 0, { shuffle: true })}>
              <Shuffle size={16} /> Shuffle
            </button>
            {!smart && (
              <>
                <IconButton label="Rename playlist" icon={Pencil} onClick={() => rename(playlistInfo)} />
                <IconButton label="Delete playlist" icon={Trash2} onClick={() => remove(playlistInfo, { thenNavigate: true })} />
              </>
            )}
          </div>
        </div>
      </header>
      {tracks.length ? (
        <TrackList
          tracks={tracks}
          columns={smart === 'mostPlayed' ? ['index', 'title', 'artist', 'album', 'plays', 'duration'] : ['index', 'title', 'artist', 'album', 'duration']}
          onReorder={onReorder}
          onRemove={onRemove}
          removeLabel={smart === 'favorites' ? 'Remove from favorites' : 'Remove from playlist'}
          label={data.name}
        />
      ) : (
        <EmptyState
          icon={Icon}
          title={smart ? 'Nothing here yet' : 'This playlist is empty'}
          message={
            smart === 'favorites'
              ? 'Tap the heart on any song to add it here. (Or press and hold it to dedicate your heart.)'
              : smart
                ? 'Play some music and this collection will fill in.'
                : 'Right-click songs anywhere in your library and choose “Add to playlist”.'
          }
        />
      )}
      {onReorder && tracks.length > 1 && <p className="list-hint">Drag songs (or select one and press Alt+↑/↓) to reorder.</p>}
    </div>
  );
}

export function FavoritesView() {
  return <PlaylistDetailView smart="favorites" />;
}
