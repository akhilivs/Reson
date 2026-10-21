import { useCallback, useRef } from 'react';
import { Disc3, FolderOpen, Heart, HeartOff, ListEnd, ListPlus, ListStart, Play, Plus, Trash2, User } from 'lucide-react';
import { api } from '../services/api.js';
import { player } from '../services/player.js';
import { toastBus } from '../app/toastBus.js';
import { useLibrary } from '../app/LibraryContext.jsx';
import { useNavigation } from '../app/NavigationContext.jsx';
import { useDialog, useContextMenu } from '../app/Overlays.jsx';
import { plural } from '../utils/format.js';

/** Shared track operations used by every list, card and menu. */
export function useTrackActions() {
  const { playlists, refresh } = useLibrary();
  const { navigate } = useNavigation();
  const dialog = useDialog();
  const openMenu = useContextMenu();

  const addToPlaylist = useCallback(
    async (playlistId, tracks) => {
      try {
        const n = await api.playlists.addTracks(playlistId, tracks.map((t) => t.id));
        const p = playlists.find((x) => x.id === playlistId);
        toastBus.push({ type: 'success', title: `Added ${plural(n, 'track')}`, message: p ? `to ${p.name}` : undefined });
        refresh();
      } catch (err) {
        toastBus.push({ type: 'error', title: 'Could not add to playlist', message: err.message });
      }
    },
    [playlists, refresh],
  );

  const createPlaylist = useCallback(
    async (tracks = []) => {
      const name = await dialog.prompt({ title: 'New playlist', label: 'Playlist name', placeholder: 'My playlist', confirmLabel: 'Create' });
      if (!name) return null;
      try {
        const id = await api.playlists.create(name, tracks.map((t) => t.id));
        toastBus.push({ type: 'success', title: `Created “${name}”`, message: tracks.length ? plural(tracks.length, 'track') : undefined });
        refresh();
        return id;
      } catch (err) {
        toastBus.push({ type: 'error', title: 'Could not create playlist', message: err.message });
        return null;
      }
    },
    [dialog, refresh],
  );

  const setFavoriteRef = useRef(null);
  const setFavorite = useCallback(
    async (tracks, value) => {
      try {
        await api.favorites.set(tracks.map((t) => t.id), value);
        player.updateTracks(tracks.map((t) => ({ ...t, favorite: value })));
        refresh();
        if (!value) {
          toastBus.push({
            title: tracks.length === 1 ? `Removed “${tracks[0].title}” from favorites` : `Removed ${plural(tracks.length, 'song')} from favorites`,
            action: { label: 'Undo', run: () => setFavoriteRef.current(tracks, true) },
          });
        }
      } catch (err) {
        toastBus.push({ type: 'error', title: 'Could not update favorites', message: err.message });
      }
    },
    [refresh],
  );

  setFavoriteRef.current = setFavorite;

  const reveal = useCallback(async (track) => {
    try {
      await api.library.reveal(track.id);
    } catch (err) {
      toastBus.push({ type: 'error', title: 'Can’t show file', message: err.message });
    }
  }, []);

  /**
   * Opens the context menu for `selection` (tracks). `context` adds list-specific entries:
   *  { list, index, onRemove, removeLabel }
   */
  const openTrackMenu = useCallback(
    (event, selection, context = {}) => {
      if (!selection.length) return;
      const single = selection.length === 1 ? selection[0] : null;
      const allFav = selection.every((t) => t.favorite);
      openMenu(event, [
        {
          label: single ? 'Play' : `Play ${selection.length} tracks`,
          icon: Play,
          onSelect: () => {
            if (single && context.list) player.playTracks(context.list, context.index ?? context.list.indexOf(single));
            else player.playTracks(selection, 0);
          },
        },
        { label: 'Play next', icon: ListStart, onSelect: () => player.playNext(selection) },
        {
          label: 'Add to queue',
          icon: ListEnd,
          onSelect: () => {
            player.enqueue(selection);
            toastBus.push({ title: `Added ${plural(selection.length, 'track')} to the queue` });
          },
        },
        {
          label: 'Add to playlist',
          icon: ListPlus,
          submenu: [
            { label: 'New playlist…', icon: Plus, onSelect: () => createPlaylist(selection) },
            ...(playlists.length ? [{ type: 'separator' }] : []),
            ...playlists.map((p) => ({ label: p.name, onSelect: () => addToPlaylist(p.id, selection) })),
          ],
        },
        { type: 'separator' },
        // In the Favorites list the remove action below already covers this; don't show it twice.
        !(allFav && context.removeLabel === 'Remove from favorites') && {
          label: allFav ? 'Remove from favorites' : 'Add to favorites',
          icon: allFav ? HeartOff : Heart,
          onSelect: () => setFavorite(selection, !allFav),
        },
        single && single.albumId && { label: 'Go to album', icon: Disc3, onSelect: () => navigate('album', { id: single.albumId }) },
        single && single.artistId && { label: 'Go to artist', icon: User, onSelect: () => navigate('artist', { id: single.artistId }) },
        single && { label: 'Show in File Explorer', icon: FolderOpen, onSelect: () => reveal(single), disabled: !single.available },
        context.onRemove && { type: 'separator' },
        context.onRemove && {
          label: context.removeLabel ?? 'Remove from playlist',
          icon: Trash2,
          danger: true,
          onSelect: () => context.onRemove(selection),
        },
      ]);
    },
    [openMenu, playlists, createPlaylist, addToPlaylist, setFavorite, navigate, reveal],
  );

  return { openTrackMenu, addToPlaylist, createPlaylist, setFavorite, reveal };
}
