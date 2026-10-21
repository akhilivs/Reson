import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../../services/api.js';
import { toastBus } from '../../app/toastBus.js';
import { useLibrary } from '../../app/LibraryContext.jsx';
import { BrandLogo } from '../../components/BrandMark.jsx';

const PRINCIPLES = [
  ['Your files stay put', 'Reson reads your folders. It never moves, renames or edits a single file.'],
  ['No account, no internet', 'Everything works offline. There is nothing to sign in to.'],
  ['Private by design', 'Your library, playlists and listening history live only on this computer.'],
];

/** First-launch opening spread. Shown while the library has no folders (until skipped). */
export function Onboarding({ onSkip }) {
  const { scan, scanning, refresh } = useLibrary();
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setBusy(true);
    try {
      const res = await api.library.addFolders();
      for (const s of res.skipped ?? []) toastBus.push({ type: 'warning', title: 'Folder not added', message: `${s.path}: ${s.reason}` });
      refresh();
    } catch (err) {
      toastBus.push({ type: 'error', title: 'Could not add folders', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const pct = scan?.total ? Math.round((scan.processed / scan.total) * 100) : 0;

  return (
    <div className="opening">
      <div className="opening__copy">
        <div className="mono-label">Welcome aboard</div>
        <h1 className="opening__title">
          Your music
          <br />
          lives <em>on</em>.
        </h1>
        <p className="opening__lead">
          Point Reson at the folders where you keep your music. It indexes MP3, FLAC, WAV, M4A/AAC and Ogg files and builds a library
          right here on your PC.
        </p>

        <ol className="principles">
          {PRINCIPLES.map(([title, text], i) => (
            <li key={title}>
              <span className="principles__num">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <strong>{title}.</strong> {text}
              </span>
            </li>
          ))}
        </ol>

        {scanning ? (
          <div className="scan-progress" role="status" aria-live="polite">
            <div className="scan-progress__head">
              <span>{scan.phase === 'enumerating' ? 'Charting your music…' : `Indexing ${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()}`}</span>
              <span className="mono-label">{scan.phase === 'indexing' ? `${pct}%` : ''}</span>
            </div>
            <div className="progress">
              <div className="progress__fill" style={{ width: `${scan.phase === 'enumerating' ? 4 : pct}%` }} />
            </div>
            {scan.current && <div className="scan-progress__file">{scan.current}</div>}
          </div>
        ) : (
          <div className="opening__actions">
            <button className="btn btn--primary btn--lg" onClick={choose} disabled={busy} autoFocus>
              Choose music folders <ArrowRight size={16} />
            </button>
            <button className="text-link" onClick={onSkip}>
              Skip for now
            </button>
          </div>
        )}
        <p className="footnote">Folders can be added or removed at any time in Library &amp; settings.</p>
      </div>
      <div className="opening__art">
        <BrandLogo />
      </div>
    </div>
  );
}
