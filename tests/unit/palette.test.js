import { describe, it, expect } from 'vitest';
import { extractPalette, NEUTRAL_PALETTE, contrastRatio, hexToRgb, readableAccent, rgbToHsl } from '../../electron/services/palette.js';

const BG = [15, 15, 14];

function fill(pixels) {
  // pixels: array of [r,g,b,a,count]
  const out = [];
  for (const [r, g, b, a, n] of pixels) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return new Uint8Array(out);
}

describe('extractPalette', () => {
  it('falls back to the neutral palette for empty or transparent input', () => {
    expect(extractPalette(new Uint8Array())).toMatchObject({ accent: NEUTRAL_PALETTE.accent, isFallback: true });
    expect(extractPalette(fill([[255, 0, 0, 0, 100]])).isFallback).toBe(true);
    expect(extractPalette(null).isFallback).toBe(true);
  });

  it('picks the vibrant hue from colourful artwork', () => {
    const p = extractPalette(fill([[20, 20, 20, 255, 600], [230, 40, 40, 255, 200], [200, 200, 200, 255, 200]]));
    expect(p.isFallback).toBe(false);
    const [h] = rgbToHsl(...hexToRgb(p.accent));
    expect(h < 0.05 || h > 0.95).toBe(true); // red family
  });

  it('always returns an accent readable on the dark background', () => {
    const dark = extractPalette(fill([[40, 0, 90, 255, 500]])); // very dark purple
    expect(contrastRatio(hexToRgb(dark.accent), BG)).toBeGreaterThanOrEqual(4.5);
    const bright = extractPalette(fill([[255, 255, 0, 255, 500]]));
    expect(contrastRatio(hexToRgb(bright.accent), BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('ambient tones stay dark so text remains readable over them', () => {
    const p = extractPalette(fill([[250, 220, 30, 255, 500], [30, 120, 250, 255, 300]]));
    for (const c of [p.ambient, p.ambient2]) {
      const [, , l] = rgbToHsl(...hexToRgb(c));
      expect(l).toBeLessThanOrEqual(0.3);
    }
  });

  it('keeps the neutral accent for monochrome artwork', () => {
    const p = extractPalette(fill([[128, 128, 128, 255, 500], [30, 30, 30, 255, 500]]));
    expect(p.accent).toBe(NEUTRAL_PALETTE.accent);
    expect(p.monochrome).toBe(true);
  });

  it('is deterministic and honours BGRA channel order', () => {
    const rgba = fill([[220, 30, 60, 255, 300], [10, 10, 10, 255, 300]]);
    const bgra = fill([[60, 30, 220, 255, 300], [10, 10, 10, 255, 300]]);
    expect(extractPalette(rgba)).toEqual(extractPalette(rgba));
    expect(extractPalette(bgra, 'bgra')).toEqual(extractPalette(rgba, 'rgba'));
  });
});

describe('readableAccent', () => {
  it('clamps saturation and lightness', () => {
    const [, s, l] = rgbToHsl(...readableAccent([5, 5, 255]));
    expect(s).toBeLessThanOrEqual(0.86);
    expect(l).toBeGreaterThanOrEqual(0.59);
  });
});
