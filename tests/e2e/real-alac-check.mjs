// Ad-hoc check against real ALAC files, using a throwaway profile (the user's library is untouched).
// Usage: node tests/e2e/real-alac-check.mjs "<folder>" "<title substring>"...
import { launch, tempProfile, addFoldersAndScan } from './launch.mjs';
const [folder, ...titles] = process.argv.slice(2);
const { app, page } = await launch({ userData: tempProfile() });
await addFoldersAndScan(app, [folder]);
const tracks = await page.evaluate(() => window.vela.library.listTracks({}));
for (const want of titles) {
  const t = tracks.find((x) => x.title.toLowerCase().includes(want.toLowerCase()));
  if (!t) { console.log(`${want}: not found`); continue; }
  const started = Date.now();
  await page.evaluate((id) => window.vela.library.getTracks([id]), t.id);
  // Play through the real engine via the Songs list.
  await page.locator('.sidebar .nav-item', { hasText: 'Songs' }).first().click();
  await page.getByPlaceholder('Filter songs').fill(t.title);
  await page.locator('.tl-row').first().dblclick();
  let s;
  for (let i = 0; i < 120; i++) {
    s = await app.evaluate(() => globalThis.__velaTest.getPlayerState());
    if (s?.track?.id === t.id && s.playing && s.position > 1.5) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`${t.title} [${t.codec}, ${t.sampleRate} Hz] -> ${s?.track?.id === t.id && s.playing ? `PLAYING at ${s.position.toFixed(1)}s of ${s.duration.toFixed(0)}s (ready in ${((Date.now() - started) / 1000).toFixed(1)}s)` : `FAILED ${JSON.stringify(s?.error)}`}`);
}
await page.evaluate(() => window.vela.app.quit()).catch(() => {});
