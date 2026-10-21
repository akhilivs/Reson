import markUrl from '../assets/reson-mark.png';
import logoUrl from '../assets/reson-logo.png';

// Brand artwork is generated from build/brand/logo-source.webp by scripts/generate-brand-assets.mjs.

/** The Reson mark: a glass sound-wave, on a transparent background. */
export function BrandMark({ size = 24, className = '' }) {
  return <img className={`brand-mark ${className}`} src={markUrl} width={size} height={size} alt="" aria-hidden draggable={false} />;
}

/** The full lockup: the glass sound-wave with the name set beneath it. */
export function BrandLogo({ className = '' }) {
  return (
    <figure className={`brand-lockup ${className}`}>
      <img className="brand-logo" src={logoUrl} alt="" draggable={false} />
      <figcaption>
        <span className="brand-lockup__name">Reson</span>
        <span className="brand-lockup__tag">Your music lives on</span>
      </figcaption>
    </figure>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`wordmark ${className}`}>
      <BrandMark size={30} />
      <span className="wordmark__text">Reson</span>
    </span>
  );
}
