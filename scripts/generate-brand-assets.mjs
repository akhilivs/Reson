// Derives every Reson brand asset from the source logo artwork (build/brand/logo-source.webp).
// Runs in a hidden Electron window because Chromium decodes WebP and gives us a canvas.
// Usage: npx electron scripts/generate-brand-assets.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIco } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'build', 'brand', 'logo-source.webp');

// Crop rectangles in source pixels (source is 1254x1254).
const MARK = { x: 47, y: 25, size: 1160 }; // the full glass sound-wave, centred with breathing room
const FULL = { x: 0, y: 0, size: 1254 };

// Runs inside the page. Returns PNG data URLs.
async function render({ src, mark, full }) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvasFor = (size) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    return [c, ctx];
  };

  // Turn the near-black background into transparency, keeping the glow:
  // alpha follows brightness, colour is un-premultiplied so edges keep their hue.
  // The source background is a dim gradient, not pure black, so use a threshold and also feather
  // the outer edges to zero so no rectangular haze survives.
  const keyBlack = (ctx, size) => {
    const d = ctx.getImageData(0, 0, size, size);
    const p = d.data;
    const feather = size * 0.1;
    for (let i = 0; i < p.length; i += 4) {
      const px = (i / 4) % size;
      const py = Math.floor(i / 4 / size);
      const edge = Math.min(px, py, size - 1 - px, size - 1 - py);
      const t = Math.min(1, edge / feather);
      const fade = t * t * (3 - 2 * t);
      const m = Math.max(p[i], p[i + 1], p[i + 2]);
      const a = Math.max(0, Math.min(255, (m - 30) * 1.35)) * fade;
      if (a <= 0) {
        p[i + 3] = 0;
        continue;
      }
      const k = 255 / Math.max(m, 1);
      p[i] = Math.min(255, p[i] * k);
      p[i + 1] = Math.min(255, p[i + 1] * k);
      p[i + 2] = Math.min(255, p[i + 2] * k);
      p[i + 3] = a;
    }
    ctx.putImageData(d, 0, 0);
  };

  // Progressive downscaling keeps the fine strokes from aliasing at small sizes.
  const scaled = (crop, size) => {
    let [c, ctx] = canvasFor(crop.size);
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, crop.size, crop.size);
    let cur = crop.size;
    while (cur / 2 >= size) {
      const [n, nctx] = canvasFor(Math.round(cur / 2));
      nctx.drawImage(c, 0, 0, n.width, n.height);
      c = n;
      cur = n.width;
    }
    const [out, octx] = canvasFor(size);
    octx.drawImage(c, 0, 0, size, size);
    return [out, octx];
  };

  // App icon: the mark on a dark rounded tile (like the source background).
  const tile = (size) => {
    const [out, ctx] = canvasFor(size);
    const r = size * 0.22;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, r);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#0d0b1c');
    g.addColorStop(1, '#05050b');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const inset = size * 0.04;
    const [m] = scaled(mark, Math.round(size - inset * 2));
    ctx.drawImage(m, inset, inset);
    ctx.restore();
    return out.toDataURL('image/png');
  };

  // Transparent mark for the UI and tray.
  const transparent = (crop, size) => {
    const [c, ctx] = scaled(crop, size);
    keyBlack(ctx, size);
    return c.toDataURL('image/png');
  };

  return {
    icon: Object.fromEntries([16, 24, 32, 48, 64, 128, 256, 512].map((s) => [s, tile(s)])),
    tray: Object.fromEntries([16, 24, 32].map((s) => [s, transparent(mark, s)])),
    uiMark: transparent(mark, 256),
    uiLogo: transparent(full, 900),
  };
}

const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<!doctype html><title>brand</title>');
    const src = `data:image/webp;base64,${fs.readFileSync(SOURCE).toString('base64')}`;
    const out = await win.webContents.executeJavaScript(`(${render.toString()})(${JSON.stringify({ src, mark: MARK, full: FULL })})`);

    const build = path.join(root, 'build');
    const assets = path.join(root, 'src', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(build, 'icon.png'), png(out.icon[512]));
    fs.writeFileSync(path.join(build, 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: png(out.icon[s]) }))));
    fs.writeFileSync(path.join(build, 'tray.png'), png(out.tray[32]));
    fs.writeFileSync(path.join(build, 'tray.ico'), encodeIco([16, 24, 32].map((s) => ({ size: s, png: png(out.tray[s]) }))));
    fs.writeFileSync(path.join(assets, 'reson-mark.png'), png(out.uiMark));
    fs.writeFileSync(path.join(assets, 'reson-logo.png'), png(out.uiLogo));
    console.log('Brand assets written.');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
