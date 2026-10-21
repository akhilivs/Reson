import { useLayoutEffect, useRef, useState } from 'react';
import { Disc3, Heart, Home, ListMusic, Mic2, Music, Plus, Settings2 } from 'lucide-react';
import { useNavigation } from '../app/NavigationContext.jsx';
import { useLibrary } from '../app/LibraryContext.jsx';
import { useTrackActions } from '../hooks/useTrackActions.js';
import { toastBus } from '../app/toastBus.js';
import { api } from '../services/api.js';
import { TRACKS_MIME } from './TrackList.jsx';
import { Wordmark, BrandMark } from './BrandMark.jsx';

const fmt = (n) => (n == null ? '' : n.toLocaleString());

/**
 * Text-first index, like the contents page of a record sleeve.
 * Counts sit in a mono column; the active entry gets a hairline marker in the accent colour.
 */
export function Sidebar() {
  const { route, navigate } = useNavigation();
  const { playlists, scanning, scan, stats } = useLibrary();
  const { createPlaylist, addToPlaylist, setFavorite } = useTrackActions();
  const [dropTarget, setDropTarget] = useState(null);

  // Songs dragged from any list can be dropped on a playlist (adds them) or on Favorites (hearts them).
  const dropProps = (key, onTracks) => ({
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(TRACKS_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: async (e) => {
      setDropTarget(null);
      const raw = e.dataTransfer.getData(TRACKS_MIME);
      if (!raw) return;
      e.preventDefault();
      const ids = JSON.parse(raw).filter((n) => Number.isSafeInteger(n));
      const tracks = await api.library.getTracks(ids).catch(() => []);
      if (tracks.length) onTracks(tracks);
      const el = e.currentTarget;
      el.classList.remove('drop-done');
      void el.offsetWidth;
      el.classList.add('drop-done');
    },
  });
  const navRef = useRef(null);
  const clicks = useRef([]);

  // One Piece: Brook tips his hat on every click; five quick clicks and he asks his famous question.
  const onBrandClick = (e) => {
    for (const m of e.currentTarget.querySelectorAll('.brand-mark')) {
      m.classList.remove('brand-tip');
      void m.offsetWidth;
      m.classList.add('brand-tip');
    }
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 1600), now];
    if (clicks.current.length >= 5) {
      clicks.current = [];
      toastBus.push({ title: 'Yohohoho!', message: 'Pardon me, but… may I see your playlists?' });
    }
    navigate('home');
  };
  const [indicator, setIndicator] = useState(null);

  // One indicator glides to whichever item is active (spring), instead of per-item markers.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => {
      const el = nav.querySelector('.nav-item.is-active');
      if (!el || !el.offsetParent) return setIndicator(null);
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const visible = r.bottom > n.top && r.top < n.bottom;
      setIndicator(visible ? { top: r.top - n.top + 7, height: r.height - 14 } : null);
    };
    measure();
    const list = nav.querySelector('.nav-list--scroll');
    list?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      list?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [route, playlists, scanning]);

  const library = [
    { name: 'home', label: 'Overview', icon: Home },
    { name: 'songs', label: 'Songs', count: stats?.tracks, icon: Music },
    { name: 'albums', label: 'Albums', count: stats?.albums, also: ['album'], icon: Disc3 },
    { name: 'artists', label: 'Artists', count: stats?.artists, also: ['artist'], icon: Mic2 },
  ];
  const collections = [
    { name: 'favorites', label: 'Favorites', icon: Heart },
    { name: 'playlists', label: 'Playlists', count: playlists.length, icon: ListMusic },
  ];

  const isActive = (item) => route.name === item.name || item.also?.includes(route.name);

  const renderItem = (item) => {
    const active = isActive(item);
    return (
      <li key={item.name}>
        <button
          type="button"
          className={`nav-item${active ? ' is-active' : ''}${dropTarget === item.name ? ' is-drop-target' : ''}`}
          aria-current={active ? 'page' : undefined}
          onClick={() => navigate(item.name)}
          title={item.label}
          {...(item.name === 'favorites' ? dropProps('favorites', (tracks) => setFavorite(tracks, true)) : null)}
        >
          <item.icon size={17} className="nav-item__icon" aria-hidden />
          <span className="nav-item__label">{item.label}</span>
          {item.count != null && <span className="nav-item__count">{fmt(item.count)}</span>}
        </button>
      </li>
    );
  };

  return (
    <nav className="sidebar" aria-label="Main" ref={navRef}>
      <span
        className="nav-indicator"
        aria-hidden
        style={indicator ? { transform: `translateY(${indicator.top}px)`, height: indicator.height, opacity: 1 } : { opacity: 0 }}
      />
      <button type="button" className="sidebar__brand" onClick={onBrandClick} aria-label="Reson — overview">
        <Wordmark />
        <BrandMark size={32} className="sidebar__brand-compact" />
      </button>

      <div className="nav-group">
        <div className="nav-group__label">Library</div>
        <ul className="nav-list">
          {library.map(renderItem)}
        </ul>
      </div>

      <div className="nav-group">
        <div className="nav-group__label">Collections</div>
        <ul className="nav-list">
          {collections.map(renderItem)}
        </ul>
      </div>

      <div className="nav-group nav-group--playlists">
        <div className="nav-group__label">
          <span>Playlists</span>
          <button
            type="button"
            className="nav-group__add"
            aria-label="New playlist"
            title="New playlist"
            onClick={async () => {
              const id = await createPlaylist([]);
              if (id) navigate('playlist', { id });
            }}
          >
            <Plus size={13} />
          </button>
        </div>
        <ul className="nav-list nav-list--scroll">
          {playlists.map((p) => {
            const active = route.name === 'playlist' && route.params.id === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`nav-item nav-item--playlist${active ? ' is-active' : ''}${dropTarget === `p${p.id}` ? ' is-drop-target' : ''}`}
                  {...dropProps(`p${p.id}`, (tracks) => addToPlaylist(p.id, tracks))}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate('playlist', { id: p.id })}
                  title={p.name}
                >
                  <span className="nav-item__label">{p.name}</span>
                  <span className="nav-item__count">{fmt(p.trackCount)}</span>
                </button>
              </li>
            );
          })}
          {!playlists.length && <li className="nav-empty">None yet</li>}
        </ul>
      </div>

      <div className="sidebar__footer">
        {scanning && (
          <button type="button" className="scan-line" onClick={() => navigate('settings')} title="Library scan in progress">
            <span className="scan-line__dot" aria-hidden />
            <span>{scan?.phase === 'enumerating' ? 'Charting music' : `Indexing ${fmt(scan?.processed)}/${fmt(scan?.total)}`}</span>
          </button>
        )}
        <button
          type="button"
          className={`nav-item${route.name === 'settings' ? ' is-active' : ''}`}
          aria-current={route.name === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
          title="Library & settings"
        >
          <Settings2 size={17} className="nav-item__icon" aria-hidden />
          <span className="nav-item__label">Library &amp; settings</span>
          <span className="nav-item__count">Ctrl ,</span>
        </button>
      </div>
    </nav>
  );
}
