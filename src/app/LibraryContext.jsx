import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { player } from '../services/player.js';
import { toastBus } from './toastBus.js';

const LibraryContext = createContext(null);

/**
 * Shared library state: a version counter that bumps whenever the library changes (views refetch),
 * scan progress, folder list, stats and the playlist list used by menus and the sidebar.
 */
export function LibraryProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [scan, setScan] = useState(null);
  const [stats, setStats] = useState(null);
  const [folders, setFolders] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const lastPhase = useRef(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([api.library.stats(), api.library.getFolders(), api.playlists.list()])
      .then(([s, f, p]) => {
        if (!alive) return;
        setStats(s);
        setFolders(f);
        setPlaylists(p);
      })
      .catch((err) => console.error('Library refresh failed', err));
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    api.library.status().then((s) => s.scanning && setScan(s.progress)).catch(() => {});
    const offProgress = api.library.onScanProgress((p) => {
      setScan(p);
      if (p.phase === 'done' && lastPhase.current !== 'done') {
        const s = p.summary ?? {};
        const parts = [];
        if (s.added) parts.push(`${s.added} added`);
        if (s.updated) parts.push(`${s.updated} updated`);
        if (s.moved) parts.push(`${s.moved} moved`);
        if (s.missing) parts.push(`${s.missing} missing`);
        if (s.errors) parts.push(`${s.errors} could not be read`);
        if (s.cancelled) toastBus.push({ title: 'Scan cancelled' });
        else if (parts.length) toastBus.push({ type: s.errors ? 'warning' : 'success', title: 'Library updated', message: parts.join(' · ') });
      }
      lastPhase.current = p.phase;
    });
    const offChanged = api.library.onChanged(() => {
      refresh();
      player.refreshFromLibrary();
    });
    return () => {
      offProgress();
      offChanged();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ version, refresh, scan, scanning: !!scan && scan.phase !== 'done', stats, folders, playlists }),
    [version, refresh, scan, stats, folders, playlists],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  return useContext(LibraryContext);
}

/**
 * Runs an async loader and re-runs it when deps change or the library changes.
 * Keeps the previous data while reloading to avoid flashing empty states.
 */
export function useLibraryQuery(loader, deps = []) {
  const { version } = useLibrary();
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}
