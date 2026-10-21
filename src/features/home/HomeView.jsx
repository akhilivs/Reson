import { useEffect, useState } from 'react';
import { ArrowUpRight, FolderPlus, Shuffle } from 'lucide-react';
import { CountUp } from '../../components/Delights.jsx';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { useLibrary, useLibraryQuery } from '../../app/LibraryContext.jsx';
import { useNavigation } from '../../app/NavigationContext.jsx';
import { AlbumCard } from '../../components/Cards.jsx';
import { Artwork, SkeletonRows, EmptyState } from '../../components/primitives.jsx';
import { useTrackActions } from '../../hooks/useTrackActions.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { formatDuration, greeting } from '../../utils/format.js';

function dateline(d = new Date()) {
  const day = d.toLocaleDateString(undefined, { weekday: 'long' });
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return `${day} · ${date}`;
}

/** "Good evening" + name → "Good evening, Ichigo"; keeps a trailing ? where it belongs. */
function withName(text, name) {
  if (!name) return text;
  return /[?!]$/.test(text) ? `${text.slice(0, -1)}, ${name}${text.slice(-1)}` : `${text}, ${name}`;
}

function ledgerDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m || '<1'}m`;
}

export function HomeView() {
  const { data: home } = useLibraryQuery(() => api.library.home(), []);
  const { scanning } = useLibrary();
  const { navigate } = useNavigation();
  const [name, setName] = useState(null);
  useEffect(() => {
    api.app.info().then((i) => setName(i.userName)).catch(() => {});
  }, []);

  if (!home) return <div className="view"><SkeletonRows count={8} /></div>;
  const { stats } = home;
  const hello = withName(greeting(), name);

  if (!stats.tracks) {
    return (
      <div className="view">
        <EmptyState
          title={scanning ? 'Building your library' : 'Nothing here yet'}
          message={scanning ? 'Songs appear as they are found.' : 'Add a folder of music to begin. Your files stay exactly where they are.'}
        >
          {!scanning && (
            <button className="btn btn--primary" onClick={() => api.library.addFolders()}>
              <FolderPlus size={15} /> Choose music folders
            </button>
          )}
        </EmptyState>
      </div>
    );
  }

  const shuffleAll = async () => {
    const tracks = await api.library.listTracks({ sort: 'artist', includeUnavailable: false });
    player.playTracks(tracks, 0, { shuffle: true });
  };

  return (
    <div className="view view--home">
      <header className="masthead">
        <div className="masthead__dateline mono-label rise" style={{ '--i': 0 }}>{dateline()}</div>
        <h1 className="masthead__title rise" style={{ '--i': 1 }}>
          {hello}
          {!/[?!.]$/.test(hello) && <span className="masthead__dot">.</span>}
        </h1>
        <dl className="ledger rise" style={{ '--i': 2 }}>
          <div>
            <dt>Tracks</dt>
            {/* Dragon Ball: past 9,000 the scouter has something to say. */}
            <dd title={stats.tracks > 9000 ? "It's over 9000!" : undefined}>
              <CountUp value={stats.tracks} />
            </dd>
          </div>
          <div>
            <dt>Albums</dt>
            <dd>
              <CountUp value={stats.albums} />
            </dd>
          </div>
          <div>
            <dt>Artists</dt>
            <dd>
              <CountUp value={stats.artists} />
            </dd>
          </div>
          <div>
            <dt>Running time</dt>
            <dd>
              <CountUp value={Math.round(stats.duration)} format={ledgerDuration} />
            </dd>
          </div>
          <div className="ledger__actions">
            <button className="btn btn--primary" onClick={shuffleAll}>
              <Shuffle size={14} /> Shuffle library
            </button>
          </div>
        </dl>
      </header>

      {home.recentlyPlayed.length > 0 && (
        <section className="section">
          <SectionHead title="Recently played" onMore={() => navigate('playlist', { smart: 'recentlyPlayed' })} />
          <TrackIndex tracks={home.recentlyPlayed.slice(0, 10)} />
        </section>
      )}

      {home.recentAlbums.length > 0 && (
        <section className="section">
          <SectionHead title="Back in rotation" />
          <div className="album-row">
            {home.recentAlbums.map((a, i) => (
              <AlbumCard key={a.id} album={a} index={i} />
            ))}
          </div>
        </section>
      )}

      {home.newAlbums.length > 0 && (
        <section className="section">
          <SectionHead title="Recently added" onMore={() => navigate('albums')} moreLabel="All albums" />
          <div className="album-row">
            {home.newAlbums.map((a, i) => (
              <AlbumCard key={a.id} album={a} index={i} />
            ))}
          </div>
        </section>
      )}

      <div className="split">
        {home.favorites.length > 0 && (
          <section className="section">
            <SectionHead title="Favorites" onMore={() => navigate('favorites')} />
            <TrackIndex tracks={home.favorites.slice(0, 6)} compact />
          </section>
        )}
        {home.mostPlayed.length > 0 && (
          <section className="section">
            <SectionHead title="Most played" onMore={() => navigate('playlist', { smart: 'mostPlayed' })} />
            <TrackIndex tracks={home.mostPlayed.slice(0, 6)} compact showPlays />
          </section>
        )}
      </div>

      {!home.recentlyPlayed.length && (
        <p className="footnote">
          Recently played, favorites and most played fill in as you listen. Everything is computed on this computer.
        </p>
      )}
    </div>
  );
}

function SectionHead({ title, onMore, moreLabel = 'See all' }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {onMore && (
        <button type="button" className="text-link" onClick={onMore}>
          {moreLabel} <ArrowUpRight size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Numbered, two-column index of tracks — reads like a tracklist on a sleeve. */
function TrackIndex({ tracks, compact = false, showPlays = false }) {
  const currentId = usePlayer((s) => s.current?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const { openTrackMenu } = useTrackActions();
  return (
    <ol className={`track-index${compact ? ' track-index--compact' : ''}`}>
      {tracks.map((t, i) => {
        const isCurrent = currentId === t.id;
        return (
          <li key={`${t.id}-${i}`} className="rise" style={{ '--i': i + 3 }}>
            <button
              type="button"
              className={`track-index__item${isCurrent ? ' is-current' : ''}`}
              onClick={() => player.playTracks(tracks, i)}
              onContextMenu={(e) => openTrackMenu(e, [t], { list: tracks, index: i })}
              title={`Play ${t.title} — ${t.artist}`}
            >
              <span className="track-index__num">{isCurrent && playing ? '▶' : String(i + 1).padStart(2, '0')}</span>
              <Artwork hash={t.artHash} size={36} rounded="sm" />
              <span className="track-index__text">
                <span className="track-index__title">{t.title}</span>
                <span className="track-index__artist">{t.artist}</span>
              </span>
              <span className="track-index__meta">{showPlays && t.plays ? `${t.plays}×` : formatDuration(t.duration)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
