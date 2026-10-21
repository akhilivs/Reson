// Deterministic palette extraction from raw pixels. No dependencies; pure functions.
// Produces an accent that stays readable on Reson's dark surfaces, plus darker ambient tones.

export const NEUTRAL_PALETTE = Object.freeze({
  accent: '#ecebe6',
  ambient: '#2a2724',
  ambient2: '#1c1b19',
  isFallback: true,
});

const BACKGROUND = [15, 15, 14]; // --color-background

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Clamps a color into a readable accent for dark backgrounds (contrast >= 4.5 vs background). */
export function readableAccent(rgb) {
  let [h, s, l] = rgbToHsl(...rgb);
  s = Math.min(0.85, Math.max(0.4, s));
  l = Math.min(0.78, Math.max(0.6, l));
  let out = hslToRgb(h, s, l);
  while (contrastRatio(out, BACKGROUND) < 4.5 && l < 0.92) {
    l += 0.02;
    out = hslToRgb(h, s, l);
  }
  return out;
}

function ambientTone(rgb, lightness) {
  const [h, s] = rgbToHsl(...rgb);
  return hslToRgb(h, Math.min(0.6, Math.max(0.25, s)), lightness);
}

/**
 * @param {Uint8Array|Uint8ClampedArray|Buffer} pixels 4 bytes per pixel
 * @param {'rgba'|'bgra'} order channel order of the buffer
 * @returns palette object, or NEUTRAL_PALETTE when nothing usable is found
 */
export function extractPalette(pixels, order = 'rgba') {
  if (!pixels || pixels.length < 4) return { ...NEUTRAL_PALETTE };
  const ri = order === 'bgra' ? 2 : 0;
  const bi = order === 'bgra' ? 0 : 2;
  const buckets = new Map();
  let counted = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i + ri];
    const g = pixels[i + 1];
    const b = pixels[i + bi];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { r: 0, g: 0, b: 0, n: 0 }));
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n++;
    counted++;
  }
  if (!counted) return { ...NEUTRAL_PALETTE };

  const colors = [...buckets.values()].map((bk) => {
    const rgb = [Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n)];
    const [, s, l] = rgbToHsl(...rgb);
    return { rgb, n: bk.n, s, l };
  });
  // Ties are broken by RGB value so the result is deterministic regardless of Map order.
  const tieBreak = (a, b) => toHex(a.rgb).localeCompare(toHex(b.rgb));
  const dominant = [...colors].sort((a, b) => b.n - a.n || tieBreak(a, b))[0];

  // Vibrancy: favour saturated, mid-lightness colors that cover a meaningful share of the image.
  const scored = colors
    .filter((c) => c.n / counted >= 0.004 && c.l > 0.12 && c.l < 0.92)
    .map((c) => ({ ...c, score: c.s * c.s * (1 - Math.abs(c.l - 0.55) * 1.2) * Math.sqrt(c.n / counted) }))
    .sort((a, b) => b.score - a.score || tieBreak(a, b));
  const vibrant = scored[0];

  if (!vibrant || vibrant.s < 0.15) {
    // Monochrome artwork: keep the neutral accent but tint ambient light with the dominant tone.
    const base = dominant.rgb;
    return {
      accent: NEUTRAL_PALETTE.accent,
      ambient: toHex(ambientTone(base, 0.2)),
      ambient2: NEUTRAL_PALETTE.ambient2,
      isFallback: false,
      monochrome: true,
    };
  }

  // Secondary ambient: the next vibrant color with a clearly different hue.
  const [vh] = rgbToHsl(...vibrant.rgb);
  const second =
    scored.slice(1).find((c) => {
      const [h] = rgbToHsl(...c.rgb);
      const d = Math.abs(h - vh);
      return Math.min(d, 1 - d) > 0.08;
    }) ?? dominant;

  return {
    accent: toHex(readableAccent(vibrant.rgb)),
    ambient: toHex(ambientTone(vibrant.rgb, 0.24)),
    ambient2: toHex(ambientTone(second.rgb, 0.18)),
    isFallback: false,
  };
}
