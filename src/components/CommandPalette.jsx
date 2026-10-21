import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Crown,
  Disc3,
  FolderPlus,
  Heart,
  Home,
  Keyboard,
  ListMusic,
  Maximize2,
  Mic2,
  Music,
  PictureInPicture2,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api.js';
import { player } from '../services/player.js';
import { useNavigation } from '../app/NavigationContext.jsx';
import { useTrackActions } from '../hooks/useTrackActions.js';
import { Artwork, useDebounced } from './primitives.jsx';

const norm = (s) => s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Ctrl+K: jump to any song, album, artist or action without leaving the keyboard. */
export function CommandPalette({ onClose, onOpenNowPlaying, onShowShortcuts, onFocusMode, onSoulKing }) {
  const { navigate } = useNavigation();
  const { createPlaylist } = useTrackActions();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 120);
  const [results, setResults] = useState({ tracks: [], albums: [], artists: [] });
  const [recent, setRecent] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const queryRef = useRef('');
  queryRef.current = query;

  const actions = useMemo(
    () => [
      { label: 'Play / pause', hint: 'Space', icon: Play, run: () => player.toggle() },
      { label: 'Next track', hint: 'Ctrl →', icon: SkipForward, run: () => player.next() },
      { label: 'Previous track', hint: 'Ctrl ←', icon: SkipBack, run: () => player.previous() },
      {
        label: 'Shuffle entire library',
        icon: Shuffle,
        run: async () => player.playTracks(await api.library.listTracks({ includeUnavailable: false }), 0, { shuffle: true }),
      },
      { label: 'Toggle shuffle', icon: Shuffle, run: () => player.toggleShuffle() },
      { label: 'Change repeat mode', icon: Repeat, run: () => player.cycleRepeat() },
      { label: 'Open Now Playing', icon: Maximize2, run: () => onOpenNowPlaying() },
      {
        label: 'Focus mode',
        hint: 'F',
        keywords: 'bankai fullscreen zen immersive',
        icon: Sparkles,
        // Typing "bankai" gets the full release.
        run: () => onFocusMode(norm(queryRef.current).includes('bankai')),
      },
      { label: 'Soul King mode', keywords: 'yohoho yohohoho brook soul king konami', hidden: true, icon: Crown, run: () => onSoulKing() },
      { label: 'Toggle mini player', icon: PictureInPicture2, run: () => api.windows.toggleMini() },
      { label: 'Go to Overview', icon: Home, run: () => navigate('home') },
      { label: 'Go to Songs', icon: Music, run: () => navigate('songs') },
      { label: 'Go to Albums', icon: Disc3, run: () => navigate('albums') },
      { label: 'Go to Artists', icon: Mic2, run: () => navigate('artists') },
      { label: 'Go to Favorites', icon: Heart, run: () => navigate('favorites') },
      { label: 'Go to Playlists', icon: ListMusic, run: () => navigate('playlists') },
      { label: 'New playlist…', icon: Plus, run: async () => {
          const id = await createPlaylist([]);
          if (id) navigate('playlist', { id });
        } },
      { label: 'Add music folders…', icon: FolderPlus, run: () => api.library.addFolders() },
      { label: 'Rescan library', icon: RefreshCw, run: () => api.library.rescan({ full: false }) },
      { label: 'Library & settings', hint: 'Ctrl ,', icon: Settings2, run: () => navigate('settings') },
      { label: 'Keyboard shortcuts', hint: '?', icon: Keyboard, run: () => onShowShortcuts() },
    ],
    [navigate, createPlaylist, onOpenNowPlaying, onShowShortcuts, onFocusMode, onSoulKing],
  );

  useEffect(() => {
    inputRef.current?.focus();
    api.library
      .home()
      .then((h) => setRecent(h.recentlyPlayed.slice(0, 5)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    if (!q) {
      setResults({ tracks: [], albums: [], artists: [] });
      return undefined;
    }
    api.library
      .search(q)
      .then((r) => alive && setResults(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [q]);

  // Flatten everything into one keyboard-navigable list with section headers.
  const sections = useMemo(() => {
    const out = [];
    const nq = norm(query.trim());
    const matches = (a) => norm(a.label).includes(nq) || (a.keywords && nq.length >= 4 && norm(a.keywords).split(' ').some((k) => k.startsWith(nq) || nq.includes(k)));
    const matchedActions = nq ? actions.filter(matches) : actions.filter((a) => !a.hidden).slice(0, 6);
    if (!nq && recent.length) {
      out.push({
        title: 'Recently played',
        items: recent.map((t, i) => ({ key: `r${t.id}`, label: t.title, sub: t.artist, art: t.artHash, run: () => player.playTracks(recent, i) })),
      });
    }
    if (results.tracks.length) {
      const tracks = results.tracks.slice(0, 6);
      out.push({
        title: 'Songs',
        items: tracks.map((t, i) => ({ key: `t${t.id}`, label: t.title, sub: `${t.artist} · ${t.album}`, art: t.artHash, run: () => player.playTracks(results.tracks, i) })),
      });
    }
    if (results.albums.length) {
      out.push({
        title: 'Albums',
        items: results.albums.slice(0, 4).map((a) => ({ key: `a${a.id}`, label: a.title, sub: a.artist, art: a.artHash, run: () => navigate('album', { id: a.id }) })),
      });
    }
    if (results.artists.length) {
      out.push({
        title: 'Artists',
        items: results.artists.slice(0, 4).map((a) => ({ key: `ar${a.id}`, label: a.name, sub: 'Artist', art: a.artHash, round: true, run: () => navigate('artist', { id: a.id }) })),
      });
    }
    if (matchedActions.length) {
      out.push({ title: nq ? 'Actions' : 'Quick actions', items: matchedActions.map((a) => ({ key: `x${a.label}`, ...a })) });
    }
    return out;
  }, [actions, recent, results, query, navigate]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  useEffect(() => setActive(0), [query, results]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item) => {
    if (!item) return;
    onClose();
    // Let the palette close before navigation so the page transition is clean.
    requestAnimationFrame(() => item.run());
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let index = -1;
  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette glass-panel" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette__input">
          <Search size={17} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search music or type a command…"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[active] ? `pal-${flat[active].key}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {sections.map((section) => (
            <div key={section.title} className="palette__section" role="group" aria-label={section.title}>
              <div className="palette__heading">{section.title}</div>
              {section.items.map((item) => {
                index++;
                const i = index;
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    id={`pal-${item.key}`}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className={`palette__item${i === active ? ' is-active' : ''}`}
                    style={{ '--i': i }}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => run(item)}
                  >
                    {item.art !== undefined ? (
                      <Artwork hash={item.art} size={34} rounded={item.round ? 'full' : 'sm'} />
                    ) : (
                      <span className="palette__icon">{Icon && <Icon size={16} />}</span>
                    )}
                    <span className="palette__text">
                      <span className="palette__label">{item.label}</span>
                      {item.sub && <span className="palette__sub">{item.sub}</span>}
                    </span>
                    {item.hint && <kbd className="kbd">{item.hint}</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="palette__empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="palette__foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to open
          </span>
          <span className="palette__brand">Reson</span>
        </div>
      </div>
    </div>
  );
}
