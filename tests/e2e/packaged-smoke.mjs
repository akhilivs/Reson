// Smoke test for the packaged build: node tests/e2e/packaged-smoke.mjs (after `npm run pack`)
import path from 'node:path';
import { launch, tempProfile, addFoldersAndScan, ROOT } from './launch.mjs';
const exe = path.join(ROOT, 'release', 'win-unpacked', 'Reson.exe');
const { app, page, proc } = await launch({ userData: tempProfile(), executablePath: exe, args: [] });
await page.getByRole('heading', { name: /Your music/ }).waitFor({ timeout: 15000 });
const res = await addFoldersAndScan(app, [path.join(ROOT, 'tests/fixtures/generated/library')]);
const count = await page.evaluate(() => window.vela.library.stats().then((s) => s.tracks));
console.log(`packaged app OK: url=${page.url()} folders=${res.added.length} tracks=${count}`);
// ALAC needs the bundled ffmpeg, which must be unpacked from the asar to run.
await addFoldersAndScan(app, [path.join(ROOT, 'tests/fixtures/generated/alac')]);
await page.locator('.sidebar .nav-item', { hasText: 'Songs' }).first().click();
await page.getByPlaceholder('Filter songs').fill('Soul King');
await page.locator('.tl-row').first().dblclick();
let st;
for (let i = 0; i < 60; i++) {
  st = await app.evaluate(() => globalThis.__velaTest.getPlayerState());
  if (st?.playing && st.position > 1) break;
  await new Promise((r) => setTimeout(r, 250));
}
console.log('packaged ALAC playback:', st?.playing && st.position > 1 ? 'OK' : `FAILED ${JSON.stringify(st?.error)}`);
await page.evaluate(() => window.vela.app.quit()).catch(() => {});
for (let i = 0; i < 50 && proc.exitCode === null; i++) await new Promise((r) => setTimeout(r, 100));
console.log('exited:', proc.exitCode !== null);
