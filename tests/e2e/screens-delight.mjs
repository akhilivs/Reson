// Captures the easter-egg / delight states for visual review: node tests/e2e/screens-delight.mjs <outDir>
import path from 'node:path';
import fs from 'node:fs';
import { launch, tempProfile, addFoldersAndScan, captureWindow, ROOT } from './launch.mjs';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const { app, page } = await launch({ userData: tempProfile() });
const shot = (name) => captureWindow(app, 'index.html', path.join(out, `${name}.png`));
const wait = (ms) => page.waitForTimeout(ms);
const nav = (label) => page.locator('.sidebar .nav-item', { hasText: label }).first().click();

await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
await addFoldersAndScan(app, [path.join(ROOT, 'tests/fixtures/generated/library')]);
await wait(500);

await nav('Favorites');
await wait(500);
await shot('d1-empty-soot');

await nav('Songs');
await page.locator('.tl-row').first().waitFor();
await page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: 'First Light' }) }).first().dblclick();
await wait(800);
await nav('Overview');
await wait(1200);
await shot('d2-home-greeting');

// Konami code → Soul King mode.
await page.locator('.content').click({ position: { x: 5, y: 5 } });
for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
await wait(250);
await shot('d3a-soul-king-intro');
await wait(1600);
await shot('d3-soul-king');
await page.getByRole('button', { name: 'Now Playing', exact: true }).click();
await wait(900);
await shot('d4-soul-king-now-playing');

// Bankai focus mode.
await page.keyboard.press('f');
await wait(900);
await shot('d5-bankai');
await page.keyboard.press('Escape');
await wait(400);
await page.keyboard.press('Control+k');
await page.getByRole('combobox').fill('bankai');
await wait(400);
await shot('d6-palette-bankai');
await page.keyboard.press('Escape');

await page.evaluate(() => window.vela.app.quit()).catch(() => {});
console.log('done');
