// Captures every major screen for visual review: node tests/e2e/screens.mjs <outDir>
import path from 'node:path';
import fs from 'node:fs';
import { launch, tempProfile, addFoldersAndScan, captureWindow, ROOT } from './launch.mjs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const { app, page } = await launch({ userData: tempProfile() });
const shot = (name, which = 'index.html') => captureWindow(app, which, path.join(out, `${name}.png`));
const nav = (label) => page.locator('.sidebar .nav-item', { hasText: label }).first().click();
const wait = (ms) => page.waitForTimeout(ms);
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
await wait(1200); await shot('01-onboarding');
await addFoldersAndScan(app, [path.join(ROOT, 'tests/fixtures/generated/library')]);
await wait(800);
// Build some history: play a few tracks briefly.
await nav('Songs'); await page.locator('.tl-row').first().waitFor();
for (const t of ['First Light', 'Spark', 'Polar Drift']) {
  await page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: t }) }).first().dblclick();
  await page.evaluate(() => window.vela.player.command({ type: 'seek', position: 9 })); await wait(400);
}
await page.evaluate(async () => { const ts = await window.vela.library.listTracks({}); for (const t of ts.slice(0,5)) await window.vela.history.record(t.id, 40); await window.vela.favorites.set([ts[2].id, ts[4].id], true); await window.vela.playlists.create('Late Drive', ts.map(t=>t.id).slice(0,4)); });
await page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: 'First Light' }) }).first().dblclick();
await wait(1500);
await nav('Overview'); await wait(900); await shot('02-home');
await nav('Songs'); await wait(700); await shot('03-songs');
await nav('Albums'); await wait(700); await shot('04-albums');
await page.getByRole('button', { name: 'Open album Aurora Lines' }).click(); await wait(800); await shot('05-album');
await nav('Artists'); await wait(700); await shot('06-artists');
await nav('Playlists'); await wait(700); await shot('07-playlists');
await page.getByRole('button', { name: 'Now Playing', exact: true }).click(); await wait(1200); await shot('08-now-playing');
await page.getByRole('tab', { name: 'Lyrics' }).click(); await wait(900); await shot('09-lyrics');
await page.keyboard.press('Escape');
await nav('Library & settings'); await wait(800); await shot('10-settings');
await page.getByRole('button', { name: 'Show queue' }).click(); await nav('Songs'); await wait(700); await shot('11-queue');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 700)); await wait(800); await shot('12-narrow');
await page.evaluate(() => window.vela.windows.showMini());
const mini = await (async () => { for (let i = 0; i < 50; i++) { const w = app.windows().find((w) => w.url().includes('mini.html')); if (w) return w; await wait(100); } })();
await mini.waitForLoadState(); await wait(1200); await shot('13-mini', 'mini.html');
await app.close();
console.log('done');
