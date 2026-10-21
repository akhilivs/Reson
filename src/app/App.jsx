import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SettingsProvider, useSettings } from './SettingsContext.jsx';
import { NavigationProvider, useNavigation } from './NavigationContext.jsx';
import { LibraryProvider, useLibrary } from './LibraryContext.jsx';
import { ContextMenuProvider, DialogProvider, Toasts } from './Overlays.jsx';
import { Sidebar } from '../components/Sidebar.jsx';
import { TopBar } from '../components/TopBar.jsx';
import { PlayerBar } from '../components/PlayerBar.jsx';
import { QueueDrawer } from '../components/QueueList.jsx';
import { ScrollContext } from '../components/TrackList.jsx';
import { HomeView } from '../features/home/HomeView.jsx';
import { SongsView } from '../features/library/SongsView.jsx';
import { AlbumsView, AlbumDetailView } from '../features/albums/AlbumsView.jsx';
import { ArtistsView, ArtistDetailView } from '../features/artists/ArtistsView.jsx';
import { PlaylistsView, PlaylistDetailView, FavoritesView } from '../features/playlists/PlaylistsView.jsx';
import { SearchView } from '../features/search/SearchView.jsx';
import { SettingsView } from '../features/settings/SettingsView.jsx';
import { NowPlaying } from '../features/now-playing/NowPlaying.jsx';
import { Onboarding } from '../features/onboarding/Onboarding.jsx';
import { usePlayer, player } from '../hooks/usePlayer.js';
import { applyPalette } from '../services/themeService.js';
import { api } from '../services/api.js';
import { PageTitleProvider } from './PageTitleContext.jsx';
import { withViewTransition } from './motion.js';
import { CommandPalette } from '../components/CommandPalette.jsx';
import { ShortcutSheet } from '../components/ShortcutSheet.jsx';
import { Farewell, Petals, SoulKingIntro, SoulKingNotes, ToBeContinued, useKonami } from '../components/Delights.jsx';
import { toastBus } from './toastBus.js';
import { prefersReducedMotion } from './motion.js';
import { useKeyboardControls } from './useKeyboardControls.js';
import { KeyFeedback } from '../components/KeyFeedback.jsx';

export function App({ settings }) {
  return (
    <SettingsProvider initial={settings}>
      <NavigationProvider>
        <PageTitleProvider>
        <LibraryProvider>
          <DialogProvider>
            <ContextMenuProvider>
              <Shell />
              <Toasts />
            </ContextMenuProvider>
          </DialogProvider>
        </LibraryProvider>
        </PageTitleProvider>
      </NavigationProvider>
    </SettingsProvider>
  );
}

function routeView(route) {
  const p = route.params ?? {};
  switch (route.name) {
    case 'songs':
      return <SongsView />;
    case 'albums':
      return <AlbumsView />;
    case 'album':
      return <AlbumDetailView id={p.id} preview={p.preview} />;
    case 'artists':
      return <ArtistsView />;
    case 'artist':
      return <ArtistDetailView id={p.id} preview={p.preview} />;
    case 'playlists':
      return <PlaylistsView />;
    case 'playlist':
      return <PlaylistDetailView id={p.id} smart={p.smart} />;
    case 'favorites':
      return <FavoritesView />;
    case 'search':
      return <SearchView q={p.q} />;
    case 'settings':
      return <SettingsView />;
    default:
      return <HomeView />;
  }
}

function Shell() {
  const { settings, update } = useSettings();
  const { route, navigate, goBack, goForward } = useNavigation();
  const { folders, stats, scanning } = useLibrary();
  const palette = usePlayer((s) => s.current?.palette ?? null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(false);
  const [miniVisible, setMiniVisible] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [focus, setFocus] = useState(false);
  const [petalsKey, setPetalsKey] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // One Piece: Soul King mode — a hidden theme, unlocked with the Konami code.
  useEffect(() => {
    if (settings.soulKing) document.documentElement.dataset.soulKing = 'true';
    else delete document.documentElement.dataset.soulKing;
  }, [settings.soulKing]);
  const [soulKingIntro, setSoulKingIntro] = useState(false);
  const toggleSoulKing = useCallback(() => {
    const on = !settings.soulKing;
    update('soulKing', on);
    if (on) {
      if (!settings.soulKingUnlocked) update('soulKingUnlocked', true);
      setSoulKingIntro(true);
    } else {
      setSoulKingIntro(false);
      toastBus.push({ title: 'Soul King mode off', message: 'Until the next encore.' });
    }
  }, [settings.soulKing, settings.soulKingUnlocked, update]);
  const endSoulKingIntro = useCallback(() => {
    setSoulKingIntro(false);
    toastBus.push({ title: 'Soul King mode', message: 'Brook takes the stage. Turn it off in Settings or with the code again.' });
  }, []);
  useKonami(toggleSoulKing);

  // One Piece (Laboon): a restored session is a promise kept.
  useEffect(() => {
    const t = setTimeout(() => {
      if (player.getSnapshot().current && settings.resumeOnLaunch) {
        toastBus.push({ title: 'Right where you left off', message: 'A promise kept.' });
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When Reson isn't the active window, the transport dims slightly (like native Windows apps).
  useEffect(() => {
    const root = document.documentElement;
    const blur = () => (root.dataset.windowBlurred = 'true');
    const focusIn = () => delete root.dataset.windowBlurred;
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focusIn);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focusIn);
    };
  }, []);

  // A short "Mata ashita" farewell before quitting (instant with reduced motion).
  useEffect(() => {
    const onFarewell = () => {
      if (prefersReducedMotion()) return api.app.quit();
      setLeaving(true);
      setTimeout(() => api.app.quit(), 1400);
    };
    window.addEventListener('brook:farewell', onFarewell);
    return () => window.removeEventListener('brook:farewell', onFarewell);
  }, []);
  const scrollRef = useRef(null);
  const searchRef = useRef(null);

  // Album-art driven accent and ambient light.
  useEffect(() => {
    applyPalette(palette, settings);
  }, [palette, settings.dynamicAccent, settings.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    player.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    api.windows.miniVisible().then(setMiniVisible).catch(() => {});
    return api.windows.onMiniVisibility(setMiniVisible);
  }, []);

  // Reset scroll position on navigation (layout effect: before the View Transition snapshot).
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [route]);

  // Once music exists, the welcome screen has done its job.
  useEffect(() => {
    if (stats?.tracks > 0 && !settings.onboardingDismissed) update('onboardingDismissed', true);
  }, [stats?.tracks, settings.onboardingDismissed, update]);

  const showOnboarding = stats && !settings.onboardingDismissed && (folders.length === 0 || (scanning && !stats.tracks));

  // Now Playing opens/closes inside a View Transition: the player art morphs into the big art.
  const openNowPlaying = useCallback(() => withViewTransition(() => setNowPlaying(true), { direction: 'up' }), []);
  const closeNowPlaying = useCallback(() => {
    setFocus((f) => {
      if (f) api.windows.setFullScreen(false).catch(() => {});
      return false;
    });
    withViewTransition(() => setNowPlaying(false), { direction: 'down' });
  }, []);

  // Bleach: Bankai — fullscreen focus mode, entered with a burst of Senbonzakura petals.
  const enterFocus = useCallback(
    (announce = false) => {
      if (!player.getSnapshot().current) return;
      // No page transition here: animating while the window resizes to fullscreen causes jank.
      api.windows.setFullScreen(true).catch(() => {});
      setNowPlaying(true);
      setFocus(true);
      setTimeout(() => setPetalsKey((k) => k + 1), 380);
      if (announce) toastBus.push({ title: 'Bankai.', message: 'Focus mode — Esc to return.' });
    },
    [nowPlaying],
  );
  const exitFocus = useCallback(() => {
    setFocus(false);
    api.windows.setFullScreen(false).catch(() => {});
  }, []);
  useEffect(() => {
    if (!petalsKey) return undefined;
    const t = setTimeout(() => setPetalsKey(0), 5200);
    return () => clearTimeout(t);
  }, [petalsKey]);
  const toggleMini = () => api.windows.toggleMini();

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === '?' && !typing) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (nowPlaying) closeNowPlaying();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.altKey && e.key === 'ArrowLeft' && !typing) {
        e.preventDefault();
        goBack();
      } else if (e.altKey && e.key === 'ArrowRight' && !typing) {
        e.preventDefault();
        goForward();
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        navigate('settings');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        window.dispatchEvent(new Event('brook:farewell'));
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        e.preventDefault();
        if (focus) exitFocus();
        else enterFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward, navigate, nowPlaying, closeNowPlaying, focus, enterFocus, exitFocus]);

  // Media keys on the keyboard: Space/K, ←/→, J/L, ↑/↓, M, 0–9, S, R, H, Q, N (see useKeyboardControls).
  useKeyboardControls({
    toggleQueue: () => setQueueOpen((v) => !v),
    toggleNowPlaying: () => (nowPlaying ? closeNowPlaying() : openNowPlaying()),
  });

  // Mouse back/forward buttons.
  useEffect(() => {
    const onMouse = (e) => {
      if (e.button === 3) goBack();
      if (e.button === 4) goForward();
    };
    window.addEventListener('mouseup', onMouse);
    return () => window.removeEventListener('mouseup', onMouse);
  }, [goBack, goForward]);

  return (
    <div className={`app-shell${queueOpen ? ' has-queue' : ''}`} data-scrolled={scrolled || undefined}>
      <div className="ambient" aria-hidden />
      {settings.soulKing && <SoulKingNotes />}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      <div className="main-column">
        <TopBar searchRef={searchRef} />
        <main
          id="main"
          className="content"
          ref={scrollRef}
          tabIndex={-1}
          onScroll={(e) => {
            const next = e.currentTarget.scrollTop > 4;
            if (next !== scrolled) setScrolled(next);
          }}
        >
          <ScrollContext.Provider value={scrollRef}>
            {showOnboarding ? <Onboarding onSkip={() => update('onboardingDismissed', true)} /> : routeView(route)}
          </ScrollContext.Provider>
        </main>
      </div>
      {queueOpen && <QueueDrawer onClose={() => setQueueOpen(false)} />}
      <PlayerBar
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((v) => !v)}
        onOpenNowPlaying={openNowPlaying}
        nowPlayingOpen={nowPlaying}
        miniVisible={miniVisible}
        onToggleMini={toggleMini}
      />
      {nowPlaying && <NowPlaying onClose={focus ? exitFocus : closeNowPlaying} focus={focus} soulKing={!!settings.soulKing} />}
      {petalsKey > 0 && <Petals key={petalsKey} />}
      <ToBeContinued />
      <KeyFeedback />
      {soulKingIntro && <SoulKingIntro onDone={endSoulKingIntro} />}
      {leaving && <Farewell />}
      {paletteOpen && <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenNowPlaying={openNowPlaying}
          onShowShortcuts={() => setShortcutsOpen(true)}
          onFocusMode={enterFocus}
          onSoulKing={toggleSoulKing}
        />}
      {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
