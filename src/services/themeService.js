// Applies album-art palettes and visual preferences to CSS custom properties.
// Values from artwork have already been clamped for contrast in the main process (palette.js);
// they are only ever used for accents and ambient light, never for body text.

const NEUTRAL = { accent: '#ecebe6', ambient: '#2a2724', ambient2: '#1c1b19' };
const HEX = /^#[0-9a-f]{6}$/i;

const safe = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value : fallback);

export function resolveTheme(palette, settings = {}) {
  const fixedAccent = safe(settings.accentColor, NEUTRAL.accent);
  const usePalette = settings.dynamicAccent !== false && palette && !palette.isFallback;
  return {
    accent: usePalette ? safe(palette.accent, fixedAccent) : fixedAccent,
    ambientA: usePalette ? safe(palette.ambient, NEUTRAL.ambient) : NEUTRAL.ambient,
    ambientB: usePalette ? safe(palette.ambient2, NEUTRAL.ambient2) : NEUTRAL.ambient2,
  };
}

export function applyPalette(palette, settings, root = document.documentElement) {
  const theme = resolveTheme(palette, settings);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--ambient-a', theme.ambientA);
  root.style.setProperty('--ambient-b', theme.ambientB);
  return theme;
}

const motionQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion(settings) {
  if (typeof window !== 'undefined' && window.vela?.env?.quiet) return true;
  if (settings?.reducedMotion === 'on') return true;
  if (settings?.reducedMotion === 'off') return false;
  return !!motionQuery?.matches;
}

export function applyPreferences(settings, root = document.documentElement) {
  root.dataset.ambient = settings.ambientIntensity ?? 'subtle';
  root.dataset.reduceTransparency = String(!!settings.reduceTransparency);
  root.dataset.reduceMotion = String(prefersReducedMotion(settings));
}

export function onSystemMotionChange(callback) {
  if (!motionQuery) return () => {};
  motionQuery.addEventListener('change', callback);
  return () => motionQuery.removeEventListener('change', callback);
}
