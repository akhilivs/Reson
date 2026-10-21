import { artUrl } from '../services/playbackController.js';

/**
 * Soft, album-tinted light behind a detail page header: the cover, heavily blurred, plus that
 * album's own (contrast-clamped) palette. Purely decorative and faded out well before the content.
 */
export function DetailBackdrop({ hash, palette }) {
  return (
    <div
      className="detail-backdrop"
      aria-hidden
      style={{
        '--hero-a': palette && !palette.isFallback ? palette.ambient : 'transparent',
        '--hero-b': palette && !palette.isFallback ? palette.ambient2 : 'transparent',
      }}
    >
      {hash && <img src={artUrl(hash, 'thumb')} alt="" draggable={false} />}
    </div>
  );
}
