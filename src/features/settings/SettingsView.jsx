import { useEffect, useState } from 'react';
import { AlertTriangle, Check, FolderOpen, FolderPlus, HardDrive, RefreshCw, Trash2, X, Power } from 'lucide-react';
import { api } from '../../services/api.js';
import { player } from '../../services/player.js';
import { toastBus } from '../../app/toastBus.js';
import { useSettings } from '../../app/SettingsContext.jsx';
import { useLibrary } from '../../app/LibraryContext.jsx';
import { useDialog } from '../../app/Overlays.jsx';
import { PageHeader, IconButton } from '../../components/primitives.jsx';
import { Wordmark } from '../../components/BrandMark.jsx';
import { formatBytes, plural, relativeTime } from '../../utils/format.js';

// Neutral ink first; the rest are muted, print-like tones that stay readable on graphite.
const ACCENTS = ['#ecebe6', '#b9a6ff', '#e9a15a', '#d8c27a', '#9fc3a0', '#8fb8de', '#e39a9a'];

const FORMAT_PROBES = [
  ['MP3', 'audio/mpeg'],
  ['FLAC', 'audio/flac'],
  ['WAV (PCM)', 'audio/wav; codecs="1"'],
  ['AAC / M4A', 'audio/mp4; codecs="mp4a.40.2"'],
  ['Ogg Vorbis', 'audio/ogg; codecs="vorbis"'],
  ['Opus', 'audio/ogg; codecs="opus"'],
];

function Switch({ checked, onChange, label, description }) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <div className="setting-row__label" id={`lbl-${label}`}>
          {label}
        </div>
        {description && <div className="setting-row__desc">{description}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`lbl-${label}`} className={`switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

function Segmented({ value, options, onChange, label, description }) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <div className="setting-row__label">{label}</div>
        {description && <div className="setting-row__desc">{description}</div>}
      </div>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={`segmented__opt${value === v ? ' is-active' : ''}`} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, description, children, id }) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {description && <p className="section-note">{description}</p>}
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const { settings, update } = useSettings();
  const { folders, stats, scan, scanning, refresh } = useLibrary();
  const dialog = useDialog();
  const [info, setInfo] = useState(null);
  const [storage, setStorage] = useState(null);
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    api.app.info().then(setInfo).catch(() => {});
  }, []);
  useEffect(() => {
    api.app.storage().then(setStorage).catch(() => {});
    api.library.status().then(setStatus).catch(() => {});
  }, [stats, scanning]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')))
      .catch(() => setDevices([]));
  }, []);

  const addFolders = async () => {
    try {
      const res = await api.library.addFolders();
      if (res.canceled) return;
      if (res.added.length) toastBus.push({ type: 'success', title: `Added ${plural(res.added.length, 'folder')}`, message: 'Scanning for music…' });
      for (const s of res.skipped) toastBus.push({ type: 'warning', title: 'Folder not added', message: `${s.path}: ${s.reason}` });
      refresh();
    } catch (err) {
      toastBus.push({ type: 'error', title: 'Could not add folders', message: err.message });
    }
  };

  const removeFolder = async (f) => {
    const ok = await dialog.confirm({
      title: 'Remove folder from library?',
      message: `Reson will stop indexing “${f.path}” and remove its ${plural(f.trackCount, 'song')} from your library, playlists and history. The music files on disk are NOT deleted.`,
      confirmLabel: 'Remove from library',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.library.removeFolder(f.id);
      toastBus.push({ title: 'Folder removed from library', message: `${plural(r.removedTracks, 'song')} removed from the index. Files were not touched.` });
      refresh();
    } catch (err) {
      toastBus.push({ type: 'error', title: 'Could not remove folder', message: err.message });
    }
  };

  const removeMissing = async () => {
    const ok = await dialog.confirm({
      title: `Forget ${plural(stats?.unavailable ?? 0, 'unavailable song')}?`,
      message: 'These songs are removed from your library, playlists and history. Use this only if the files are gone for good — songs on a disconnected drive come back automatically when it is reconnected.',
      confirmLabel: 'Forget missing songs',
      danger: true,
    });
    if (!ok) return;
    const n = await api.library.removeMissing();
    toastBus.push({ title: `Removed ${plural(n, 'song')} from the library` });
    refresh();
  };

  const audio = typeof Audio !== 'undefined' ? new Audio() : null;
  const progressPct = scan?.total ? Math.round((scan.processed / scan.total) * 100) : 0;

  return (
    <div className="view view--settings">
      <PageHeader title="Library & settings" subtitle="Stored on this computer only. Reson never uploads your music or listening history." />

      <Section id="s-library" title="Music folders" description="Reson reads music from these folders. Removing a folder only removes it from Reson — your files stay on disk.">
        <ul className="folder-list">
          {folders.map((f) => (
            <li key={f.id} className="folder-row">
              <HardDrive size={18} aria-hidden className={f.available ? '' : 'text-warning'} />
              <div className="folder-row__text">
                <div className="folder-row__path" title={f.path}>
                  {f.path}
                </div>
                <div className="folder-row__meta">
                  {plural(f.trackCount, 'song')}
                  {f.lastScannedAt ? ` · scanned ${relativeTime(f.lastScannedAt)}` : ''}
                  {!f.available && <span className="text-warning"> · Not reachable — songs kept, marked unavailable</span>}
                </div>
              </div>
              <IconButton label={`Remove ${f.path} from library`} icon={X} size="sm" onClick={() => removeFolder(f)} />
            </li>
          ))}
          {!folders.length && <li className="folder-row folder-row--empty">No folders yet.</li>}
        </ul>
        <div className="button-row">
          <button className="btn btn--primary" onClick={addFolders}>
            <FolderPlus size={16} /> Add folders
          </button>
          <button className="btn btn--secondary" disabled={!folders.length || scanning} onClick={() => api.library.rescan({ full: false })}>
            <RefreshCw size={16} /> Rescan
          </button>
          <button
            className="btn btn--ghost"
            disabled={!folders.length || scanning}
            onClick={() => api.library.rescan({ full: true })}
            title="Re-reads tags and artwork from every file"
          >
            Full rescan
          </button>
        </div>
        {scanning && (
          <div className="scan-progress" role="status" aria-live="polite">
            <div className="scan-progress__head">
              <span>{scan.phase === 'enumerating' ? 'Scouting beyond the walls…' : `Indexing ${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()}`}</span>
              <button className="btn btn--ghost btn--sm" onClick={() => api.library.cancelScan()}>
                Cancel
              </button>
            </div>
            <div className="progress">
              <div className="progress__fill" style={{ width: `${scan.phase === 'enumerating' ? 5 : progressPct}%` }} />
            </div>
            {scan.current && <div className="scan-progress__file">{scan.current}</div>}
          </div>
        )}
        <Switch
          label="Watch folders for changes"
          description="New, changed and removed files are picked up automatically while Reson is running."
          checked={settings.watchFolders}
          onChange={(v) => update('watchFolders', v)}
        />
        {status?.errors?.length > 0 && (
          <details className="scan-errors">
            <summary>
              <AlertTriangle size={14} aria-hidden /> {plural(status.errors.length, 'file')} couldn’t be read in the last scan
            </summary>
            <ul>
              {status.errors.slice(0, 100).map((e, i) => (
                <li key={i}>
                  <span className="scan-errors__file">{e.file.split(/[\\/]/).pop() || e.file}</span> — {e.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section id="s-missing" title="Missing & unsupported files">
        <Switch label="Show unavailable songs" description="Songs whose files are missing stay in your library (and playlists) and are shown greyed out." checked={settings.showUnavailable} onChange={(v) => update('showUnavailable', v)} />
        <Segmented
          label="When a song can’t be played"
          value={settings.missingTrackBehavior}
          options={[
            ['skip', 'Skip to next'],
            ['stop', 'Stop'],
          ]}
          onChange={(v) => {
            update('missingTrackBehavior', v);
            player.applySettings({ missingTrackBehavior: v });
          }}
        />
        <div className="setting-row">
          <div className="setting-row__text">
            <div className="setting-row__label">Unavailable songs</div>
            <div className="setting-row__desc">{stats?.unavailable ? `${plural(stats.unavailable, 'song')} currently can’t be found.` : 'All indexed files are available.'}</div>
          </div>
          <button className="btn btn--secondary" disabled={!stats?.unavailable} onClick={removeMissing}>
            <Trash2 size={16} /> Forget missing songs
          </button>
        </div>
      </Section>

      <Section id="s-appearance" title="Appearance">
        <Switch label="Dynamic accent color" description="Tint controls and ambient light with colors from the current album artwork." checked={settings.dynamicAccent} onChange={(v) => update('dynamicAccent', v)} />
        <div className="setting-row">
          <div className="setting-row__text">
            <div className="setting-row__label">{settings.dynamicAccent ? 'Fallback accent' : 'Accent color'}</div>
            <div className="setting-row__desc">{settings.dynamicAccent ? 'Used when artwork is missing or monochrome.' : 'Used everywhere in Reson.'}</div>
          </div>
          <div className="swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={settings.accentColor === c}
                aria-label={`Accent ${c}`}
                className={`swatch${settings.accentColor === c ? ' is-active' : ''}`}
                style={{ background: c }}
                onClick={() => update('accentColor', c)}
              >
                {settings.accentColor === c && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
        <Segmented
          label="Ambient light"
          value={settings.ambientIntensity}
          options={[
            ['off', 'Off'],
            ['subtle', 'Subtle'],
            ['vivid', 'Vivid'],
          ]}
          onChange={(v) => update('ambientIntensity', v)}
        />
        {settings.soulKingUnlocked && (
          <Switch
            label="Soul King mode"
            description="Unlocked! Brook's concert: lavender stage lights and drifting notes. The Konami code toggles it too."
            checked={settings.soulKing}
            onChange={(v) => update('soulKing', v)}
          />
        )}
        <Switch label="Reduce transparency" description="Use solid surfaces instead of blurred glass. Can improve performance on older hardware." checked={settings.reduceTransparency} onChange={(v) => update('reduceTransparency', v)} />
        <Segmented
          label="Reduce motion"
          value={settings.reducedMotion}
          options={[
            ['system', 'System'],
            ['on', 'On'],
            ['off', 'Off'],
          ]}
          onChange={(v) => update('reducedMotion', v)}
        />
      </Section>

      <Section id="s-playback" title="Playback">
        <Segmented
          label="Double-click a song"
          value={settings.doubleClickBehavior}
          options={[
            ['playContext', 'Play list from here'],
            ['playSingle', 'Play only that song'],
            ['enqueue', 'Add to queue'],
          ]}
          onChange={(v) => update('doubleClickBehavior', v)}
        />
        <Switch label="Resume where you left off" description="Restore the queue and position (paused) when Reson starts." checked={settings.resumeOnLaunch} onChange={(v) => update('resumeOnLaunch', v)} />
        <div className="setting-row">
          <div className="setting-row__text">
            <div className="setting-row__label">Audio output</div>
            <div className="setting-row__desc">Output device used by Reson. Uses the Windows default unless changed.</div>
          </div>
          <label className="select">
            <span className="sr-only">Audio output device</span>
            <select
              value={settings.outputDeviceId}
              onChange={async (e) => {
                const id = e.target.value;
                if (await player.setOutputDevice(id)) update('outputDeviceId', id);
              }}
            >
              <option value="default">System default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output device ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="section-note">
          Playback uses Chromium’s media engine (HTMLAudioElement). Crossfade, gapless transitions and an equalizer are not currently offered: the
          engine can’t do them reliably across formats, so Reson doesn’t pretend to.
        </p>
      </Section>

      <Section id="s-window" title="Windows">
        <Switch label="Keep playing in the tray when the window is closed" description="When off, closing the main window quits Reson." checked={settings.closeToTray} onChange={(v) => update('closeToTray', v)} />
        <Switch label="Mini player stays on top" checked={settings.miniAlwaysOnTop} onChange={(v) => update('miniAlwaysOnTop', v)} />
      </Section>

      <Section id="s-data" title="Data & cache" description="Apple Lossless (ALAC) songs are converted to FLAC the first time they play, losslessly, and kept here for instant playback. The cache is capped at 2 GB; your original files are never changed.">
        <div className="kv">
          <div>
            <span>Library database</span>
            <strong>{storage ? formatBytes(storage.dbBytes) : '…'}</strong>
          </div>
          <div>
            <span>Converted audio</span>
            <strong>{storage ? `${formatBytes(storage.convertedBytes)} · ${plural(storage.convertedFiles, 'file')}` : '…'}</strong>
          </div>
          <div>
            <span>Artwork cache</span>
            <strong>{storage ? `${formatBytes(storage.artworkBytes)} · ${plural(storage.artworkFiles, 'file')}` : '…'}</strong>
          </div>
        </div>
        <div className="button-row">
          <button
            className="btn btn--secondary"
            onClick={async () => {
              const n = await api.app.cleanArtworkCache();
              toastBus.push({ title: n ? `Removed ${plural(n, 'unused image')}` : 'Artwork cache is already tidy' });
              setStorage(await api.app.storage());
            }}
          >
            Clean unused artwork
          </button>
          <button
            className="btn btn--secondary"
            disabled={!storage?.convertedFiles}
            onClick={async () => {
              await api.app.clearConvertedAudio();
              toastBus.push({ title: 'Converted audio cleared', message: 'Songs are converted again the next time they play.' });
              setStorage(await api.app.storage());
            }}
          >
            Clear converted audio
          </button>
          <button className="btn btn--ghost" onClick={() => api.app.openDataFolder()}>
            <FolderOpen size={16} /> Open data folder
          </button>
        </div>
      </Section>

      <Section id="s-about" title="About & diagnostics">
        <div className="about">
          <div className="about__brand">
            <Wordmark />
            <span className="meta-text">Your music lives on. Named for the Soul King.</span>
          </div>
          {info && (
            <dl className="details-list details-list--compact">
              {[
                ['Version', info.version],
                ['Electron', info.electron],
                ['Chromium', info.chrome],
                ['Node.js', info.node],
                ['SQLite', info.sqlite],
                ['Schema version', info.schemaVersion],
                ['Platform', `${info.platform} (${info.arch})`],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="details-list__row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
          <h3 className="subsection-title">Format support (reported by the playback engine)</h3>
          <ul className="format-list">
            {FORMAT_PROBES.map(([name, mime]) => {
              const r = audio?.canPlayType(mime) ?? '';
              return (
                <li key={name} className={r ? 'is-ok' : 'is-no'}>
                  {r ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />} {name}
                  <span className="meta-text">{r ? (r === 'probably' ? 'supported' : 'likely supported') : 'not supported'}</span>
                </li>
              );
            })}
            <li className="is-ok">
              <Check size={14} aria-hidden /> ALAC (Apple Lossless)
              <span className="meta-text">via lossless FLAC conversion</span>
            </li>
          </ul>
        </div>
        <div className="button-row">
          <button className="btn btn--ghost" onClick={() => window.dispatchEvent(new Event('brook:farewell'))}>
            <Power size={16} /> Quit Reson
          </button>
        </div>
      </Section>
    </div>
  );
}
